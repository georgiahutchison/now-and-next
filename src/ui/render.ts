import { setIcon } from "obsidian";
import { formatMinutes, localToday, PRIORITY_EMOJI, addDays } from "../tasks";
import { VTask, isDone, isWaiting, planDate } from "../store";
import { needsFirstStep, hm } from "../queries";
import type NowAndNextPlugin from "../main";

export const DRAG_TYPE = "text/x-now-and-next";

export function renderTask(plugin: NowAndNextPlugin, parent: HTMLElement, t: VTask, opts: { showDate?: boolean; nested?: boolean; hideProject?: string } = {}) {
  const calm = plugin.settings.calm;
  const a = plugin.actions;
  const row = parent.createDiv({ cls: "nn-task" });
  if (isDone(t)) row.addClass("is-done");
  if (isWaiting(t)) row.addClass("is-waiting");
  row.dataset.key = t.key;

  if (!opts.nested) {
    row.draggable = true;
    row.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData(DRAG_TYPE, t.key);
      e.dataTransfer?.setData("text/plain", t.text);
      row.addClass("is-dragging");
    });
    row.addEventListener("dragend", () => row.removeClass("is-dragging"));
  }

  const line = row.createDiv({ cls: "nn-task-line" });
  const cb = line.createEl("input", { type: "checkbox", cls: "task-list-item-checkbox nn-check" });
  cb.checked = isDone(t);
  cb.addEventListener("click", (e) => { e.stopPropagation(); void a.toggleDone(t); });

  const text = line.createSpan({ cls: "nn-task-text", text: t.text || "(empty task)" });
  text.setAttr("aria-label", "Click to open in note · double-click to edit");
  // A single click opens the note; a double-click edits the wording here instead.
  let clickTimer: number | null = null;
  text.addEventListener("click", () => {
    if (clickTimer !== null) return;
    clickTimer = window.setTimeout(() => { clickTimer = null; void a.open(t); }, 250);
  });
  text.addEventListener("dblclick", (e) => {
    e.preventDefault();
    if (clickTimer !== null) { window.clearTimeout(clickTimer); clickTimer = null; }
    const wasDraggable = row.draggable;
    row.draggable = false;
    const input = createEl("input", { type: "text", cls: "nn-inline-edit" });
    input.value = t.text;
    text.replaceWith(input);
    input.focus();
    input.select();
    let finished = false;
    const finish = (save: boolean) => {
      if (finished) return;
      finished = true;
      const v = input.value;
      input.replaceWith(text);
      row.draggable = wasDraggable;
      if (save) void a.rename(t, v);
    };
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); finish(true); }
      else if (ev.key === "Escape") { ev.preventDefault(); finish(false); }
    });
    input.addEventListener("blur", () => finish(false));
  });

  if (!calm) {
    const chips = line.createSpan({ cls: "nn-chips" });
    if (t.priority !== "none") {
      const c = chips.createSpan({ cls: "nn-chip nn-chip-priority", text: PRIORITY_EMOJI[t.priority as Exclude<typeof t.priority, "none">] });
      c.setAttr("aria-label", `Priority: ${t.priority}`);
    }
    if (t.energy && plugin.on("energy")) chips.createSpan({ cls: `nn-chip nn-energy nn-energy-${t.energy}`, text: { low: "low", mid: "med", high: "high" }[t.energy] });
    if (t.estimateMin && plugin.on("estimates")) chips.createSpan({ cls: "nn-chip", text: "~" + formatMinutes(t.estimateMin) });
    if (t.recurrence) { const r = chips.createSpan({ cls: "nn-chip" }); setIcon(r, "repeat"); r.setAttr("aria-label", t.recurrence); }
    if (t.project && t.project !== opts.hideProject) chips.createSpan({ cls: "nn-chip nn-chip-project", text: t.project });
    if (opts.showDate && planDate(t)) chips.createSpan({ cls: "nn-chip", text: shortDate(planDate(t)!) });
    if (t.due && !isDone(t)) {
      const today = localToday();
      const label = t.due === today ? "due today" : `due ${shortDate(t.due)}`;
      const c = chips.createSpan({ cls: "nn-chip nn-due", text: label });
      if (t.due <= today) c.addClass("is-now");
    }
    if (plugin.on("firstStep") && needsFirstStep(t, localToday(), plugin.settings.stepPromptDays)) {
      const s = chips.createSpan({ cls: "nn-chip nn-step-chip", text: "first step?" });
      s.setAttr("aria-label", "Break this into a first 5-minute step");
      s.addEventListener("click", (e) => { e.stopPropagation(); a.promptFirstStep(t); });
    }
  }

  if (!isDone(t) && t.status !== "-") {
    const drop = line.createSpan({ cls: "nn-more nn-drop clickable-icon" });
    setIcon(drop, "x");
    drop.setAttr("aria-label", "Drop this task (you can undo)");
    drop.addEventListener("click", (e) => { e.stopPropagation(); void a.drop(t); });
  }

  const more = line.createSpan({ cls: "nn-more clickable-icon" });
  setIcon(more, "more-horizontal");
  more.setAttr("aria-label", "Task options");
  more.addEventListener("click", (e) => { e.stopPropagation(); a.menu(t, e); });
  row.addEventListener("contextmenu", (e) => { e.preventDefault(); a.menu(t, e); });

  if (t.details.length && !calm) {
    const ul = row.createEl("ul", { cls: "nn-details" });
    for (const d of t.details) ul.createEl("li", { text: d });
  }

  const kidsShown = t.children.filter((c) => !(planDate(c) && planDate(c) !== planDate(t))); // others show on their own day
  if (kidsShown.length) {
    // Long sub-task lists fold away so one task can't flood a column.
    let host: HTMLElement = row;
    if (kidsShown.length > 4) {
      const det = row.createEl("details", { cls: "nn-subtasks-fold" });
      const done = kidsShown.filter((c) => isDone(c)).length;
      det.createEl("summary", { text: `${kidsShown.length} sub-tasks${done ? ` · ${done} done` : ""}` });
      host = det;
    }
    const kids = host.createDiv({ cls: "nn-subtasks" });
    for (const c of kidsShown) renderTask(plugin, kids, c, { nested: true, hideProject: opts.hideProject });
  }
  return row;
}

