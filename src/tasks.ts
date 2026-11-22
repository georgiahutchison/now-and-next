// Pure helpers for reading and editing Tasks-plugin (emoji format) task lines.
// No Obsidian imports here, so this file can be unit-tested with plain Node.

export type Priority = "highest" | "high" | "medium" | "none" | "low" | "lowest";
export type Energy = "low" | "mid" | "high";
/** Shown in the planner only; notes keep the #energy/… tag. */
export const ENERGY_EMOJI: Record<Energy, string> = { low: "🥄", mid: "🥄🥄", high: "🥄🥄🥄" };

export const PRIORITY_EMOJI: Record<Exclude<Priority, "none">, string> = {
  highest: "🔺",
  high: "⏫",
  medium: "🔼",
  low: "🔽",
  lowest: "⏬",
};
export const PRIORITY_RANK: Record<Priority, number> = {
  highest: 0, high: 1, medium: 2, none: 3, low: 4, lowest: 5,
};

export const DATE_EMOJI = {
  due: "📅",
  scheduled: "⏳",
  start: "🛫",
  created: "➕",
  done: "✅",
  cancelled: "❌",
} as const;
export type DateField = keyof typeof DATE_EMOJI;

// Emojis that start a Tasks field. Tasks reads fields from the end of the line,
// so anything we add that is not a field (the estimate) must go before these.
const FIELD_EMOJI = ["📅", "⏳", "🛫", "➕", "✅", "❌", "🔺", "⏫", "🔼", "🔽", "⏬", "🔁", "🆔", "⛔", "🏁"];

const TASK_RE = /^(\s*)([-*+]|\d+[.)]) \[(.)\] ?(.*)$/u;
const TAG_RE = /(^|\s)#([\p{L}\p{N}_/-]+)/gu;
const EST_RE = /\[est::\s*([^\]]*)\]/u;
/** [before:: Event], [on:: Event] or [after:: Event]: the task sits the day before, the day of, or the day after that calendar event. */
const EVENT_RE = /\[(before|after|on)::\s*([^\]]+?)\s*\]/u;
const BLOCK_ID_RE = /\s\^[A-Za-z0-9-]+\s*$/u;
/** [for:: id] on a task: it counts toward the milestone with that 🆔. [for:: none] keeps it out of every milestone. */
const FOR_RE = /\[for::\s*([^\]]*?)\s*\]/u;
/** [from:: #tag Area] on a milestone: the tags and areas whose tasks count toward it. */
const FROM_RE = /\[from::\s*([^\]]*?)\s*\]/u;
const ID_RE = /🆔\uFE0F? *([A-Za-z0-9_-]+)/u;
/** Tasks' ⛔ field: the 🆔s this task waits on (a comma list). */
const WAITS_RE = /⛔\uFE0F? *([A-Za-z0-9_,-]+)/u;

export interface ParsedTask {
  indent: string;
  marker: string;
  status: string;
  body: string; // everything after "[x] "
  text: string; // human text: fields, tags and estimate removed
  tags: string[]; // without '#'
  priority: Priority;
  due?: string;
  scheduled?: string;
  start?: string;
  created?: string;
  done?: string;
  cancelled?: string;
  recurrence?: string;
  estimateMin?: number;
  energy?: Energy;
  /** Calendar event this task is tied to: the day before or the day after it. */
  eventLink?: { kind: EventKind; title: string };
  /** First [[wikilink]] in the task, if any (the target, without alias or heading). */
  link?: string;
  /** Tasks' 🆔 field: a milestone's short name. */
  id?: string;
  /** ⛔: the 🆔s of the tasks this one waits on. */
  waitsOn?: string[];
  /** [for:: id]: the milestone this task counts toward. */
  forId?: string;
  /** [from:: …] on a milestone: tags (without '#') and areas or folders whose tasks count toward it. */
  from?: { tags: string[]; places: string[] };
}

export type EventKind = "before" | "on" | "after";

export function isTaskLine(line: string): boolean {
  return TASK_RE.test(line);
}

