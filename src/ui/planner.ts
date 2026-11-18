import { ItemView, Scope, WorkspaceLeaf, setIcon } from "obsidian";
import { addDays, localToday, mondayOf, formatMinutes } from "../tasks";
import { VTask } from "../store";
import {
  openOn, doneOn, overdue, waiting, priorities, inProject, inbox, estimateTotal, stats, hm, EnergyFilter,
} from "../queries";
import { renderTask, renderList, dropZone, timeLeftBar, captureBox, carryOverTray } from "./render";
import type NowAndNextPlugin from "../main";
import type { Zoom } from "../settings";

export const PLANNER_VIEW = "now-and-next-planner";
const ZOOMS: Zoom[] = ["day", "week", "month"];

export class PlannerView extends ItemView {
  zoom: Zoom;
  anchor = localToday();
  tab = "";
  focus = false;
  private skipped: string[] = [];

  constructor(leaf: WorkspaceLeaf, private plugin: NowAndNextPlugin) {
    super(leaf);
    this.zoom = plugin.settings.defaultZoom;
    this.scope = new Scope(this.app.scope);
    this.scope.register(["Mod"], "=", () => { this.zoomBy(-1); return false; });
    this.scope.register(["Mod"], "-", () => { this.zoomBy(1); return false; });
  }

  getViewType() { return PLANNER_VIEW; }
  getDisplayText() { return "Now & Next"; }
  getIcon() { return "calendar-check"; }

  async onOpen() {
    this.registerEvent(this.plugin.store.on("changed", () => this.render()));
    this.registerInterval(window.setInterval(() => { if (this.zoom === "day" || this.focus) this.render(); }, 60_000));
    this.render();
  }

  zoomBy(dir: number) {
    const i = Math.min(2, Math.max(0, ZOOMS.indexOf(this.zoom) + dir));
    this.zoom = ZOOMS[i];
    this.render();
  }

  setFocus(on: boolean) { this.focus = on && this.plugin.on("focus"); this.skipped = []; this.render(); }

  private get filter(): EnergyFilter { return this.plugin.on("energy") ? this.plugin.settings.energyFilter : "all"; }

  render() {
    const root = this.contentEl;
    root.empty();
    root.addClass("nn-root");
    root.toggleClass("nn-calm", this.plugin.settings.calm);
    if (!this.plugin.store.isReady()) { root.createDiv({ cls: "nn-empty", text: "Reading your tasks…" }); return; }
    if (this.focus) { this.renderFocus(root); return; }

    this.renderHeader(root);
    const tasks = this.plugin.store.tasks;
    const today = localToday();

    const top = root.createDiv({ cls: "nn-top" });
    if (this.plugin.on("capture")) captureBox(this.plugin, top, { lines: 2 });
    if (this.plugin.on("carryOver")) carryOverTray(this.plugin, top, overdue(tasks, today, this.filter));
    const w = waiting(tasks);
    if (w.length) {
      const d = top.createEl("details", { cls: "nn-waiting" });
      d.createEl("summary", { text: `Waiting on others (${w.length})` });
      renderList(this.plugin, d, w, "", { showDate: true });
    }

    const body = root.createDiv({ cls: "nn-body" });
    if (this.zoom === "day") this.renderDay(body, this.anchor);
    else if (this.zoom === "week") this.renderWeek(body);
    else this.renderMonth(body);

    this.renderTabs(root);
  }

  // ---------- header ----------