export function renderList(plugin: NowAndNextPlugin, parent: HTMLElement, list: VTask[], empty: string, opts: { showDate?: boolean; hideProject?: string } = {}) {
  if (!list.length) { parent.createDiv({ cls: "nn-empty", text: empty }); return; }
  for (const t of list) renderTask(plugin, parent, t, opts);
}

/** Make an element accept dropped tasks. */
export function dropZone(el: HTMLElement, plugin: NowAndNextPlugin, onDrop: (t: VTask) => unknown) {
  el.addEventListener("dragover", (e) => {
    if (!e.dataTransfer?.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    el.addClass("is-drop-target");
  });
  el.addEventListener("dragleave", (e) => { if (!el.contains(e.relatedTarget as Node)) el.removeClass("is-drop-target"); });
  el.addEventListener("drop", (e) => {
    el.removeClass("is-drop-target");
    const key = e.dataTransfer?.getData(DRAG_TYPE);
    if (!key) return;
    e.preventDefault();
    const t = plugin.store.get(key);
    if (t) void onDrop(t);
  });
}

export function timeLeftBar(plugin: NowAndNextPlugin, parent: HTMLElement) {
  const s = plugin.settings;
  const start = hm(s.dayStart), end = hm(s.dayEnd);
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const wrap = parent.createDiv({ cls: "nn-timebar" });
  const bar = wrap.createDiv({ cls: "nn-timebar-track" });
  const fill = bar.createDiv({ cls: "nn-timebar-fill" });
  let label: string;
  if (end <= start) { label = "Set your working day in settings"; fill.style.width = "0%"; }
  else if (cur < start) { label = `Your day starts in ${formatMinutes(start - cur)}`; fill.style.width = "0%"; }
  else if (cur >= end) { label = "Your working day is over"; fill.style.width = "100%"; }
  else {
    const pct = ((cur - start) / (end - start)) * 100;
    fill.style.width = `${pct.toFixed(1)}%`;
    label = `${formatMinutes(end - cur)} left in your day`;
  }
  wrap.createDiv({ cls: "nn-timebar-label", text: label });
  return wrap;
}

export function captureBox(plugin: NowAndNextPlugin, parent: HTMLElement, opts: { placeholder?: string; scheduled?: string; tag?: string } = {}) {
  const input = parent.createEl("input", { type: "text", cls: "nn-capture" });
  input.placeholder = opts.placeholder ?? "Capture a thought… (Enter saves to today's note)";
  input.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter" || !input.value.trim()) return;
    e.preventDefault();
    const v = input.value;
    input.value = "";
    await plugin.capture(v, { scheduled: opts.scheduled, tag: opts.tag });
  });
  return input;
}

export function carryOverTray(plugin: NowAndNextPlugin, parent: HTMLElement, list: VTask[]) {
  if (!list.length) return;
  const today = localToday();
  const box = parent.createEl("details", { cls: "nn-carry" });
  box.createEl("summary", { text: `Carry over? ${list.length} from earlier ${list.length === 1 ? "day" : "days"}` });
  const actions = box.createDiv({ cls: "nn-carry-actions" });
  const all = actions.createEl("button", { text: "All to today" });
  all.addEventListener("click", async () => { for (const t of list) await plugin.actions.schedule(t, today); });
  for (const t of list) {
    const r = box.createDiv({ cls: "nn-carry-row" });
    r.createSpan({ cls: "nn-carry-text", text: t.text });
    if (!plugin.settings.calm) r.createSpan({ cls: "nn-chip", text: shortDate(planDate(t)!) });
    const btns = r.createSpan({ cls: "nn-carry-btns" });
    const b = (label: string, fn: () => unknown) => btns.createEl("button", { text: label }).addEventListener("click", () => void fn());
    b("Today", () => plugin.actions.schedule(t, today));
    b("Tomorrow", () => plugin.actions.schedule(t, addDays(today, 1)));
    b("Pick day", () => plugin.actions.promptDate(t));
    b("Unplan", () => plugin.actions.schedule(t, null));
    b("Drop", () => plugin.actions.drop(t));
  }
}

export function shortDate(d: string): string {
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}