export function parseTaskLine(line: string): ParsedTask | null {
  const m = TASK_RE.exec(line);
  if (!m) return null;
  const [, indent, marker, status, body] = m;
  const t: ParsedTask = { indent, marker, status, body, text: "", tags: [], priority: "none" };

  for (const [field, emoji] of Object.entries(DATE_EMOJI) as [DateField, string][]) {
    const dm = new RegExp(emoji + "\\uFE0F? *(\\d{4}-\\d{2}-\\d{2})", "u").exec(body);
    if (dm) t[field] = dm[1];
  }
  for (const [p, emoji] of Object.entries(PRIORITY_EMOJI) as [Priority, string][]) {
    if (body.includes(emoji)) { t.priority = p; break; }
  }
  const rm = /🔁\uFE0F? *([A-Za-z0-9][A-Za-z0-9 ,]*)/u.exec(body);
  if (rm) t.recurrence = rm[1].trim();

  const ev = EVENT_RE.exec(body);
  if (ev) t.eventLink = { kind: ev[1] as EventKind, title: ev[2] };

  const em = EST_RE.exec(body);
  if (em) {
    const min = parseDuration(em[1]);
    if (min !== null) t.estimateMin = min;
  }

  const idm = ID_RE.exec(body);
  if (idm) t.id = idm[1];
  const wm = WAITS_RE.exec(body);
  if (wm) { const ids = wm[1].split(",").map((x) => x.trim()).filter(Boolean); if (ids.length) t.waitsOn = ids; }
  const fm = FOR_RE.exec(body);
  if (fm && fm[1]) t.forId = fm[1];
  const frm = FROM_RE.exec(body);
  if (frm) t.from = parseFrom(frm[1]);

  // Tags inside [from:: …] name what feeds a milestone; they are not the milestone's own tags.
  for (const tm of body.replace(FROM_RE, "").matchAll(TAG_RE)) t.tags.push(tm[2]);
  const energyTag = t.tags.find((x) => x.toLowerCase().startsWith("energy/"));
  if (energyTag) {
    const e = energyTag.split("/")[1].toLowerCase();
    if (e === "low" || e === "mid" || e === "high") t.energy = e;
  }

  const lm = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/.exec(body);
  if (lm) t.link = lm[1].trim();

  t.text = displayText(body);
  return t;
}

/** "#4-Method #5-Results, 2 Areas/uni" -> tags ["4-Method", "5-Results"], places ["2 Areas/uni"]. */
export function parseFrom(raw: string): { tags: string[]; places: string[] } {
  const tags = [...raw.matchAll(TAG_RE)].map((m) => m[2]);
  const places = raw.replace(TAG_RE, "$1").split(",").map((x) => x.trim()).filter(Boolean);
  return { tags, places };
}

export function displayText(body: string): string {
  let s = body;
  s = s.replace(BLOCK_ID_RE, "");
  s = s.replace(new RegExp(FOR_RE.source, "gu"), "").replace(new RegExp(FROM_RE.source, "gu"), "");
  s = s.replace(EST_RE, "");
  s = s.replace(new RegExp(EVENT_RE.source, "gu"), "");
  s = s.replace(/🔁️? *[^📅⏳🛫➕✅❌🔺⏫🔼🔽⏬🆔⛔🏁#^]+/gu, "");
  s = s.replace(/(📅|⏳|🛫|➕|✅|❌)️? *\d{4}-\d{2}-\d{2}/gu, "");
  s = s.replace(/(🆔|⛔|🏁)️? *[^\s]+/gu, "");
  s = s.replace(/[🔺⏫🔼🔽⏬]️?/gu, "");
  s = s.replace(TAG_RE, "$1");
  s = s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2").replace(/\[\[([^\]]+)\]\]/g, "$1");
  return s.replace(/\s+/g, " ").trim();
}

/** "30m", "1h", "1h30m", "1.5h", "90" (minutes) -> minutes */
export function parseDuration(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return null;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const m = /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+)m(?:in)?)?$/.exec(s);
  if (!m || (!m[1] && !m[2])) return null;
  return Math.round((m[1] ? parseFloat(m[1]) * 60 : 0) + (m[2] ? parseInt(m[2], 10) : 0));
}

export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

// ---------- line editing ----------

function splitBlockId(line: string): [string, string] {
  const m = BLOCK_ID_RE.exec(line);
  if (!m) return [line.replace(/\s+$/, ""), ""];
  return [line.slice(0, m.index).replace(/\s+$/, ""), m[0].replace(/\s+$/, "")];
}

function appendToken(line: string, token: string): string {
  const [main, block] = splitBlockId(line);
  return `${main} ${token}${block}`;
}

function tidy(line: string): string {
  const m = TASK_RE.exec(line);
  if (!m) return line;
  const body = m[4].replace(/[ \t]{2,}/g, " ").replace(/\s+$/, "");
  return `${m[1]}${m[2]} [${m[3]}] ${body}`;
}

export function setDate(line: string, field: DateField, date: string | null): string {
  const emoji = DATE_EMOJI[field];
  let out = line.replace(new RegExp(" ?" + emoji + "\\uFE0F? *\\d{4}-\\d{2}-\\d{2}", "gu"), "");
  if (date) out = appendToken(out, `${emoji} ${date}`);
  return tidy(out);
}

