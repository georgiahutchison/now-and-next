import { ItemView, Scope, WorkspaceLeaf, setIcon } from "obsidian";
import { addDays, daysBetween, localToday, mondayOf, formatMinutes, tagFor, ENERGY_EMOJI, PRIORITY_RANK } from "../tasks";
import { habits, monthSpan } from "../habits";
import { Goal, goals, numbers, byArea, isMilestone, isOpenStatus, daysLeftLabel, GoalNumbers, span, dayRange } from "../goals";
import { VTask, planDate } from "../store";
import { applyOrder, placeBefore, moveExtrasOn } from "../order";
import {
  openOn, doneOn, overdue, waiting, inProject, inbox, estimateTotal, hm, EnergyFilter, sortTasks, SORT_LABELS, SortMode,
  later, routines, isImportant, isUrgent, matrixTasks,
} from "../queries";
import { renderList, renderTask, dropZone, captureBox, carryOverTray, checkInCard, phasePrompt, shortDate, DRAG_TYPE, AREA_DRAG_TYPE, ENERGY_DRAG_TYPE } from "./render";
import type NowAndNextPlugin from "../main";
import type { Zoom } from "../settings";

export const PLANNER_VIEW = "now-and-next-planner";
// The view switcher: Focus, Triage, Plan, Goals, Habits. Plan's span (1, 3, 7 days or Month) sits by the date;
// Cmd +/- steps through the spans.
const ZOOMS: Zoom[] = ["day", "three", "week", "month"];
const SPANS: [Zoom, string, string][] = [["day", "1", "One day"], ["three", "3", "Yesterday, today and tomorrow"], ["week", "7", "Week"], ["month", "Month", "Month"]];
const isDated = (z: Zoom) => ZOOMS.includes(z);

export class PlannerView extends ItemView {
  zoom: Zoom;
  anchor = localToday();
  tab = "";
  private skipped: string[] = [];
  private beforeFocus: Zoom = "week";
  /** Area shown in Triage ("" = all). */
  private triageArea = "";
  /** The span Plan returns to after Triage or Focus. */
  private planSpan: Zoom = "week";
  /** First day shown in the Gantt (a Monday); arrows move it a week. */
  private ganttFrom = mondayOf(localToday());
  /** Milestones whose task rows are unfolded in the Gantt. */
  private ganttOpen = new Set<string>();

  constructor(leaf: WorkspaceLeaf, private plugin: NowAndNextPlugin) {
    super(leaf);
    this.zoom = plugin.settings.defaultZoom;
    if (isDated(this.zoom)) this.planSpan = this.zoom;
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
    this.registerEvent(this.plugin.calendars.on("changed", () => { if (isDated(this.zoom)) this.render(); }));
    this.registerInterval(window.setInterval(() => { if (this.zoom === "focus") this.render(); }, 60_000));
    this.render();
  }

