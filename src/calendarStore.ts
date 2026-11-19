import { Events, normalizePath, requestUrl } from "obsidian";
import type NowAndNextPlugin from "./main";
import { CalEvent, expandEvents } from "./calendar";

interface Cached { ics: string; fetchedAt: number }

/**
 * Fetches the calendar links from settings, keeps the last good copy of each
 * (in memory and in calendar-cache.json in the plugin folder) and hands out events per day.
 */
export class CalendarStore extends Events {
  private raw: Record<string, Cached> = {};
  private months = new Map<string, Map<string, CalEvent[]>>();
  /** Names of calendars that could not be reached on the last refresh. */
  failed: string[] = [];
  private plugin: NowAndNextPlugin;

  constructor(plugin: NowAndNextPlugin) {
    super();
    this.plugin = plugin;
  }

  private get cachePath(): string {
    return normalizePath(`${this.plugin.manifest.dir ?? ""}/calendar-cache.json`);
  }

  private links() {
    return this.plugin.settings.calendars.filter((c) => c.url.trim());
  }

  async init() {
    try {
      const a = this.plugin.app.vault.adapter;
      if (await a.exists(this.cachePath)) this.raw = JSON.parse(await a.read(this.cachePath));
    } catch { this.raw = {}; }
    this.changed();
    await this.refresh();
  }

  async refresh() {
    const cals = this.links();
    const failed: string[] = [];
    await Promise.all(cals.map(async (c) => {
      const url = c.url.trim().replace(/^webcal:/i, "https:");
      try {
        const r = await requestUrl({ url, throw: false });
        if (r.status >= 200 && r.status < 300 && r.text.includes("BEGIN:VCALENDAR")) {
          this.raw[c.url.trim()] = { ics: r.text, fetchedAt: Date.now() };
        } else failed.push(c.name || "a calendar");
      } catch { failed.push(c.name || "a calendar"); }
    }));
    // Forget copies of links that were removed from settings.
    const keep = new Set(cals.map((c) => c.url.trim()));
    for (const k of Object.keys(this.raw)) if (!keep.has(k)) delete this.raw[k];
    this.failed = failed;
    try { await this.plugin.app.vault.adapter.write(this.cachePath, JSON.stringify(this.raw)); } catch { /* cache is optional */ }
    this.changed();
  }

  private changed() {
    this.months.clear();
    this.trigger("changed");
  }

  /** Events on one local day, all calendars together, all-day first, then by time. */
  eventsOn(day: string): CalEvent[] {
    const m = day.slice(0, 7);
    let byDay = this.months.get(m);
    if (!byDay) {
      byDay = new Map();
      const first = `${m}-01`;
      const d = new Date(first + "T00:00:00");
      d.setMonth(d.getMonth() + 1, 0);
      const last = `${m}-${String(d.getDate()).padStart(2, "0")}`;
      const all: CalEvent[] = [];
      for (const c of this.links()) {
        const cached = this.raw[c.url.trim()];
        if (!cached) continue;
        try { all.push(...expandEvents(cached.ics, c.name, first, last)); } catch { /* unreadable feed: shown as nothing */ }
      }
      all.sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title));
      for (const e of all) {
        const list = byDay.get(e.day);
        if (list) list.push(e); else byDay.set(e.day, [e]);
      }
      this.months.set(m, byDay);
    }
    return byDay.get(day) ?? [];
  }
}
