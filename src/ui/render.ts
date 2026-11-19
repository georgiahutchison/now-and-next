import { setIcon } from "obsidian";
import { formatMinutes, localToday, PRIORITY_EMOJI, addDays } from "../tasks";
import { VTask, isDone, isWaiting, planDate } from "../store";
import { needsFirstStep } from "../queries";
import type NowAndNextPlugin from "../main";

export const DRAG_TYPE = "text/x-now-and-next";

export function renderTask(plugin: NowAndNextPlugin, parent: HTMLElement, t: VTask, opts: { showDate?: boolean; nested?: boolean; hideProject?: string } = {}) {
  const a = plugin.actions;
  const row = parent.createDiv({ cls: opts.nested ? "nn-task is-nested" : "nn-task nn-card" });
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

  const text = line.createSpan({ cls: "nn-task-text" });
  // Faint "Project / Area – " before the wording; the area is left out inside its own tab.
  const area = t.project && t.project !== opts.hideProject ? t.project.charAt(0).toUpperCase() + t.project.slice(1) : null;
  const prefix = [t.projectNote, area].filter(Boolean).join(" / ");
  if (prefix) text.createSpan({ cls: "nn-prefix", text: `${prefix} – ` });
  text.appendText(t.text || "(empty task)");
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

  {
    const chips = line.createSpan({ cls: "nn-chips" });
    if (t.priority !== "none") {
      const c = chips.createSpan({ cls: "nn-chip nn-chip-priority", text: PRIORITY_EMOJI[t.priority as Exclude<typeof t.priority, "none">] });
      c.setAttr("aria-label", `Priority: ${t.priority}`);
    }
    if (t.energy && plugin.on("energy")) chips.createSpan({ cls: `nn-chip nn-energy nn-energy-${t.energy}`, text: { low: "low", mid: "med", high: "high" }[t.energy] });
    if (t.estimateMin && plugin.on("estimates")) chips.createSpan({ cls: "nn-chip", text: "~" + formatMinutes(t.estimateMin) });
    if (t.recurrence) { const r = chips.createSpan({ cls: "nn-chip" }); setIcon(r, "repeat"); r.setAttr("aria-label", t.recurrence); }
    if (opts.showDate && planDate(t)) chips.createSpan({ cls: "nn-chip", text: shortDate(planDate(t)!) });
    if (t.start && t.start > localToday()) chips.createSpan({ cls: "nn-chip", text: `from ${shortDate(t.start)}` });
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

  const actions = line.createSpan({ cls: "nn-actions" });
  if (!isDone(t) && t.status !== "-") {
    const drop = actions.createSpan({ cls: "nn-more nn-drop clickable-icon" });
    setIcon(drop, "x");
    drop.addEventListener("click", (e) => { e.stopPropagation(); void a.drop(t); });
  }

  const more = actions.createSpan({ cls: "nn-more clickable-icon" });
  setIcon(more, "more-horizontal");
  more.addEventListener("click", (e) => { e.stopPropagation(); a.menu(t, e); });
  row.addEventListener("contextmenu", (e) => { e.preventDefault(); a.menu(t, e); });

  // Detail bullets stay in the note; cards don't show them.

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

export function captureBox(plugin: NowAndNextPlugin, parent: HTMLElement, opts: { placeholder?: string; scheduled?: string; tag?: string; lines?: number } = {}) {
  // The main capture box is a two-line text area; Enter saves, Shift+Enter is ignored (one task per capture).
  const input: HTMLInputElement | HTMLTextAreaElement = opts.lines && opts.lines > 1
    ? parent.createEl("textarea", { cls: "nn-capture nn-capture-multi", attr: { rows: String(opts.lines) } })
    : parent.createEl("input", { type: "text", cls: "nn-capture" });
  input.placeholder = opts.placeholder ?? "Capture a thought… (Enter saves to today's note)";
  input.addEventListener("keydown", async (e) => {
    if ((e as KeyboardEvent).key !== "Enter") return;
    e.preventDefault();
    const v = input.value.replace(/\s+/g, " ").trim();
    if (!v) return;
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
    r.createSpan({ cls: "nn-chip", text: shortDate(planDate(t)!) });
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