  zoomBy(dir: number) {
    const cur = ZOOMS.indexOf(this.zoom);
    if (cur < 0) return;
    this.zoom = ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, cur + dir))];
    this.planSpan = this.zoom;
    this.render();
  }

  setView(z: Zoom) {
    if (z === "focus" && this.zoom !== "focus") this.beforeFocus = this.zoom;
    if (isDated(z)) this.planSpan = z;
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
    if (this.zoom === "habits") { this.renderHabits(root); return; }
    if (this.zoom === "goals") { this.renderGoals(root); return; }
    const tasks = this.plugin.store.tasks;
    const today = localToday();

    const top = root.createDiv({ cls: "nn-top" });
    checkInCard(this.plugin, top);
    phasePrompt(this.plugin, top);
    if (this.filter !== "all") {
      const f = top.createDiv({ cls: "nn-filter-note" });
      f.createSpan({ text: `Showing ${({ low: "low", mid: "medium", high: "high" } as const)[this.filter]}-energy tasks only. ` });
      const b = f.createEl("button", { text: "Show all" });
      b.addEventListener("click", async () => { this.plugin.settings.energyFilter = "all"; await this.plugin.saveSettings(); });
    }
    if (this.plugin.on("carryOver")) carryOverTray(this.plugin, top, overdue(tasks, today, this.filter));
    const w = waiting(tasks);
    if (w.length) {
      const d = top.createEl("details", { cls: "nn-waiting" });
      d.createEl("summary", { text: `Waiting on others (${w.length})` });
      renderList(this.plugin, d, w, "", { showDate: true });
    }

    const failed = this.plugin.calendars.failed;
    if (failed.length && isDated(this.zoom)) {
      top.createDiv({ cls: "nn-cal-note", text: `Couldn't reach ${failed.join(", ")}. Showing the last copy fetched.` });
    }

    if (isDated(this.zoom)) this.renderGoalStrip(root);

    const body = root.createDiv({ cls: "nn-body" });
    if (this.zoom === "day") this.renderDay(body, this.anchor);
    else if (this.zoom === "three") this.renderThree(body);
    else if (this.zoom === "week") this.renderWeek(body);
    else if (this.zoom === "month") this.renderMonth(body);
    else this.renderMatrix(body);

    // Triage already holds every open task, so the area tabs would only repeat it.
    if (this.zoom !== "matrix") this.renderTabs(root);
    this.renderLater(root);
    this.renderRoutines(root);
  }

  // ---------- header ----------

  private renderHeader(root: HTMLElement) {
    if (isDated(this.zoom)) this.planSpan = this.zoom; // also when a day name or month cell opened one day
    const s = this.plugin.settings;
    const h = root.createDiv({ cls: "nn-header" });

    // Left: the date and its arrows (blank where a view has no date).
    const left = h.createDiv({ cls: "nn-header-left" });
    const dated = isDated(this.zoom);
    const nav = left.createDiv({ cls: "nn-nav" });
    if (dated) {
      const step = this.zoom === "day" || this.zoom === "three" ? 1 : this.zoom === "week" ? 7 : 0;
      const move = (dir: number) => {
        if (step) this.anchor = addDays(this.anchor, dir * step);
        else { const d = new Date(this.anchor + "T00:00:00"); d.setMonth(d.getMonth() + dir, 1); this.anchor = toStr(d); }
        this.render();
      };
      iconBtn(nav, "chevron-left", "Previous", () => move(-1));
      nav.createEl("button", { text: "Today", cls: "nn-today-btn" }).addEventListener("click", () => { this.anchor = localToday(); this.render(); });
      iconBtn(nav, "chevron-right", "Next", () => move(1));
    }
    nav.createDiv({ cls: "nn-title", text: this.title() });
    if (dated) {
      const span = nav.createDiv({ cls: "nn-seg nn-span" });
      for (const [z, label, tip] of SPANS) {
        const b = span.createEl("button", { text: label, attr: { "aria-label": tip } });
        if (z === this.zoom) b.addClass("is-active");
        b.addEventListener("click", () => this.setView(z));
      }
    }

    // Right: View over Energy, stacked; Key and Reload beside View.
    const right = h.createDiv({ cls: "nn-header-right" });
    const row1 = right.createDiv({ cls: "nn-header-row" });
    const zoom = row1.createDiv({ cls: "nn-seg" });
    zoom.createSpan({ cls: "nn-seg-label", text: "View" });
    const views: [Zoom, string, boolean][] = [
      ["focus", "Focus", this.zoom === "focus"],
      ["matrix", "Triage", this.zoom === "matrix"],
      [this.planSpan, "Plan", isDated(this.zoom)],
      ["goals", "Goals", this.zoom === "goals"],
      ["habits", "Habits", this.zoom === "habits"],
    ];
    for (const [z, label, active] of views) {
      if (z === "focus" && !this.plugin.on("focus")) continue;
      const b = zoom.createEl("button", { text: label });
      if (active) b.addClass("is-active");
      b.addEventListener("click", () => this.setView(z));
    }
    const tools = row1.createDiv({ cls: "nn-tools" });
    iconBtn(tools, "info", "Key", () => this.plugin.openKey());
    iconBtn(tools, "refresh-cw", "Reload", () => void this.plugin.reloadApp());

    // Spoons sit in the Areas row in Plan and Triage; Focus has no Areas row, so they stay up here.
    if (this.plugin.on("energy") && this.zoom === "focus") {
      const row2 = right.createDiv({ cls: "nn-header-row" });
      const energy = row2.createDiv({ cls: "nn-seg nn-energy-filter" });
      energy.createSpan({ cls: "nn-seg-label", text: "Energy" });
      for (const [k, label] of [["all", "Any"], ["low", "🥄"], ["mid", "🥄🥄"], ["high", "🥄🥄🥄"]] as const) {
        const b = energy.createEl("button", { text: label, attr: { "aria-label": ({ all: "Any energy", low: "Low energy", mid: "Medium energy", high: "High energy" } as const)[k] } });
        if (s.energyFilter === k) b.addClass("is-active");
        b.addEventListener("click", async () => { s.energyFilter = k; await this.plugin.saveSettings(); });
      }
      row2.createDiv({ cls: "nn-tools-spacer" });
    }
  }

  private title(): string {
    const a = new Date(this.anchor + "T00:00:00");
    if (this.zoom === "day") return a.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
    if (this.zoom === "month") return a.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    if (this.zoom === "three") {
      const f = (d: string) => new Date(d + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" });
      return `${f(addDays(this.anchor, -1))} to ${f(addDays(this.anchor, 1))}`;
    }
    if (this.zoom === "focus") return "Today";
    if (this.zoom === "matrix") return "Triage";
    if (this.zoom === "habits") return "Habits";
    if (this.zoom === "goals") return "Goals";
    const mon = mondayOf(this.anchor);
    const last = addDays(mon, this.plugin.settings.showWeekend ? 6 : 4);
    const f = (d: string) => new Date(d + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" });
    return `${f(mon)} – ${f(last)}`;
  }

  // ---------- day / week ----------

  private dayColumn(parent: HTMLElement, day: string, wide: boolean, pastAsStrip = true) {
    const s = this.plugin.settings;
    const today = localToday();
    const tasks = this.plugin.store.tasks;
    const col = parent.createDiv({ cls: "nn-day" });
    if (day === today) col.addClass("is-today");
    if (day < today) col.addClass("is-past");

    const head = col.createDiv({ cls: "nn-day-head" });
    const d = new Date(day + "T00:00:00");
    const name = head.createDiv({ cls: "nn-day-name" });
    name.createSpan({ text: d.toLocaleDateString(undefined, { weekday: "short" }) + " " });
    name.createSpan({ cls: "nn-day-num", text: String(d.getDate()) });
    if (!wide) name.addEventListener("click", () => { this.anchor = day; this.zoom = "day"; this.render(); });
    const isStrip = !wide && pastAsStrip && day < today;
    const cyc = isStrip ? null : this.plugin.calendars.cycleOn(day);
    if (cyc) head.createDiv({ cls: `nn-cycle nn-cycle-${cyc.phase}`, text: `Cycle day ${cyc.day} · ${cyc.phase}` });
    for (const g of this.dueOn(day)) {
      const mk = head.createDiv({ cls: "nn-milestone-mark", text: `◆ ${g.name}`, attr: { "aria-label": g.task.text } });
      mk.addEventListener("click", (e) => { e.stopPropagation(); this.setView("goals"); });
    }

    let open = openOn(tasks, day, this.filter);
    // With carry-over off, unfinished tasks from past days sit on today.
    if (day === today && !this.plugin.on("carryOver")) open = [...overdue(tasks, today, this.filter), ...open];
    open = applyOrder(this.plugin, day, open);
    // Highest priority at the top; your drag order holds within each priority.
    open = open.map((t, i) => ({ t, i })).sort((a, b) => PRIORITY_RANK[a.t.priority] - PRIORITY_RANK[b.t.priority] || a.i - b.i).map((x) => x.t);
    const done = doneOn(tasks, day);
    const capOn = this.plugin.on("dailyCap");
    const over = capOn && open.length > s.dailyCap;
    const est = this.plugin.on("estimates") ? estimateTotal(open) : 0;
    if (over || est) {
      const meta = head.createDiv({ cls: "nn-day-meta" });
      if (over) {
        col.addClass("is-over");
        meta.createSpan({ text: `${open.length} of ${s.dailyCap} ·` });
        const btn = meta.createEl("button", { cls: "nn-over-btn", text: "Move extras on" });
        btn.addEventListener("click", () => void moveExtrasOn(this.plugin, day, open));
      }
      if (est) {
        const avail = Math.max(0, hm(s.dayEnd) - hm(s.dayStart));
        const e = meta.createSpan({ cls: "nn-est", text: `~${formatMinutes(est)} of ${formatMinutes(avail)}` });
        if (est > avail) e.addClass("is-over");
      }
    }

    if (!wide && pastAsStrip && day < today) {
      // A past day in Week view: just a count, the day name opens it.
      col.addClass("is-strip");
      if (open.length) col.createDiv({ cls: "nn-strip-note", text: `${open.length} open` });
      if (done.length && this.plugin.on("doneList")) col.createDiv({ cls: "nn-strip-note", text: `${done.length} done` });
      return;
    }
    const events = this.plugin.calendars.eventsOn(day).filter((e) => !this.plugin.calendars.isCycleMarker(e));
    if (events.length) {
      const ev = col.createDiv({ cls: "nn-events" });
      for (const e of events) {
        const row = ev.createDiv({ cls: "nn-event" });
        row.createSpan({ cls: "nn-event-time", text: e.time ?? "All day" });
        row.createSpan({ cls: "nn-event-title", text: e.title });
        row.setAttr("aria-label", e.calendar);
      }
    }
    const list = col.createDiv({ cls: "nn-day-list" });
    renderList(this.plugin, list, open, day < today ? "" : "Nothing planned", {
      onReorder: async (moved, before) => {
        if (planDate(moved) !== day) await this.plugin.actions.schedule(moved, day);
        await placeBefore(this.plugin, day, open, moved, before, today);
      },
    });
    dropZone(col, this.plugin, async (t) => {
      if (planDate(t) !== day) await this.plugin.actions.schedule(t, day);
      await placeBefore(this.plugin, day, open, t, null, today);
    });

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

  /** Yesterday, today and tomorrow (around the chosen day), each in full. */
  private renderThree(body: HTMLElement) {
    const wrap = body.createDiv({ cls: "nn-week nn-three" });
    wrap.style.gridTemplateColumns = "repeat(3, minmax(130px, 1fr))";
    for (const d of [-1, 0, 1].map((n) => addDays(this.anchor, n))) this.dayColumn(wrap, d, false, false);
  }

  private renderWeek(body: HTMLElement) {
    const mon = mondayOf(this.anchor);
    const n = this.plugin.settings.showWeekend ? 7 : 5;
    const wrap = body.createDiv({ cls: "nn-week" });
    const today = localToday();
    // Past days shrink to a narrow strip so the days ahead get the room.
    const days = Array.from({ length: n }, (_, i) => addDays(mon, i));
    wrap.style.gridTemplateColumns = days.map((d) => (d < today ? "minmax(56px, 0.3fr)" : "minmax(130px, 1fr)")).join(" ");
    for (const d of days) this.dayColumn(wrap, d, false);
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
        const dayEvents = this.plugin.calendars.eventsOn(day);
        const nEvents = dayEvents.filter((e) => !this.plugin.calendars.isCycleMarker(e)).length;
        if (this.plugin.settings.cycle && dayEvents.some((e) => this.plugin.calendars.isCycleMarker(e))) {
          cell.querySelector(".nn-month-num")?.appendText(` ${this.plugin.settings.cycleMarker}`);
        }
        for (const g of this.dueOn(day)) cell.createDiv({ cls: "nn-milestone-mark", text: `◆ ${g.name}`, attr: { "aria-label": g.task.text } });
        if (nEvents) cell.createDiv({ cls: "nn-month-events", text: `${nEvents} ${nEvents === 1 ? "event" : "events"}` });
        const open = openOn(tasks, day, this.filter);
        for (const t of open.slice(0, 3)) {
          const r = cell.createDiv({ cls: "nn-month-task", text: t.text });
          r.draggable = true;
          r.addEventListener("dragstart", (e) => { e.dataTransfer?.setData("text/x-now-and-next", t.key); if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"; });
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
      this.areaTab(bar, key, label, lists[key].length, key === this.tab, () => { this.tab = key; this.render(); });
    }
    this.spoons(bar);
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
    // The one capture box in the planner sits above the tab's list.
    {
      const isDiary = this.tab === "diary" || this.tab === this.plugin.store.dailyArea();
      // Same box in every tab; an area tab tags the new task with its area.
      captureBox(this.plugin, panel, isDiary
        ? { lines: 2 }
        : { lines: 2, placeholder: `Add task to ${cap(this.tab)} (saved in today's daily note)`, tag: this.projectTag() });
    }
    const list = panel.createDiv({ cls: "nn-panel-list" });
    renderList(this.plugin, list, sortTasks(lists[this.tab], this.plugin.settings.sortBy), "Nothing here.", { hideProject: this.tab });
  }

  // ---------- triage (importance x urgency) ----------

  /** One area tab: click to choose, drag onto a task to assign the area, drop a task on it to move it there. */
  private areaTab(bar: HTMLElement, key: string, label: string, count: number, active: boolean, onClick: () => void) {
    const store = this.plugin.store;
    const projects = store.projects();
    const b = bar.createEl("button", { cls: "nn-tab" });
    b.createSpan({ text: label });
    if (count) b.createSpan({ cls: "nn-tab-count", text: String(count) });
    if (active) b.addClass("is-active");
    b.addEventListener("click", onClick);
    const isArea = projects.includes(key) && key !== store.dailyArea();
    if (isArea) {
      b.draggable = true;
      b.addEventListener("dragstart", (e) => {
        e.dataTransfer?.setData(AREA_DRAG_TYPE, key);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "link";
      });
    }
    if (!key) return; // "All" in Triage only filters
    // Dropping a task on a tab takes it off its day and into that area's list.
    dropZone(b, this.plugin, async (t) => {
      await this.plugin.actions.schedule(t, null);
      if (isArea && t.project !== key) {
        const fresh = this.plugin.store.get(t.key);
        if (fresh) await this.plugin.actions.moveToArea(fresh, key);
      }
    });
  }

  /**
   * The spoons (energy) at the end of the Areas row: click to show only tasks needing that much energy,
   * drag a spoon onto a task to set its energy, or drop a task on a spoon.
   */
  private spoons(bar: HTMLElement) {
    if (!this.plugin.on("energy")) return;
    const s = this.plugin.settings;
    const seg = bar.createDiv({ cls: "nn-seg nn-energy-filter nn-spoons" });
    seg.createSpan({ cls: "nn-seg-label", text: "Energy" });
    const opts: [EnergyFilter, string, string][] = [
      ["all", "Any", "Any energy"], ["low", ENERGY_EMOJI.low, "Low energy"], ["mid", ENERGY_EMOJI.mid, "Medium energy"], ["high", ENERGY_EMOJI.high, "High energy"],
    ];
    for (const [k, label, tip] of opts) {
      const b = seg.createEl("button", { text: label, attr: { "aria-label": tip } });
      if (s.energyFilter === k) b.addClass("is-active");
      b.addEventListener("click", async () => { s.energyFilter = k; await this.plugin.saveSettings(); });
      if (k === "all") continue;
      const level = k;
      b.draggable = true;
      b.addEventListener("dragstart", (e) => {
        e.dataTransfer?.setData(ENERGY_DRAG_TYPE, level);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "link";
      });
      dropZone(b, this.plugin, (t) => this.plugin.actions.energy(t, level));
    }
  }

  // ---------- goals and milestones ----------

  private goalList(): Goal<VTask>[] { return goals(this.plugin.store.tasks); }
  private nums(g: Goal<VTask>): GoalNumbers { return numbers(g, localToday(), (t) => !!planDate(t)); }

  /** Open milestones whose 📅 date is this day. */
  private dueOn(day: string): Goal<VTask>[] {
    return this.goalList().filter((g) => g.due === day && isOpenStatus(g.task.status));
  }

  /** A thin bar: done of total. */
  private bar(parent: HTMLElement, done: number, total: number) {
    const b = parent.createDiv({ cls: "nn-goal-bar", attr: { "aria-label": `${done} of ${total} done` } });
    b.createDiv({ cls: "nn-goal-fill" }).style.width = total ? `${Math.round((done / total) * 100)}%` : "0%";
  }

  /** "5 of 12 done · 9h left · 3 not on a day" */
  private numberText(n: GoalNumbers): string {
    const parts = [`${n.done} of ${n.total} done`];
    if (n.open) {
      let h = n.minutesLeft ? `${formatMinutes(n.minutesLeft)} left` : "";
      if (n.unestimated) h += `${h ? " + " : ""}${n.unestimated} without an estimate`;
      if (h) parts.push(h);
    }
    if (n.notOnADay) parts.push(`${n.notOnADay} not on a day`);
    return parts.join(" · ");
  }

  /** One line per open milestone, above the days in Plan. Folds; the fold is remembered. */
  private renderGoalStrip(root: HTMLElement) {
    const list = this.goalList().filter((g) => !this.nums(g).finished);
    if (!list.length) return;
    const det = root.createEl("details", { cls: "nn-goal-strip" });
    det.open = this.plugin.settings.goalStripOpen;
    det.addEventListener("toggle", () => { this.plugin.settings.goalStripOpen = det.open; void this.plugin.saveData(this.plugin.settings); });
    const sum = det.createEl("summary");
    sum.createSpan({ text: "Milestones" });
    sum.createSpan({ cls: "nn-tab-count", text: ` ${list.length}` });
    for (const g of list) {
      const n = this.nums(g);
      const row = det.createDiv({ cls: "nn-goal-row" });
      row.setAttr("aria-label", g.task.text);
      row.createSpan({ cls: "nn-goal-name", text: `◆ ${g.name}` });
      row.createSpan({ cls: "nn-goal-when", text: g.due ? `${shortDate(g.due)} · ${daysLeftLabel(n.daysLeft!)}` : "No date" });
      this.bar(row, n.done, n.total);
      row.createSpan({ cls: "nn-goal-nums", text: this.numberText(n) });
      row.addEventListener("click", () => this.setView("goals"));
    }
  }

  /** Full cards for each milestone and goal, bars by area, and a place for tasks not toward any. */
  private renderGoals(root: HTMLElement) {
    const all = this.goalList();
    const body = root.createDiv({ cls: "nn-body nn-goals" });
    body.createDiv({ cls: "nn-panel-hint", text: "A task tagged #milestone is a milestone if it has a 📅 date, a goal if not. Drag a task onto a card to count it toward that milestone; its day stays the same." });
    if (!all.length) {
      body.createDiv({ cls: "nn-empty", text: "No milestones yet. Tag a task #milestone, give it a short name with 🆔 (for example 🆔 draft), and list what feeds it with [from:: #tag Area]." });
      return;
    }
    const open = all.filter((g) => !this.nums(g).finished);
    const finished = all.filter((g) => this.nums(g).finished);
    if (open.length) this.renderGantt(body, open);
    const grid = body.createDiv({ cls: "nn-goal-grid" });
    for (const g of open) this.goalCard(grid, g);
    if (finished.length) {
      const det = body.createEl("details", { cls: "nn-later" });
      const sum = det.createEl("summary");
      sum.createSpan({ text: "Finished" });
      sum.createSpan({ cls: "nn-tab-count", text: ` ${finished.length}` });
      const fg = det.createDiv({ cls: "nn-goal-grid" });
      for (const g of finished) this.goalCard(fg, g);
    }

    // Open tasks that count toward no milestone. Listed only when unfolded, as there may be many.
    const attached = new Set(all.flatMap((g) => g.members.map((t) => t.key)));
    const loose = this.plugin.store.tasks.filter((t) => isOpenStatus(t.status) && !isMilestone(t) && !attached.has(t.key));
    const det = body.createEl("details", { cls: "nn-later nn-goal-loose" });
    const sum = det.createEl("summary");
    sum.createSpan({ text: "Not toward a milestone" });
    if (loose.length) sum.createSpan({ cls: "nn-tab-count", text: ` ${loose.length}` });
    det.createDiv({ cls: "nn-panel-hint", text: "Drop a task here to take it out of its milestone." });
    const inner = det.createDiv({ cls: "nn-panel-list" });
    det.addEventListener("toggle", () => {
      if (det.open && !inner.childElementCount) renderList(this.plugin, inner, sortTasks(loose, this.plugin.settings.sortBy), "Nothing here.", { showDate: true });
    });
    dropZone(det, this.plugin, (t) => this.plugin.actions.fromMilestone(t));
  }

  /**
   * Timeline: one row per milestone, its bar from the earliest task day to its 📅 date (◆), filled by done of total,
   * with a dot on each task's day (filled once done). Click a name to unfold a row per task.
   */
  private renderGantt(body: HTMLElement, list: Goal<VTask>[]) {
    const today = localToday();
    const spans = new Map(list.map((g) => [g, span(g, today, (t) => planDate(t))]));
    const from = this.ganttFrom;
    // At least four weeks; on to the latest end, to whole weeks, at most 26 weeks.
    const latest = [...spans.values()].reduce((m, x) => (x.end > m ? x.end : m), addDays(from, 27));
    const weeks = Math.min(26, Math.ceil((daysBetween(from, latest) + 1) / 7));
    const days = dayRange(from, addDays(from, weeks * 7 - 1));
    const last = days[days.length - 1];
    const col = (d: string) => 2 + daysBetween(from, d);
    const cols = `minmax(12em, 18em) repeat(${days.length}, minmax(18px, 1fr))`;

    const wrap = body.createDiv({ cls: "nn-gantt-wrap" });
    const nav = wrap.createDiv({ cls: "nn-nav nn-gantt-nav" });
    iconBtn(nav, "chevron-left", "Earlier", () => { this.ganttFrom = addDays(this.ganttFrom, -7); this.render(); });
    nav.createEl("button", { text: "Today", cls: "nn-today-btn" }).addEventListener("click", () => { this.ganttFrom = mondayOf(today); this.render(); });
    iconBtn(nav, "chevron-right", "Later", () => { this.ganttFrom = addDays(this.ganttFrom, 7); this.render(); });
    nav.createSpan({ cls: "nn-panel-hint", text: "Bars run from the first task's day to the milestone's date. A dot is a task: filled once done. Click a name for its tasks." });

    const g = wrap.createDiv({ cls: "nn-gantt" });
    const row = (cls: string) => { const r = g.createDiv({ cls: `nn-gantt-row ${cls}` }); r.style.gridTemplateColumns = cols; return r; };
    const place = (r: HTMLElement, cls: string, a: string, b = a, text = "") => {
      const el = r.createDiv({ cls, text });
      el.style.gridColumn = `${col(a)} / ${col(b) + 1}`;
      el.style.gridRow = "1";
      return el;
    };
    const backdrop = (r: HTMLElement) => {
      days.forEach((d, i) => { if (i > 0 && i % 7 === 0) place(r, "nn-gantt-week", d); });
      if (today >= from && today <= last) place(r, "nn-gantt-today", today);
    };
    const inView = (d: string) => d >= from && d <= last;

    // Header: the date of each Monday, and the day numbers.
    const head = row("nn-gantt-head");
    head.createDiv({ cls: "nn-gantt-label" }).style.gridRow = "1";
    for (let i = 0; i < days.length; i += 7) {
      place(head, "nn-gantt-weeklabel", days[i], days[Math.min(i + 6, days.length - 1)],
        new Date(days[i] + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" }));
    }

    for (const goal of list) {
      const sp = spans.get(goal)!;
      const n = this.nums(goal);
      const key = goal.task.key;
      const r = row("nn-gantt-goal");
      r.setAttr("aria-label", goal.task.text);
      const label = r.createDiv({ cls: "nn-gantt-label" });
      label.style.gridRow = "1";
      const open = this.ganttOpen.has(key);
      const name = label.createSpan({ cls: "nn-goal-name", text: `${open ? "▾" : "▸"} ◆ ${goal.name}` });
      name.addEventListener("click", () => { if (open) this.ganttOpen.delete(key); else this.ganttOpen.add(key); this.render(); });
      label.createSpan({ cls: "nn-goal-when", text: ` ${n.done} of ${n.total}${sp.undated.length ? ` · ${sp.undated.length} no day` : ""}` });
      backdrop(r);
      // The bar, clipped to the days shown.
      const a = sp.start < from ? from : sp.start;
      const b = sp.end > last ? last : sp.end;
      if (a <= last && b >= from) {
        const bar = place(r, "nn-gantt-bar", a, b);
        if (sp.openEnd) bar.addClass("is-open-end");
        if (sp.start < from) bar.addClass("is-cut-start");
        bar.createDiv({ cls: "nn-gantt-fill" }).style.width = n.total ? `${Math.round((n.done / n.total) * 100)}%` : "0%";
      }
      if (goal.due && inView(goal.due)) place(r, "nn-gantt-diamond", goal.due, goal.due, "◆").setAttr("aria-label", `${goal.name}: ${shortDate(goal.due)}`);
      const perDay = new Map<string, { done: number; open: number }>();
      for (const d of sp.dots) {
        const c = perDay.get(d.day) ?? { done: 0, open: 0 };
        if (d.done) c.done++; else c.open++;
        perDay.set(d.day, c);
      }
      for (const [day, c] of perDay) {
        if (!inView(day)) continue;
        const dot = place(r, `nn-gantt-dot${c.open ? "" : " is-done"}`, day);
        dot.setAttr("aria-label", `${shortDate(day)}: ${c.done ? `${c.done} done` : ""}${c.done && c.open ? ", " : ""}${c.open ? `${c.open} open` : ""}`);
      }
      dropZone(r, this.plugin, (t) => this.plugin.actions.toMilestone(t, goal));

      if (!open) continue;
      const members = [...sp.dots.map((d) => ({ t: d.task, day: d.day as string | undefined, done: d.done })), ...sp.undated.map((t) => ({ t, day: undefined, done: false }))];
      for (const m of members) {
        const tr = row("nn-gantt-task");
        const tl = tr.createDiv({ cls: "nn-gantt-label" });
        tl.style.gridRow = "1";
        const link = tl.createSpan({ cls: "nn-gantt-task-name", text: m.t.text });
        link.addEventListener("click", () => void this.plugin.actions.open(m.t));
        if (!m.day) tl.createSpan({ cls: "nn-goal-when", text: " · no day" });
        tr.draggable = true;
        tr.addEventListener("dragstart", (e) => { e.dataTransfer?.setData(DRAG_TYPE, m.t.key); if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"; });
        backdrop(tr);
        if (m.day && inView(m.day)) place(tr, `nn-gantt-dot${m.done ? " is-done" : ""}`, m.day).setAttr("aria-label", shortDate(m.day));
      }
    }
  }

  private goalCard(parent: HTMLElement, g: Goal<VTask>) {
    const n = this.nums(g);
    const card = parent.createDiv({ cls: "nn-goal-card" });
    if (n.finished) card.addClass("is-finished");
    const head = card.createDiv({ cls: "nn-goal-head" });
    const name = head.createSpan({ cls: "nn-goal-name", text: `◆ ${g.name}` });
    name.addEventListener("click", () => void this.plugin.actions.open(g.task));
    head.createSpan({ cls: "nn-goal-when", text: g.due ? `${shortDate(g.due)} · ${n.finished ? "done" : daysLeftLabel(n.daysLeft!)}` : n.finished ? "Goal · done" : "Goal · no date" });
    if (g.id) card.createDiv({ cls: "nn-goal-text", text: g.task.text });
    this.bar(card, n.done, n.total);
    card.createDiv({ cls: "nn-goal-nums", text: this.numberText(n) });
    const areas = byArea(g);
    if (areas.length > 1) {
      const t = card.createDiv({ cls: "nn-goal-areas" });
      for (const a of areas) {
        const r = t.createDiv({ cls: "nn-goal-area" });
        r.createSpan({ cls: "nn-goal-area-name", text: a.area ? cap(a.area) : "No area" });
        this.bar(r, a.done, a.total);
        r.createSpan({ cls: "nn-goal-area-n", text: `${a.done} of ${a.total}` });
      }
    }
    const openTasks = g.members.filter((t) => isOpenStatus(t.status));
    if (openTasks.length) {
      const det = card.createEl("details", { cls: "nn-group" });
      const sum = det.createEl("summary");
      sum.createSpan({ text: "Open tasks" });
      sum.createSpan({ cls: "nn-tab-count", text: ` ${openTasks.length}` });
      const list = det.createDiv({ cls: "nn-group-list" });
      det.addEventListener("toggle", () => {
        if (det.open && !list.childElementCount) renderList(this.plugin, list, sortTasks(openTasks, "due"), "", { showDate: true });
      });
    }
    if (!g.task.from && !g.members.length) card.createDiv({ cls: "nn-panel-hint", text: "Add [from:: #tag Area] to this line, or drag tasks here." });
    dropZone(card, this.plugin, (t) => this.plugin.actions.toMilestone(t, g));
  }

  /** Repeating tasks across a month (plus the odd days either side), with a dot on each day one was done. Gaps stay blank. */
  private renderHabits(root: HTMLElement) {
    const today = localToday();
    const rows = habits(this.plugin.store.tasks, today);
    const days = monthSpan(this.anchor);
    const month = this.anchor.slice(0, 7);
    const body = root.createDiv({ cls: "nn-body nn-habits" });
    const nav = body.createDiv({ cls: "nn-nav nn-habit-nav" });
    const move = (dir: number) => { const d = new Date(this.anchor + "T00:00:00"); d.setMonth(d.getMonth() + dir, 1); this.anchor = toStr(d); this.render(); };
    iconBtn(nav, "chevron-left", "Previous month", () => move(-1));
    nav.createDiv({ cls: "nn-habit-month", text: new Date(this.anchor + "T00:00:00").toLocaleDateString(undefined, { month: "long", year: "numeric" }) });
    iconBtn(nav, "chevron-right", "Next month", () => move(1));
    if (month !== today.slice(0, 7)) nav.createEl("button", { text: "This month", cls: "nn-today-btn" }).addEventListener("click", () => { this.anchor = today; this.render(); });
    body.createDiv({ cls: "nn-panel-hint", text: "Your repeating tasks across the month. A dot marks a day it was done." });
    if (!rows.length) { body.createDiv({ cls: "nn-empty", text: "No repeating tasks running yet. Start one from Routines." }); return; }
    const table = body.createEl("table", { cls: "nn-habit-table" });
    const head = table.createEl("tr");
    head.createEl("th", { cls: "nn-habit-name" });
    const cellCls = (d: string, i: number) => {
      const c = ["nn-habit-day"];
      if (!d.startsWith(month)) c.push("is-other");
      if (d === today) c.push("is-today");
      if (i > 0 && i % 7 === 0) c.push("is-week-start");
      return c.join(" ");
    };
    days.forEach((d, i) => {
      const dt = new Date(d + "T00:00:00");
      const th = head.createEl("th", { cls: cellCls(d, i) });
      th.createDiv({ text: dt.toLocaleDateString(undefined, { weekday: "narrow" }) });
      th.createDiv({ cls: "nn-habit-num", text: String(dt.getDate()) });
    });
    for (const h of rows) {
      const tr = table.createEl("tr");
      const name = tr.createEl("td", { cls: "nn-habit-name" });
      const link = name.createSpan({ cls: "nn-habit-link", text: h.name });
      if (h.open) { const t = h.open; link.addEventListener("click", () => void this.plugin.actions.open(t)); }
      name.createSpan({ cls: "nn-habit-rule", text: h.rule });
      days.forEach((d, i) => {
        const td = tr.createEl("td", { cls: cellCls(d, i).replace("nn-habit-day", "nn-habit-cell") });
        if (h.days.has(d)) td.createSpan({ cls: "nn-habit-dot", attr: { "aria-label": `Done ${d}` } });
      });
    }
  }

  private renderMatrix(body: HTMLElement) {
    const today = localToday();
    const store = this.plugin.store;
    const every = matrixTasks(store.tasks, this.filter);
    // Areas row (under the boxes): All, Diary (no area), then each area. Choosing one filters all four boxes.
    const inArea = (t: VTask, key: string) => !key || (key === "diary" ? !t.project : t.project === key);
    const keys: [string, string][] = [["", "All"]];
    if (store.dailyArea() === null) keys.push(["diary", "Diary"]);
    for (const p of store.projects()) keys.push([p, cap(p)]);
    if (!keys.some(([k]) => k === this.triageArea)) this.triageArea = "";
    const all = every.filter((t) => inArea(t, this.triageArea));
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
      if (!list.length) inner.createDiv({ cls: "nn-empty", text: "Nothing here." });
      // Grouped by area; long boxes start folded so they read as a short list of areas.
      const groups = new Map<string, VTask[]>();
      for (const t of sortTasks(list, this.plugin.settings.sortBy)) {
        const k = t.project ?? "";
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(t);
      }
      const fold = list.length > 8;
      for (const [area, items] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const g = inner.createEl("details", { cls: "nn-group" });
        g.open = !fold;
        const sum = g.createEl("summary");
        sum.createSpan({ text: area ? cap(area) : "No area" });
        sum.createSpan({ cls: "nn-tab-count", text: ` ${items.length}` });
        const gl = g.createDiv({ cls: "nn-group-list" });
        renderList(this.plugin, gl, items, "", { hideProject: area || undefined });
      }
      dropZone(cell, this.plugin, async (t) => {
        if (isImportant(t) !== bx.imp) await this.plugin.actions.priority(t, bx.imp ? "high" : "none");
        const fresh = this.plugin.store.get(t.key) ?? t;
        const hasTag = fresh.tags.some((x) => x.toLowerCase() === "urgent");
        if (bx.urg && !isUrgent(fresh, today)) await this.plugin.actions.urgent(fresh, true);
        if (!bx.urg && hasTag) await this.plugin.actions.urgent(fresh, false);
      });
    }
    body.createDiv({ cls: "nn-panel-hint", text: "Important: 🔺 ⏫ · Urgent: deadline within 7 days or #urgent" });
    // Areas and energy sit under the main view, as in Plan.
    const panel = body.createDiv({ cls: "nn-panel nn-triage-panel" });
    const bar = panel.createDiv({ cls: "nn-tabs" });
    bar.createSpan({ cls: "nn-tabs-label", text: "Areas" });
    for (const [key, label] of keys) {
      const n = every.filter((t) => inArea(t, key)).length;
      this.areaTab(bar, key, label, key ? n : 0, key === this.triageArea, () => { this.triageArea = key; this.render(); });
    }
    this.spoons(bar);
  }

  // ---------- later (hidden by default) ----------

  private renderLater(root: HTMLElement) {
    const list = later(this.plugin.store.tasks, this.filter);
    const det = root.createEl("details", { cls: "nn-later" });
    const sum = det.createEl("summary");
    sum.createSpan({ text: "Later" });
    if (list.length) sum.createSpan({ cls: "nn-tab-count", text: ` ${list.length}` });
    det.createDiv({ cls: "nn-panel-hint", text: "Tagged #later, or with a future start date (🛫). Drop a task here to move it to Later." });
    const inner = det.createDiv({ cls: "nn-panel-list" });
    renderList(this.plugin, inner, sortTasks(list, this.plugin.settings.sortBy), "Nothing here.");
    dropZone(det, this.plugin, (t) => this.plugin.actions.toLater(t));
  }

  // ---------- routines (repeating tasks without a date) ----------

  private renderRoutines(root: HTMLElement) {
    const list = routines(this.plugin.store.tasks, this.filter);
    const det = root.createEl("details", { cls: "nn-later nn-routines" });
    const sum = det.createEl("summary");
    sum.createSpan({ text: "Routines" });
    if (list.length) sum.createSpan({ cls: "nn-tab-count", text: ` ${list.length}` });
    det.createDiv({ cls: "nn-panel-hint", text: "Repeating tasks (🔁) with no date. Start one to give it its next date; it then repeats by its rule." });
    const inner = det.createDiv({ cls: "nn-panel-list" });
    if (!list.length) { inner.createDiv({ cls: "nn-empty", text: "Nothing here." }); return; }
    for (const t of list) {
      const card = renderTask(this.plugin, inner, t, { showRule: true });
      const start = card.createEl("button", { cls: "nn-routine-start", text: "Start" });
      start.addEventListener("click", (e) => { e.stopPropagation(); this.plugin.actions.promptStart(t); });
    }
  }

  // ---------- focus mode ----------

  private renderFocus(root: HTMLElement) {
    const today = localToday();
    // A first step comes just before the task it belongs to, so it is the one shown as Now.
    const all = stepsFirst(openOn(this.plugin.store.tasks, today, this.filter));
    const queue = [...all.filter((t) => !this.skipped.includes(t.key)), ...all.filter((t) => this.skipped.includes(t.key))];
    const wrap = root.createDiv({ cls: "nn-focus" });

    if (!queue.length) {
      wrap.createDiv({ cls: "nn-focus-empty", text: "Nothing left for today." });
      const done = doneOn(this.plugin.store.tasks, today);
      if (done.length) wrap.createDiv({ cls: "nn-focus-sub", text: `You finished ${done.length} ${done.length === 1 ? "thing" : "things"} today.` });
      return;
    }
    const [now, next] = queue;
    wrap.createDiv({ cls: "nn-focus-label", text: "Now" });
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
      wrap.createDiv({ cls: "nn-focus-label", text: "Next" });
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

/** Put each sub-task straight before its parent when both are in the list; everything else keeps its order. */
function stepsFirst(list: VTask[]): VTask[] {
  const out = [...list];
  for (const t of list) {
    if (!t.parent) continue;
    const pi = out.indexOf(t.parent);
    const ci = out.indexOf(t);
    if (pi >= 0 && ci > pi) { out.splice(ci, 1); out.splice(pi, 0, t); }
  }
  return out;
}
