// Read-only calendar events from ICS text (Google, Outlook and other iCalendar feeds).
// No Obsidian imports, so it can be tested with plain Node.
import ICAL from "ical.js";

export interface CalEvent {
  calendar: string;
  /** Local day, YYYY-MM-DD. */
  day: string;
  /** Local start time "HH:MM", or null for an all-day event. */
  time: string | null;
  title: string;
  /** Minutes after midnight for sorting; -1 for all-day events. */
  sort: number;
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function nextDay(day: string, n = 1): string {
  const d = new Date(day + "T00:00:00");
  d.setDate(d.getDate() + n);
  return ymd(d);
}

const dateOf = (t: ICAL.Time) => `${t.year}-${pad(t.month)}-${pad(t.day)}`;

// Longest stretch walked through: guards against very long daily repeats and broken feeds.
const MAX_OCCURRENCES = 50000;
const MAX_ALLDAY_SPAN = 366;

/**
 * Every event that falls on a day from `from` to `to` (inclusive), in the computer's local time.
 * Handles all-day and multi-day events, repeats (RRULE, RDATE), removed dates (EXDATE),
 * moved or cancelled single occurrences (RECURRENCE-ID) and the time zones the feed defines.
 */
export function expandEvents(ics: string, calendar: string, from: string, to: string): CalEvent[] {
  const root = new ICAL.Component(ICAL.parse(ics));
  for (const tz of root.getAllSubcomponents("vtimezone")) {
    try { ICAL.TimezoneService.register(tz); } catch { /* a zone the library can't read: times fall back to local */ }
  }

  // Group each repeating event with its moved or cancelled occurrences.
  const events = new Map<string, ICAL.Event>();
  const exceptions: ICAL.Component[] = [];
  let anon = 0;
  for (const c of root.getAllSubcomponents("vevent")) {
    if (c.hasProperty("recurrence-id")) exceptions.push(c);
    else events.set(String(c.getFirstPropertyValue("uid") ?? `anon-${anon++}`), new ICAL.Event(c));
  }
  for (const c of exceptions) {
    const master = events.get(String(c.getFirstPropertyValue("uid")));
    if (master) master.relateException(c);
    else events.set(`orphan-${anon++}`, new ICAL.Event(c));
  }

  const out: CalEvent[] = [];
  const endMs = new Date(nextDay(to) + "T00:00:00").getTime();
  // Moved occurrences can land a little after their original date, so walk a week further.
  const stopMs = endMs + 7 * 86_400_000;

  const add = (item: ICAL.Event, start: ICAL.Time, end: ICAL.Time | null) => {
    if (String(item.component.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED") return;
    const title = (item.summary ?? "").trim() || "Untitled event";
    if (start.isDate) {
      const first = dateOf(start);
      let last = end ? dateOf(end) : nextDay(first); // DTEND of an all-day event is the day after
      if (last <= first) last = nextDay(first);
      let d = first;
      for (let i = 0; d < last && i < MAX_ALLDAY_SPAN; i++, d = nextDay(d)) {
        if (d >= from && d <= to) out.push({ calendar, day: d, time: null, title, sort: -1 });
      }
      return;
    }
    const js = start.toJSDate();
    const day = ymd(js);
    if (day < from || day > to) return;
    out.push({ calendar, day, time: `${pad(js.getHours())}:${pad(js.getMinutes())}`, title, sort: js.getHours() * 60 + js.getMinutes() });
  };

  for (const ev of events.values()) {
    if (!ev.startDate) continue;
    if (!ev.isRecurring()) { add(ev, ev.startDate, ev.endDate ?? null); continue; }
    const it = ev.iterator();
    for (let i = 0; i < MAX_OCCURRENCES; i++) {
      const next = it.next();
      if (!next) break;
      if (next.toJSDate().getTime() >= stopMs) break;
      const o = ev.getOccurrenceDetails(next);
      add(o.item, o.startDate, o.endDate ?? null);
    }
  }

  return out.sort((a, b) => a.day.localeCompare(b.day) || a.sort - b.sort || a.title.localeCompare(b.title));
}

// ---------- cycle ----------

export type CyclePhase = "period" | "follicular" | "ovulation" | "luteal";
export interface CycleDay { day: number; phase: CyclePhase; length: number }

const dayDiff = (a: string, b: string) =>
  Math.round((new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime()) / 86_400_000);

/**
 * Cycle day and phase for `day`, counted from the last day 1 (`start`) and the next one if known.
 * Period: days 1 to 5. Ovulation: about 14 days before the next day 1 (one day either side).
 * Follicular before that, luteal after. With no next day 1, or an unlikely gap, a 28-day cycle is assumed.
 */
export function cycleDay(day: string, start: string, next: string | null): CycleDay | null {
  const n = dayDiff(start, day) + 1;
  if (n < 1 || n > 45) return null;
  let length = next ? dayDiff(start, next) : 28;
  if (length < 15 || length > 60) length = 28;
  const ovulation = length - 14;
  const phase: CyclePhase = n <= 5 ? "period" : Math.abs(n - ovulation) <= 1 ? "ovulation" : n < ovulation ? "follicular" : "luteal";
  return { day: n, phase, length };
}