export function setPriority(line: string, p: Priority): string {
  let out = line.replace(/ ?[🔺⏫🔼🔽⏬]️?/gu, "");
  if (p !== "none") {
    // Priority goes before date fields to match Tasks' own ordering.
    out = insertBefore(out, ["📅", "⏳", "🛫", "➕", "✅", "❌", "🔁"], PRIORITY_EMOJI[p]);
  }
  return tidy(out);
}

export function setStatus(line: string, status: string): string {
  return line.replace(TASK_RE, (_all, ind, mk, _st, body) => `${ind}${mk} [${status}] ${body}`);
}

export function setEnergy(line: string, e: Energy | null): string {
  let out = line.replace(/ ?#energy\/[\p{L}\p{N}_-]+/giu, "");
  if (e) out = appendToken(out, `#energy/${e}`);
  return tidy(out);
}

export function setEstimate(line: string, minutes: number | null): string {
  let out = line.replace(/ ?\[est::[^\]]*\]/u, "");
  if (minutes !== null && minutes > 0) {
    out = insertBefore(out, FIELD_EMOJI, `[est:: ${formatMinutes(minutes).replace(" ", "")}]`);
  }
  return tidy(out);
}

/** Set or clear the repeat rule (🔁 every week). It goes after priority and before dates, as Tasks writes it. */
export function setRecurrence(line: string, rule: string | null): string {
  let out = line.replace(/ ?🔁\uFE0F? *[^📅⏳🛫➕✅❌🔺⏫🔼🔽⏬🆔⛔🏁#^]*/gu, " ");
  const r = rule?.trim().replace(/^🔁\uFE0F? */u, "");
  if (r) out = insertBefore(tidy(out), ["➕", "🛫", "⏳", "📅", "✅", "❌"], `🔁 ${r}`);
  return tidy(out);
}

/** Tie a task to a calendar event (the day before or after it), or remove the tie. */
export function setEventLink(line: string, link: { kind: EventKind; title: string } | null): string {
  let out = line.replace(/ ?\[(?:before|after|on)::[^\]]*\]/gu, "");
  if (link && link.title.trim()) out = insertBefore(out, FIELD_EMOJI, `[${link.kind}:: ${link.title.trim()}]`);
  return tidy(out);
}

/** Count the task toward a milestone ([for:: id]), keep it out of every milestone ("none"), or clear the field (null). */
export function setFor(line: string, id: string | null): string {
  let out = line.replace(/ ?\[for::[^\]]*\]/gu, "");
  if (id && id.trim()) out = insertBefore(out, FIELD_EMOJI, `[for:: ${id.trim()}]`);
  return tidy(out);
}

/** Give a task a Tasks 🆔 (replacing any it has). */
export function setId(line: string, id: string): string {
  const out = line.replace(/ ?🆔\uFE0F? *[A-Za-z0-9_-]+/gu, "");
  return tidy(appendToken(out, `🆔 ${id}`));
}

/** Insert a token before the first of the given emojis in the body, or at the end. */
function insertBefore(line: string, emojis: string[], token: string): string {
  const m = TASK_RE.exec(line);
  if (!m) return line;
  const prefix = line.slice(0, line.length - m[4].length);
  const body = m[4];
  let idx = -1;
  for (const e of emojis) {
    const i = body.indexOf(e);
    if (i >= 0 && (idx < 0 || i < idx)) idx = i;
  }
  if (idx < 0) return appendToken(line, token);
  const before = body.slice(0, idx).replace(/\s+$/, "");
  return `${prefix}${before} ${token} ${body.slice(idx)}`;
}

