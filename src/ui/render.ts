import { lutealStartsIn } from "../calendar";
import { TFile, TFolder, normalizePath, setIcon } from "obsidian";
import { formatMinutes, localToday, PRIORITY_EMOJI, ENERGY_EMOJI, addDays, type Energy } from "../tasks";
import { VTask, isDone, isOpen, isWaiting, planDate } from "../store";
import { needsFirstStep, isLater, isUrgent, isImportant } from "../queries";
import type NowAndNextPlugin from "../main";

export const DRAG_TYPE = "text/x-now-and-next";
/** An area tab being dragged onto a task: the task moves to that area. */
export const AREA_DRAG_TYPE = "text/x-now-and-next-area";
/** A spoon (energy level) being dragged onto a task: sets its energy. */
export const ENERGY_DRAG_TYPE = "text/x-now-and-next-energy";

export function renderTask(plugin: NowAndNextPlugin, parent: HTMLElement, t: VTask, opts: { showDate?: boolean; nested?: boolean; hideProject?: string; shortLabel?: boolean; showRule?: boolean } = {}) {
  const a = plugin.actions;
  const row = parent.createDiv({ cls: opts.nested ? "nn-task is-nested" : "nn-task nn-card" });
  if (isDone(t)) row.addClass("is-done");
  if (isWaiting(t)) row.addClass("is-waiting");
  row.dataset.key = t.key;

  if (!opts.nested) {
    row.draggable = true;
    row.addEventListener("dragstart", (e) => {
      // Only the planner's own type: plain text would make Obsidian draw its pane drop outline.
      e.dataTransfer?.setData(DRAG_TYPE, t.key);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      row.addClass("is-dragging");
    });
    row.addEventListener("dragend", () => row.removeClass("is-dragging"));
    // Drop an area tab on the card to move the task to that area, or a spoon to set its energy.
    row.addEventListener("dragover", (e) => {
      const types = e.dataTransfer?.types;
      if (!types || !(types.includes(AREA_DRAG_TYPE) || types.includes(ENERGY_DRAG_TYPE))) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer!.dropEffect = "link";
      row.addClass("is-area-target");
    });
    row.addEventListener("dragleave", (e) => { if (!row.contains(e.relatedTarget as Node)) row.removeClass("is-area-target"); });
    row.addEventListener("drop", (e) => {
      const area = e.dataTransfer?.getData(AREA_DRAG_TYPE);
      const energy = e.dataTransfer?.getData(ENERGY_DRAG_TYPE) as Energy | "" | undefined;
      row.removeClass("is-area-target");
      if (!area && !energy) return;
      e.preventDefault();
      e.stopPropagation();
      const fresh = plugin.store.get(t.key);
      if (!fresh) return;
      if (area) void a.moveToArea(fresh, area);
      else if (energy) void a.energy(fresh, energy);
    });
  }

  const line = row.createDiv({ cls: "nn-task-line" });
  const cb = line.createEl("input", { type: "checkbox", cls: "task-list-item-checkbox nn-check" });
  cb.checked = isDone(t);
  cb.addEventListener("click", (e) => { e.stopPropagation(); void a.toggleDone(t); });

  const text = line.createSpan({ cls: "nn-task-text" });
  // Faint "Project / Area – " before the wording; the area is left out inside its own tab.
  // The daily notes' own area (Diary) is where things are captured, so it isn't worth a label.
  const area = t.project && t.project !== opts.hideProject && t.project !== plugin.store.dailyArea()
    ? t.project.charAt(0).toUpperCase() + t.project.slice(1) : null;
  // In narrow places (the sidebar) one label is enough: the project, else the area.
  const prefix = opts.shortLabel ? (t.projectNote ?? area ?? "") : [t.projectNote, area].filter(Boolean).join(" / ");
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
    // Chips sit at the end of the text line, not on a line of their own.
    const chips = text.createSpan({ cls: "nn-chips" });
    if (t.priority !== "none") {
      const c = chips.createSpan({ cls: "nn-chip nn-chip-priority", text: PRIORITY_EMOJI[t.priority as Exclude<typeof t.priority, "none">] });
      c.setAttr("aria-label", `Priority: ${t.priority}`);
    }
    if (t.eventLink) chips.createSpan({ cls: "nn-chip nn-event-chip", text: `${t.eventLink.kind} ${t.eventLink.title}` });
    if (t.energy && plugin.on("energy")) {
      const c = chips.createSpan({ cls: `nn-chip nn-energy nn-energy-${t.energy}`, text: ENERGY_EMOJI[t.energy] });
      c.setAttr("aria-label", `${{ low: "Low", mid: "Medium", high: "High" }[t.energy]} energy`);
    }
    if (t.estimateMin && plugin.on("estimates")) chips.createSpan({ cls: "nn-chip", text: "~" + formatMinutes(t.estimateMin) });
    if (t.recurrence) {
      if (opts.showRule) chips.createSpan({ cls: "nn-chip", text: `🔁 ${t.recurrence}` });
      else { const r = chips.createSpan({ cls: "nn-chip" }); setIcon(r, "repeat"); }
    }
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

export function renderList(
  plugin: NowAndNextPlugin, parent: HTMLElement, list: VTask[], empty: string,
  opts: { showDate?: boolean; hideProject?: string; shortLabel?: boolean; onReorder?: (moved: VTask, before: VTask | null) => unknown } = {},
) {
  if (!list.length) { parent.createDiv({ cls: "nn-empty", text: empty }); return; }
  for (const t of list) {
    const card = renderTask(plugin, parent, t, opts);
    if (opts.onReorder) reorderTarget(card, plugin, t, opts.onReorder);
  }
}

/** Dropping a task on a card puts it just above that card. */
function reorderTarget(card: HTMLElement, plugin: NowAndNextPlugin, target: VTask, onReorder: (moved: VTask, before: VTask | null) => unknown) {
  card.addEventListener("dragover", (e) => {
    if (!e.dataTransfer?.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.stopPropagation();
    card.addClass("is-insert-before");
  });
  card.addEventListener("dragleave", (e) => { if (!card.contains(e.relatedTarget as Node)) card.removeClass("is-insert-before"); });
  card.addEventListener("drop", (e) => {
    card.removeClass("is-insert-before");
    const key = e.dataTransfer?.getData(DRAG_TYPE);
    if (!key) return;
    e.preventDefault();
    e.stopPropagation();
    const moved = plugin.store.get(key);
    if (moved && moved.key !== target.key) void onReorder(moved, target);
  });
}

/** Make an element accept dropped tasks. */
export function dropZone(el: HTMLElement, plugin: NowAndNextPlugin, onDrop: (t: VTask) => unknown) {
  el.addEventListener("dragover", (e) => {
    if (!e.dataTransfer?.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    el.addClass("is-drop-target");
  });
  el.addEventListener("dragleave", (e) => { if (!el.contains(e.relatedTarget as Node)) el.removeClass("is-drop-target"); });
  el.addEventListener("drop", (e) => {
    el.removeClass("is-drop-target");
    const key = e.dataTransfer?.getData(DRAG_TYPE);
    if (!key) return;
    e.preventDefault();
    e.stopPropagation();
    const t = plugin.store.get(key);
    if (t) void onDrop(t);
  });
}

export function captureBox(plugin: NowAndNextPlugin, parent: HTMLElement, opts: { placeholder?: string; scheduled?: string; tag?: string; lines?: number; fixed?: boolean } = {}) {
  // The main capture box is a two-line text area; Enter saves, Shift+Enter is ignored (one task per capture).
  let host = parent;
  if (opts.lines && opts.lines > 1) {
    // Looks like a new task: an empty checkbox beside the text area, as a prompt.
    host = parent.createDiv({ cls: "nn-capture-row" });
    const box = host.createEl("input", { type: "checkbox", cls: "nn-capture-check" });
    box.disabled = true;
    box.tabIndex = -1;
  }
  const input: HTMLInputElement | HTMLTextAreaElement = opts.lines && opts.lines > 1
    ? host.createEl("textarea", { cls: "nn-capture nn-capture-multi", attr: { rows: opts.fixed ? String(opts.lines) : "1" } })
    : host.createEl("input", { type: "text", cls: "nn-capture" });
  if (host !== parent) host.addEventListener("click", () => input.focus());
  // The text area is one line until you click in it, then grows to its full height (unless fixed).
  if (input instanceof HTMLTextAreaElement && !opts.fixed) {
    const full = String(opts.lines);
    input.addEventListener("focus", () => { input.rows = Number(full); });
    input.addEventListener("blur", () => { if (!input.value.trim()) input.rows = 1; });
  }
  input.placeholder = opts.placeholder ?? "Add task to today's daily note";
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

// ---------- daily check-in ----------

const LEVELS: ["low" | "mid" | "high", string][] = [["low", "🥄"], ["mid", "🥄🥄"], ["high", "🥄🥄🥄"]];

/** Open a go-to project: a folder is shown in the file explorer, a note opens, a new name becomes a new note. */
function openPlace(plugin: NowAndNextPlugin, place: string) {
  const app = plugin.app;
  const f = app.vault.getAbstractFileByPath(normalizePath(place)) ?? app.vault.getAbstractFileByPath(normalizePath(place + ".md"));
  if (f instanceof TFolder) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fe = (app as any).internalPlugins?.getPluginById?.("file-explorer")?.instance;
    fe?.revealInFolder?.(f);
    return;
  }
  if (f instanceof TFile) { void app.workspace.getLeaf(false).openFile(f); return; }
  void app.workspace.openLinkText(place, "", false);
}

const placeName = (p: string) => p.replace(/\.md$/, "").split("/").pop() || p;

/**
 * "How much energy today?" once a day. The answer stays as one quiet line;
 * on a low day it lists the go-to projects and the reading place.
 */
export function checkInCard(plugin: NowAndNextPlugin, parent: HTMLElement) {
  const s = plugin.settings;
  if (!s.checkIn) return;
  const today = localToday();
  const answer = s.lastCheckIn?.date === today ? s.lastCheckIn.level : null;
  const save = async (level: "low" | "mid" | "high" | "skip" | null) => {
    s.lastCheckIn = level ? { date: today, level } : null;
    await plugin.saveSettings();
  };
  const box = parent.createDiv({ cls: "nn-checkin" });
  if (!answer) {
    box.addClass("is-asking");
    box.createSpan({ cls: "nn-checkin-q", text: "How much energy today?" });
    const btns = box.createDiv({ cls: "nn-checkin-btns" });
    for (const [level, label] of LEVELS) {
      btns.createEl("button", { text: label, attr: { "aria-label": `${{ low: "Low", mid: "Medium", high: "High" }[level]} energy` } })
        .addEventListener("click", () => void save(level));
    }
    btns.createEl("button", { cls: "nn-checkin-skip", text: "Skip" }).addEventListener("click", () => void save("skip"));
    return;
  }
  if (answer === "skip") { box.remove(); return; }
  const line = box.createDiv({ cls: "nn-checkin-line" });
  line.createSpan({ text: `Today: ${LEVELS.find(([l]) => l === answer)![1]}` });
  const change = line.createEl("button", { cls: "nn-checkin-change", text: "change" });
  change.addEventListener("click", () => void save(null));
  if (answer === "low") goToList(plugin, box, "Go-to projects for a low day");
}

/** The go-to projects and the reading place, under a heading. */
function goToList(plugin: NowAndNextPlugin, box: HTMLElement, heading: string) {
  const s = plugin.settings;
  if (!s.goTo.length && !s.readingNote) return;
  if (s.goTo.length) {
    box.createDiv({ cls: "nn-checkin-sub", text: heading });
    const list = box.createDiv({ cls: "nn-checkin-list" });
    for (const g of s.goTo) {
      list.createEl("button", { cls: "nn-checkin-place", text: placeName(g) }).addEventListener("click", () => openPlace(plugin, g));
    }
  }
  if (s.readingNote) {
    const r = box.createDiv({ cls: "nn-checkin-read" });
    r.createSpan({ text: "Or switch to reading: " });
    r.createEl("button", { cls: "nn-checkin-place", text: placeName(s.readingNote) }).addEventListener("click", () => openPlace(plugin, s.readingNote));
  }
}

/** A few tasks as quiet links that open the task in its note. */
function taskLinks(plugin: NowAndNextPlugin, box: HTMLElement, list: VTask[]) {
  const ul = box.createDiv({ cls: "nn-phase-tasks" });
  for (const t of list) {
    const b = ul.createEl("button", { cls: "nn-checkin-place", text: t.text });
    b.addEventListener("click", () => void plugin.actions.open(t));
  }
}

/**
 * One prompt for today's cycle phase: social plans in the follicular and ovulation phases,
 * urgent things in the 5 days before luteal, low-spoon go-to projects in luteal. Nothing on period days.
 */
export function phasePrompt(plugin: NowAndNextPlugin, parent: HTMLElement) {
  const s = plugin.settings;
  if (!s.cycle || !s.cyclePrompts) return;
  const today = localToday();
  const c = plugin.calendars.cycleOn(today);
  if (!c || c.phase === "period") return;
  const open = plugin.store.tasks.filter((t) => isOpen(t) && !isLater(t, today));
  const box = parent.createDiv({ cls: "nn-checkin nn-phase" });
  if (c.phase === "luteal") {
    box.createDiv({ cls: "nn-checkin-line", text: "Luteal phase: a good time for low-spoon things." });
    const low = s.lastCheckIn?.date === today && s.lastCheckIn.level === "low";
    if (!low) goToList(plugin, box, "Go-to projects");
    return;
  }
  const until = lutealStartsIn(c);
  if (until !== null && until <= 5) {
    const urgent = open.filter((t) => isUrgent(t, today) || isImportant(t))
      .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999")).slice(0, 3);
    box.createDiv({ cls: "nn-checkin-line", text: `Luteal phase starts ${shortDate(addDays(today, until))}.` + (urgent.length ? " Worth getting these done first:" : "") });
    if (urgent.length) taskLinks(plugin, box, urgent);
    return;
  }
  const name = c.phase === "ovulation" ? "Ovulation" : "Follicular phase";
  const social = open.filter((t) => t.project === "social" || t.tags.some((x) => x.toLowerCase() === "social")).slice(0, 3);
  box.createDiv({ cls: "nn-checkin-line", text: `${name}: a good time for social plans.` });
  if (social.length) taskLinks(plugin, box, social);
}
