import { ItemView, Scope, WorkspaceLeaf, setIcon } from "obsidian";
import { addDays, localToday, mondayOf, formatMinutes, tagFor } from "../tasks";
import { VTask } from "../store";
import {
  openOn, doneOn, overdue, waiting, inProject, inbox, estimateTotal, hm, EnergyFilter, sortTasks, SORT_LABELS, SortMode,
  later, isImportant, isUrgent, matrixTasks,
} from "../queries";
import { renderList, dropZone, captureBox, carryOverTray } from "./render";
import type NowAndNextPlugin from "../main";
import type { Zoom } from "../settings";

export const PLANNER_VIEW = "now-and-next-planner";
// The view switcher, left to right; Cmd +/- zooms between Day, Week and Month.
const VIEWS: [Zoom, string][] = [["matrix", "Triage"], ["focus", "Focus"], ["day", "Day"], ["week", "Week"], ["month", "Month"]];
const ZOOMS: Zoom[] = ["day", "week", "month"];

export class PlannerView extends ItemView {
  zoom: Zoom;
  anchor = localToday();
  tab = "";
  private skipped: string[] = [];
  private beforeFocus: Zoom = "week";

  constructor(leaf: WorkspaceLeaf, private plugin: NowAndNextPlugin) {
    super(leaf);
    this.zoom = plugin.settings.defaultZoom;
    if (this.zoom === "focus" && !plugin.on("focus")) this.zoom = "week";
    this.scope = new Scope(this.app.scope);
    this.scope.register(["Mod"], "=", () => { this.zoomBy(-1); return false; });
    this.scope.register(["Mod"], "-", () => { this.zoomBy(1); return false; });
  }

  getViewType() { return PLANNER_VIEW; }
  getDisplayText() { return "Now & Next"; }
  getIcon() { return "calendar-check"; }

  async onOpen() {
    this.registerEvent(this.plugin.store.on("changed", () => this.render()));
    this.registerInterval(window.setInterval(() => { if (this.zoom === "focus") this.render(); }, 60_000));
    this.render();
  }

  zoomBy(dir: number) {
    const cur = ZOOMS.indexOf(this.zoom);
    if (cur < 0) return;
    this.zoom = ZOOMS[Math.min(2, Math.max(0, cur + dir))];
    this.render();
  }

  setView(z: Zoom) {
    if (z === "focus" && this.zoom !== "focus") this.beforeFocus = this.zoom;
    this.zoom = z;
    this.skipped = [];
    this.render();
  }

  setFocus(on: boolean) {
    if (on && this.plugin.on("focus")) this.setView("focus");
    else if (!on && this.zoom === "focus") this.setView(this.beforeFocus);
  }

  private get filter(): EnergyFilter { return this.plugin.on("energy") ? this.plugin.settings.energyFilter : "all"; }

  render() {
    const root = this.contentEl;
    root.empty();
    root.addClass("nn-root");
    if (!this.plugin.store.isReady()) { root.createDiv({ cls: "nn-empty", text: "Reading your tasks…" }); return; }

    this.renderHeader(root);
    if (this.zoom === "focus") { this.renderFocus(root); return; }
    const tasks = this.plugin.store.tasks;
    const today = localToday();

    const top = root.createDiv({ cls: "nn-top" });
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
    else if (this.zoom === "month") this.renderMonth(body);
    else this.renderMatrix(body);

    // Triage already holds every open task, so the area tabs would only repeat it.
    if (this.zoom !== "matrix") this.renderTabs(root);
    this.renderLater(root);
  }

  // ---------- header ----------