// Everything in a task line that is not its wording: kept in order when the wording changes.
const KEEP_RE = /\[est::[^\]]*\]|\[(?:for|from)::[^\]]*\]|\[(?:before|after|on)::[^\]]*\]|[🔺⏫🔼🔽⏬]\uFE0F?|(?:📅|⏳|🛫|➕|✅|❌)\uFE0F? *\d{4}-\d{2}-\d{2}|🔁\uFE0F? *[^📅⏳🛫➕✅❌🔺⏫🔼🔽⏬🆔⛔🏁#^]+|(?:🆔|⛔|🏁)\uFE0F? *\S+|(?:^|\s)#[\p{L}\p{N}_/-]+/gu;

/** Replace a task's wording, keeping its status, fields, tags and block id. */
export function setText(line: string, text: string): string {
  const m = TASK_RE.exec(line);
  if (!m) return line;
  const bm = BLOCK_ID_RE.exec(m[4]);
  const main = bm ? m[4].slice(0, bm.index) : m[4];
  const block = bm ? bm[0].replace(/\s+$/, "") : "";
  const kept = [...main.matchAll(KEEP_RE)].map((x) => x[0].trim());
  return tidy(`${m[1]}${m[2]} [${m[3]}] ${[text.trim(), ...kept].join(" ")}${block}`);
}

/** An area's folder name as shown: leading numbers dropped, first letter capital ("4 Method" -> "Method", "health" -> "Health"). */
export function areaLabel(name: string): string {
  const s = name.replace(/^\d+[\s._-]*/, "").trim() || name;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A folder name as a tag: spaces become hyphens ("pro practice" -> "pro-practice"). */
export function tagFor(name: string): string {
  return name.trim().replace(/^#/, "").replace(/\s+/g, "-");
}

/** Remove the given tags (exact or with a /sub-part), leaving everything else. */
export function removeTags(line: string, tags: string[]): string {
  const set = tags.map((x) => tagFor(x).toLowerCase());
  // Tags inside [from:: …] belong to the milestone's list, so they stay.
  const from = FROM_RE.exec(line)?.[0];
  if (from) line = line.replace(from, "\u0000FROM\u0000");
  let out = line.replace(/(^|\s)#([\p{L}\p{N}_/-]+)/gu, (all, sp, tg) => {
    const l = String(tg).toLowerCase();
    return set.some((x) => l === x || l.startsWith(x + "/")) ? "" : all;
  });
  if (from) out = out.replace("\u0000FROM\u0000", from);
  return tidy(out);
}

export function addTag(line: string, tag: string): string {
  const clean = tagFor(tag);
  const t = parseTaskLine(line);
  if (t && t.tags.some((x) => x.toLowerCase() === clean.toLowerCase())) return line;
  return tidy(appendToken(line, `#${clean}`));
}

export function newTaskLine(text: string, opts: { scheduled?: string; tag?: string; indent?: string; forId?: string } = {}): string {
  let line = `${opts.indent ?? ""}- [ ] ${text.trim()}`;
  if (opts.tag) line = addTag(line, opts.tag);
  if (opts.forId) line = setFor(line, opts.forId);
  if (opts.scheduled) line = setDate(line, "scheduled", opts.scheduled);
  return line;
}

// ---------- files ----------

export interface FileTask extends ParsedTask {
  line: number;
  raw: string;
  parentLine: number | null;
  /** Plain (non-checkbox) bullets nested under this task: details, not sub-tasks. */
  details: string[];
}

function indentWidth(s: string): number {
  let w = 0;
  for (const c of s) w += c === "\t" ? 4 : 1;
  return w;
}

export function parseFile(content: string): FileTask[] {
  const lines = content.split("\n");
  const out: FileTask[] = [];
  const stack: { width: number; line: number; task: FileTask | null }[] = [];
  const BULLET_RE = /^(\s*)([-*+]|\d+[.)]) (.*)$/;
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].replace(/\r$/, "");
    if (/^\s*(```|~~~)/.test(raw)) { inFence = !inFence; stack.length = 0; continue; }
    if (inFence) continue;
    const t = parseTaskLine(raw);
    if (!t) {
      const b = BULLET_RE.exec(raw);
      if (b) {
        // A plain bullet nested under a task is a detail of the nearest task above it.
        const w = indentWidth(b[1]);
        while (stack.length && stack[stack.length - 1].width >= w) stack.pop();
        const owner = [...stack].reverse().find((s) => s.task)?.task;
        if (owner && b[3].trim()) owner.details.push(b[3].trim());
        stack.push({ width: w, line: i, task: null });
      } else if (raw.trim() !== "") {
        // A non-list, non-blank line ends the list block.
        stack.length = 0;
      }
      continue;
    }
    const w = indentWidth(t.indent);
    while (stack.length && stack[stack.length - 1].width >= w) stack.pop();
    const parentEntry = [...stack].reverse().find((s) => s.task);
    const parentLine = parentEntry ? parentEntry.line : null;
    const ft: FileTask = { ...t, line: i, raw, parentLine, details: [] };
    out.push(ft);
    stack.push({ width: w, line: i, task: ft });
  }
  return out;
}

// ---------- dates (YYYY-MM-DD, calendar arithmetic in UTC) ----------

function toUTC(d: string): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}
function fromUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function addDays(d: string, n: number): string {
  const x = toUTC(d);
  x.setUTCDate(x.getUTCDate() + n);
  return fromUTC(x);
}
/** Monday of the week containing d. */
export function mondayOf(d: string): string {
  const x = toUTC(d);
  const dow = (x.getUTCDay() + 6) % 7; // Mon=0
  return addDays(d, -dow);
}
export function weekday(d: string): number {
  return (toUTC(d).getUTCDay() + 6) % 7;
}
export function daysBetween(a: string, b: string): number {
  return Math.round((toUTC(b).getTime() - toUTC(a).getTime()) / 86400000);
}
export function localToday(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