  private renderHeader(root: HTMLElement) {
    const s = this.plugin.settings;
    const h = root.createDiv({ cls: "nn-header" });

    const nav = h.createDiv({ cls: "nn-nav" });
    const step = this.zoom === "day" ? 1 : this.zoom === "week" ? 7 : 0;
    const move = (dir: number) => {
      if (step) this.anchor = addDays(this.anchor, dir * step);
      else { const d = new Date(this.anchor + "T00:00:00"); d.setMonth(d.getMonth() + dir, 1); this.anchor = toStr(d); }
      this.render();
    };
    iconBtn(nav, "chevron-left", "Previous", () => move(-1));
    nav.createEl("button", { text: "Today", cls: "nn-today-btn" }).addEventListener("click", () => { this.anchor = localToday(); this.render(); });
    iconBtn(nav, "chevron-right", "Next", () => move(1));
    nav.createDiv({ cls: "nn-title", text: this.title() });

    const zoom = h.createDiv({ cls: "nn-seg" });
    for (const z of ZOOMS) {
      const b = zoom.createEl("button", { text: z[0].toUpperCase() + z.slice(1) });
      if (z === this.zoom) b.addClass("is-active");
      b.addEventListener("click", () => { this.zoom = z; this.render(); });
    }

    if (this.plugin.on("energy")) {
      const energy = h.createDiv({ cls: "nn-seg nn-energy-filter" });
      energy.createSpan({ cls: "nn-seg-label", text: "Energy" });
      for (const [k, label] of [["all", "Any"], ["low", "Low"], ["mid", "Med"], ["high", "High"]] as const) {
        const b = energy.createEl("button", { text: label });
        if (s.energyFilter === k) b.addClass("is-active");
        b.addEventListener("click", async () => { s.energyFilter = k; await this.plugin.saveSettings(); });
      }
    }

    const tools = h.createDiv({ cls: "nn-tools" });
    if (this.plugin.on("focus")) textBtn(tools, "target", "Focus", () => this.setFocus(true));
    if (this.plugin.on("talk")) textBtn(tools, "mic", "Talk it through", () => this.plugin.talkItThrough());
    if (this.plugin.on("weeklyReview")) textBtn(tools, "list-checks", "Weekly review", () => this.plugin.openReview());
    textBtn(tools, "info", "Key", () => this.plugin.openKey());
    textBtn(tools, "refresh-cw", "Reload", () => this.plugin.reloadApp());
    if (this.plugin.on("calm")) {
      const calm = textBtn(tools, s.calm ? "eye" : "eye-off", s.calm ? "Show details" : "Calm view", async () => {
        s.calm = !s.calm; await this.plugin.saveSettings();
      });
      calm.toggleClass("is-active", s.calm);
    }

    if (!s.calm) {
      const st = stats(this.plugin.store.tasks, localToday());
      const box = h.createDiv({ cls: "nn-stats" });
      stat(box, "This week", `${st.thisWeek.pct}%`, `${st.thisWeek.done} of ${st.thisWeek.planned} done`);
      stat(box, "Last 4 weeks", `${st.avg}%`, "average done");
      stat(box, "Streak", `${st.streak}`, st.streak === 1 ? "week with wins" : "weeks with wins");
    }
  }