  private renderHeader(root: HTMLElement) {
    const s = this.plugin.settings;
    const h = root.createDiv({ cls: "nn-header" });

    const dated = this.zoom === "day" || this.zoom === "week" || this.zoom === "month";
    const nav = h.createDiv({ cls: "nn-nav" });
    if (!dated) nav.addClass("is-hidden");
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
    for (const [z, label] of VIEWS) {
      if (z === "focus" && !this.plugin.on("focus")) continue;
      const b = zoom.createEl("button", { text: label });
      if (z === this.zoom) b.addClass("is-active");
      b.addEventListener("click", () => this.setView(z));
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
    textBtn(tools, "info", "Key", () => this.plugin.openKey());
    textBtn(tools, "refresh-cw", "Reload", () => this.plugin.reloadApp());
  }

  private title(): string {
    const a = new Date(this.anchor + "T00:00:00");
    if (this.zoom === "day") return a.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
    if (this.zoom === "month") return a.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    if (this.zoom === "focus") return "Today";
    if (this.zoom === "matrix") return "Triage";
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
    const est = this.plugin.on("estimates") ? estimateTotal(open) : 0;
    if (over || est) {
      const meta = head.createDiv({ cls: "nn-day-meta" });
      if (over) {
        col.addClass("is-over");
        meta.createSpan({ text: `${open.length}/${s.dailyCap}` });
        const btn = meta.createEl("button", { cls: "nn-over-btn", text: "Move extras on" });
        btn.addEventListener("click", async () => {
          for (const t of open.slice(s.dailyCap)) await this.plugin.actions.schedule(t, addDays(day, 1));
        });
      }
      if (est) {
        const avail = Math.max(0, hm(s.dayEnd) - hm(s.dayStart));
        const e = meta.createSpan({ cls: "nn-est", text: `~${formatMinutes(est)} of ${formatMinutes(avail)}` });
        if (est > avail) e.addClass("is-over");
      }
    }

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
        cell.createDiv({ cls: "nn-month-num", text: String(Number(day.slice(8))) });
        const open = openOn(tasks, day, this.filter);
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

  // ---------- bottom tabs: diary and areas ----------

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
      diary: inbox(tasks, (t) => store.isInDailyFolder(t), this.filter),
    };
    for (const p of projects) lists[p] = inProject(tasks, p, this.filter);
    // When the daily notes folder is itself an area, its area tab replaces the separate Diary tab.
    const dailyIsArea = store.dailyArea() !== null;
    if (dailyIsArea && this.tab === "diary") this.tab = store.dailyArea()!;
    // Diary comes first, then the other areas.
    const dailyTab: [string, string] = dailyIsArea ? [store.dailyArea()!, cap(store.dailyArea()!)] : ["diary", "Diary"];
    const others = projects.filter((p) => p !== store.dailyArea()).map((p) => [p, cap(p)] as [string, string]);
    const names: [string, string][] = [dailyTab, ...others];
    if (!names.some(([k]) => k === this.tab)) this.tab = dailyTab[0];
    bar.createSpan({ cls: "nn-tabs-label", text: "Areas" });
    for (const [key, label] of names) {
      const b = bar.createEl("button", { cls: "nn-tab" });
      b.createSpan({ text: label });
      if (lists[key].length) b.createSpan({ cls: "nn-tab-count", text: String(lists[key].length) });
      if (key === this.tab) b.addClass("is-active");
      b.addEventListener("click", () => { this.tab = key; this.render(); });
      // Dropping on a tab takes the task off its day and back to that list.
      dropZone(b, this.plugin, async (t) => {
        await this.plugin.actions.schedule(t, null);
        if (projects.includes(key) && key !== store.dailyArea() && t.project !== key) {
          const fresh = this.plugin.store.get(t.key);
          if (fresh) await this.plugin.actions.moveToArea(fresh, key);
        }
      });
    }
    const hintRow = panel.createDiv({ cls: "nn-panel-row" });
    const hint = hintRow.createDiv({ cls: "nn-panel-hint" });
    const sortWrap = hintRow.createDiv({ cls: "nn-sort" });
    sortWrap.createSpan({ cls: "nn-seg-label", text: "Sort" });
    const sel = sortWrap.createEl("select", { cls: "dropdown" });
    for (const [k, label] of Object.entries(SORT_LABELS)) {
      const o = sel.createEl("option", { text: label, value: k });
      if (k === this.plugin.settings.sortBy) o.selected = true;
    }
    sel.addEventListener("change", async () => {
      this.plugin.settings.sortBy = sel.value as SortMode;
      await this.plugin.saveSettings();
    });
    hint.setText(this.tab === "diary" ? "Undated tasks from your daily notes that have no area yet. Drag one onto a day or an area."
      : `Undated tasks in ${this.plugin.settings.projectsFolder}/${this.tab} or tagged #${tagFor(this.tab)}.`);
    const list = panel.createDiv({ cls: "nn-panel-list" });
    renderList(this.plugin, list, sortTasks(lists[this.tab], this.plugin.settings.sortBy), "Nothing here.", { hideProject: this.tab });
    // The one capture box in the planner sits at the base of the tab list.
    {
      const isDiary = this.tab === "diary" || this.tab === this.plugin.store.dailyArea();
      captureBox(this.plugin, panel, isDiary
        ? { lines: 2 }
        : { placeholder: `+ Add to ${cap(this.tab)} (Enter saves to today's note)`, tag: this.projectTag() });
    }
  }

  // ---------- triage (importance x urgency) ----------

  private renderMatrix(body: HTMLElement) {
    const today = localToday();
    const all = matrixTasks(this.plugin.store.tasks, this.filter);
    const grid = body.createDiv({ cls: "nn-matrix" });
    const boxes: { title: string; hint: string; imp: boolean; urg: boolean }[] = [
      { title: "Do", hint: "Important and urgent", imp: true, urg: true },
      { title: "Plan", hint: "Important, not urgent", imp: true, urg: false },
      { title: "Quick", hint: "Urgent, not important", imp: false, urg: true },
      { title: "Not now", hint: "Neither", imp: false, urg: false },
    ];
    for (const bx of boxes) {
      const list = all.filter((t) => isImportant(t) === bx.imp && isUrgent(t, today) === bx.urg);
      const cell = grid.createDiv({ cls: "nn-matrix-box" });
      const head = cell.createDiv({ cls: "nn-matrix-head" });
      head.createSpan({ cls: "nn-matrix-title", text: bx.title });
      head.createSpan({ cls: "nn-matrix-hint", text: `${bx.hint}${list.length ? ` · ${list.length}` : ""}` });
      const inner = cell.createDiv({ cls: "nn-matrix-list" });
      renderList(this.plugin, inner, sortTasks(list, this.plugin.settings.sortBy), "Nothing here.");
      dropZone(cell, this.plugin, async (t) => {
        if (isImportant(t) !== bx.imp) await this.plugin.actions.priority(t, bx.imp ? "high" : "none");
        const fresh = this.plugin.store.get(t.key) ?? t;
        const hasTag = fresh.tags.some((x) => x.toLowerCase() === "urgent");
        if (bx.urg && !isUrgent(fresh, today)) await this.plugin.actions.urgent(fresh, true);
        if (!bx.urg && hasTag) await this.plugin.actions.urgent(fresh, false);
      });
    }
    body.createDiv({ cls: "nn-panel-hint", text: "Undated tasks. Important: 🔺 or ⏫. Urgent: a deadline within 7 days, or #urgent. Drag between boxes to change either; drag onto Week or Day later to give it a day." });
  }

  // ---------- later (hidden by default) ----------

  private renderLater(root: HTMLElement) {
    const list = later(this.plugin.store.tasks, this.filter);
    const det = root.createEl("details", { cls: "nn-later" });
    const sum = det.createEl("summary");
    sum.createSpan({ text: "Later" });
    if (list.length) sum.createSpan({ cls: "nn-tab-count", text: ` ${list.length}` });
    det.createDiv({ cls: "nn-panel-hint", text: "Tagged #later, or deferred to a later month. Drop a task here to move it to Later." });
    const inner = det.createDiv({ cls: "nn-panel-list" });
    renderList(this.plugin, inner, sortTasks(list, this.plugin.settings.sortBy), "Nothing here.");
    dropZone(det, this.plugin, (t) => this.plugin.actions.toLater(t));
  }

  // ---------- focus mode ----------

  private renderFocus(root: HTMLElement) {
    const today = localToday();
    const all = openOn(this.plugin.store.tasks, today, this.filter);
    const queue = [...all.filter((t) => !this.skipped.includes(t.key)), ...all.filter((t) => this.skipped.includes(t.key))];
    const wrap = root.createDiv({ cls: "nn-focus" });

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
function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }
function toStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