  private title(): string {
    const a = new Date(this.anchor + "T00:00:00");
    if (this.zoom === "day") return a.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
    if (this.zoom === "month") return a.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    const mon = mondayOf(this.anchor);
    const last = addDays(mon, this.plugin.settings.showWeekend ? 6 : 4);
    const f = (d: string) => new Date(d + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" });
    return `${f(mon)} – ${f(last)}`;
  }

  // ---------- day / week ----------

  private dayColumn(parent: HTMLElement, day: string, wide: boolean) {
    const s = this.plugin.settings;
    const today = localToday();
    const tasks = this.plugin.store.tasks;
    const col = parent.createDiv({ cls: "nn-day" });
    if (day === today) col.addClass("is-today");
    if (day < today) col.addClass("is-past");

    const head = col.createDiv({ cls: "nn-day-head" });
    const d = new Date(day + "T00:00:00");
    const name = head.createDiv({ cls: "nn-day-name" });
    name.createSpan({ text: d.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase() + " " });
    name.createSpan({ cls: "nn-day-num", text: String(d.getDate()) });
    if (!wide) name.addEventListener("click", () => { this.anchor = day; this.zoom = "day"; this.render(); });

    let open = openOn(tasks, day, this.filter);
    // With carry-over off, unfinished tasks from past days sit on today.
    if (day === today && !this.plugin.on("carryOver")) open = [...overdue(tasks, today, this.filter), ...open];
    const done = doneOn(tasks, day);
    const capOn = this.plugin.on("dailyCap");
    const over = capOn && open.length > s.dailyCap;
    if (!s.calm || over) {
      const meta = head.createDiv({ cls: "nn-day-meta" });
      if (!s.calm) meta.createSpan({ text: capOn ? `${open.length}/${s.dailyCap}` : `${open.length}` });
      if (over) {
        col.addClass("is-over");
        const btn = meta.createEl("button", { cls: "nn-over-btn", text: "Over your cap · move extras on" });
        btn.addEventListener("click", async () => {
          for (const t of open.slice(s.dailyCap)) await this.plugin.actions.schedule(t, addDays(day, 1));
        });
      }
      const est = estimateTotal(open);
      if (est && !s.calm && this.plugin.on("estimates")) {
        const avail = Math.max(0, hm(s.dayEnd) - hm(s.dayStart));
        const e = meta.createSpan({ cls: "nn-est", text: `~${formatMinutes(est)} of ${formatMinutes(avail)}` });
        if (est > avail) e.addClass("is-over");
      }
    }

    if (wide && day === today && this.plugin.on("visibleTime")) timeLeftBar(this.plugin, col);

    const list = col.createDiv({ cls: "nn-day-list" });
    renderList(this.plugin, list, open, day < today ? "" : "Nothing planned");
    dropZone(col, this.plugin, (t) => this.plugin.actions.schedule(t, day));

    if (day >= today) captureBox(this.plugin, col, { placeholder: "+ Add", scheduled: day, tag: this.projectTag() });

    if (done.length && this.plugin.on("doneList")) {
      const det = col.createEl("details", { cls: "nn-done" });
      if (wide) det.open = true;
      det.createEl("summary", { text: `Done (${done.length})` });
      renderList(this.plugin, det, done, "");
    }
  }

  private renderDay(body: HTMLElement, day: string) {
    const wrap = body.createDiv({ cls: "nn-dayview" });
    this.dayColumn(wrap, day, true);
  }

  private renderWeek(body: HTMLElement) {
    const mon = mondayOf(this.anchor);
    const n = this.plugin.settings.showWeekend ? 7 : 5;
    const wrap = body.createDiv({ cls: "nn-week" });
    wrap.style.setProperty("--nn-cols", String(n));
    for (let i = 0; i < n; i++) this.dayColumn(wrap, addDays(mon, i), false);
  }

  private renderMonth(body: HTMLElement) {
    const tasks = this.plugin.store.tasks;
    const today = localToday();
    const first = this.anchor.slice(0, 8) + "01";
    const month = first.slice(0, 7);
    let cur = mondayOf(first);
    const grid = body.createDiv({ cls: "nn-month" });
    for (const label of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) grid.createDiv({ cls: "nn-month-head", text: label });
    do {
      for (let i = 0; i < 7; i++) {
        const day = cur;
        const cell = grid.createDiv({ cls: "nn-month-cell" });
        if (!day.startsWith(month)) cell.addClass("is-other");
        if (day === today) cell.addClass("is-today");
        const top = cell.createDiv({ cls: "nn-month-num", text: String(Number(day.slice(8))) });
        const open = openOn(tasks, day, this.filter);
        const done = doneOn(tasks, day);
        if (done.length && !this.plugin.settings.calm && this.plugin.on("doneList")) top.createSpan({ cls: "nn-month-done", text: ` ✓${done.length}` });
        for (const t of open.slice(0, 3)) {
          const r = cell.createDiv({ cls: "nn-month-task", text: t.text });
          r.draggable = true;
          r.addEventListener("dragstart", (e) => e.dataTransfer?.setData("text/x-now-and-next", t.key));
          r.addEventListener("click", (e) => { e.stopPropagation(); void this.plugin.actions.open(t); });
        }
        if (open.length > 3) cell.createDiv({ cls: "nn-month-more", text: `+${open.length - 3} more` });
        if (this.plugin.on("dailyCap") && open.length > this.plugin.settings.dailyCap) cell.addClass("is-over");
        cell.addEventListener("click", () => { this.anchor = day; this.zoom = "day"; this.render(); });
        dropZone(cell, this.plugin, (t) => this.plugin.actions.schedule(t, day));
        cur = addDays(cur, 1);
      }
    } while (cur.slice(0, 7) === month);
  }

  // ---------- bottom tabs: priorities, inbox, projects ----------

  private projectTag(): string | undefined {
    // No tag needed when the area is the daily notes folder itself: new tasks land there anyway.
    if (this.tab === this.plugin.store.dailyArea()) return undefined;
    return this.plugin.store.projects().includes(this.tab) ? this.tab : undefined;
  }

  private renderTabs(root: HTMLElement) {
    const store = this.plugin.store;
    const tasks = store.tasks;
    const projects = store.projects();


    const panel = root.createDiv({ cls: "nn-panel" });
    const bar = panel.createDiv({ cls: "nn-tabs" });
    const lists: Record<string, VTask[]> = {
      priorities: priorities(tasks, this.filter),
      diary: inbox(tasks, (t) => store.isInDailyFolder(t), this.filter),
    };
    for (const p of projects) lists[p] = inProject(tasks, p, this.filter);
    // When the daily notes folder is itself an area, its area tab replaces the separate Diary tab.
    const dailyIsArea = store.dailyArea() !== null;
    if (dailyIsArea && this.tab === "diary") this.tab = store.dailyArea()!;
    // Diary comes first, then Priorities, then the other areas.
    const dailyTab: [string, string] = dailyIsArea ? [store.dailyArea()!, cap(store.dailyArea()!)] : ["diary", "Diary"];
    const others = projects.filter((p) => p !== store.dailyArea()).map((p) => [p, cap(p)] as [string, string]);
    const names: [string, string][] = [dailyTab, ["priorities", "Priorities"], ...others];
    if (!names.some(([k]) => k === this.tab)) this.tab = dailyTab[0];
    bar.createSpan({ cls: "nn-tabs-label", text: "Areas" });
    for (const [key, label] of names) {
      const b = bar.createEl("button", { cls: "nn-tab" });
      b.createSpan({ text: label });
      if (!this.plugin.settings.calm && lists[key].length) b.createSpan({ cls: "nn-tab-count", text: String(lists[key].length) });
      if (key === this.tab) b.addClass("is-active");
      b.addEventListener("click", () => { this.tab = key; this.render(); });
      // Dropping on a tab takes the task off its day and back to that list.
      dropZone(b, this.plugin, async (t) => {
        await this.plugin.actions.schedule(t, null);
        if (projects.includes(key) && key !== store.dailyArea() && t.project !== key) {
          const fresh = this.plugin.store.get(t.key);
          if (fresh) await this.plugin.actions.tag(fresh, key);
        }
        if (key === "priorities" && t.priority !== "highest" && t.priority !== "high") {
          const fresh = this.plugin.store.get(t.key);
          if (fresh) await this.plugin.actions.priority(fresh, "high");
        }
      });
    }
    const hint = panel.createDiv({ cls: "nn-panel-hint" });
    hint.setText(this.tab === "priorities" ? "Undated tasks marked 🔺 or ⏫. Drag one onto a day to plan it."
      : this.tab === "diary" ? "Undated tasks from your daily notes that have no area yet. Drag one onto a day or an area."
      : `Undated tasks in ${this.plugin.settings.projectsFolder}/${this.tab} or tagged #${this.tab}.`);
    const list = panel.createDiv({ cls: "nn-panel-list" });
    renderList(this.plugin, list, lists[this.tab], "Nothing here.", { hideProject: this.tab });
    if (this.tab !== "priorities") captureBox(this.plugin, panel, { placeholder: `+ Add to ${cap(this.tab)}`, tag: this.projectTag() });
  }

  // ---------- focus mode ----------

  private renderFocus(root: HTMLElement) {
    const today = localToday();
    const all = openOn(this.plugin.store.tasks, today, this.filter);
    const queue = [...all.filter((t) => !this.skipped.includes(t.key)), ...all.filter((t) => this.skipped.includes(t.key))];
    const wrap = root.createDiv({ cls: "nn-focus" });
    const top = wrap.createDiv({ cls: "nn-focus-top" });
    top.createEl("button", { text: "Exit focus" }).addEventListener("click", () => this.setFocus(false));
    if (this.plugin.on("visibleTime")) timeLeftBar(this.plugin, wrap);

    if (!queue.length) {
      wrap.createDiv({ cls: "nn-focus-empty", text: "Nothing left for today." });
      const done = doneOn(this.plugin.store.tasks, today);
      if (done.length) wrap.createDiv({ cls: "nn-focus-sub", text: `You finished ${done.length} ${done.length === 1 ? "thing" : "things"} today.` });
      return;
    }
    const [now, next] = queue;
    wrap.createDiv({ cls: "nn-focus-label", text: "NOW" });
    const card = wrap.createDiv({ cls: "nn-focus-card" });
    card.createDiv({ cls: "nn-focus-text", text: now.text });
    if (now.children.length) {
      const kids = card.createDiv({ cls: "nn-subtasks" });
      for (const c of now.children) renderTask(this.plugin, kids, c, { nested: true });
    }
    const btns = card.createDiv({ cls: "nn-focus-btns" });
    const b = (label: string, fn: () => unknown, cta = false) => {
      const el = btns.createEl("button", { text: label });
      if (cta) el.addClass("mod-cta");
      el.addEventListener("click", () => void fn());
    };
    b("Done", () => this.plugin.actions.toggleDone(now), true);
    if (this.plugin.on("timer")) b(`Timer ${this.plugin.settings.timerMinutes} min`, () => this.plugin.timer.start(now.text));
    if (this.plugin.on("firstStep")) b("First step…", () => this.plugin.actions.promptFirstStep(now));
    b("Not now", () => { this.skipped.push(now.key); this.render(); });
    if (next) {
      wrap.createDiv({ cls: "nn-focus-label", text: "NEXT" });
      wrap.createDiv({ cls: "nn-focus-next", text: next.text });
    }
    if (queue.length > 2) wrap.createDiv({ cls: "nn-focus-sub", text: `and ${queue.length - 2} more after that` });
  }
}

// ---------- small helpers ----------

function iconBtn(parent: HTMLElement, icon: string, label: string, fn: () => unknown) {
  const b = parent.createEl("button", { cls: "clickable-icon nn-icon-btn" });
  setIcon(b, icon);
  b.setAttr("aria-label", label);
  b.addEventListener("click", () => void fn());
  return b;
}
function textBtn(parent: HTMLElement, icon: string, label: string, fn: () => unknown) {
  const b = parent.createEl("button", { cls: "nn-text-btn" });
  setIcon(b.createSpan({ cls: "nn-btn-icon" }), icon);
  b.createSpan({ text: label });
  b.addEventListener("click", () => void fn());
  return b;
}
function stat(parent: HTMLElement, label: string, value: string, sub: string) {
  const s = parent.createDiv({ cls: "nn-stat" });
  s.createDiv({ cls: "nn-stat-label", text: label });
  s.createDiv({ cls: "nn-stat-value", text: value });
  s.createDiv({ cls: "nn-stat-sub", text: sub });
}
function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }
function toStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
