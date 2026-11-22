import { addDays, daysBetween, Energy, localToday } from "./tasks";
import { VTask, isOpen, isDone, isWaiting, planDate, byPriority } from "./store";
import { idIndex, openBlockers } from "./depends";
import { isMilestone } from "./goals";

// The 🆔 index is rebuilt whenever the store builds a new task list.
const indexCache = new WeakMap<VTask[], Map<string, VTask[]>>();
/** The still-open tasks that `t` waits on (⛔), found among `tasks`. */
export function blockersOf(t: VTask, tasks: VTask[]): VTask[] {
  if (!t.waitsOn?.length) return [];
  let ix = indexCache.get(tasks);
  if (!ix) { ix = idIndex(tasks); indexCache.set(tasks, ix); }
  return openBlockers(t, ix);
}
/** Waiting on another task that is still open. */
export function isBlocked(t: VTask, tasks: VTask[]): boolean { return blockersOf(t, tasks).length > 0; }
/** Open tasks that wait on `t` (their ⛔ names its 🆔). */
const revCache = new WeakMap<VTask[], Map<string, VTask[]>>();
export function dependentsOf(t: VTask, tasks: VTask[]): VTask[] {
  if (!t.id) return [];
  let rev = revCache.get(tasks);
  if (!rev) {
    rev = new Map();
    for (const x of tasks) {
      if (!x.waitsOn || isDone(x) || x.status === "-") continue;
      for (const id of x.waitsOn) {
        const k = id.toLowerCase();
        const l = rev.get(k);
        if (l) l.push(x); else rev.set(k, [x]);
      }
    }
    revCache.set(tasks, rev);
  }
  return (rev.get(t.id.toLowerCase()) ?? []).filter((x) => x !== t);
}
/** In the planner's lists: open, or marked waiting on someone ([w]). */
export function isActive(t: VTask): boolean { return isOpen(t) || isWaiting(t); }
/** Ready to work on: not waiting on someone and not waiting on an open task. */
export function isReady(t: VTask, tasks: VTask[]): boolean { return !isWaiting(t) && !isBlocked(t, tasks); }
/** A #milestone with a 📅 date: shown as ◆ on its day, not as a task card. */
export function isDatedMilestone(t: VTask): boolean { return !!t.due && isMilestone(t); }

export type EnergyFilter = Energy | "all";

export function energyOk(t: VTask, f: EnergyFilter) {
  return f === "all" || t.energy === f;
}

/** Top-level tasks only, unless a child has its own date (then it stands alone). */
// Sub-tasks are not nested in the planner: every task stands on its own.
function standsAlone(_t: VTask) {
  return true;
}

export function openOn(tasks: VTask[], day: string, f: EnergyFilter): VTask[] {
  return tasks.filter((t) => isActive(t) && planDate(t) === day && !isDatedMilestone(t) && standsAlone(t) && energyOk(t, f)).sort(byPriority);
}

/** Today's Focus queue: each sub-task just before its parent, tasks set aside with "Not now" last. */
export function focusQueue(tasks: VTask[], today: string, f: EnergyFilter, skipped: string[] = []): VTask[] {
  // A task waiting on someone, or on another open task, is left out until it is ready.
  const all = stepsFirst(openOn(tasks, today, f).filter((t) => isReady(t, tasks)));
  return [...all.filter((t) => !skipped.includes(t.key)), ...all.filter((t) => skipped.includes(t.key))];
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

export function doneOn(tasks: VTask[], day: string): VTask[] {
  return tasks.filter((t) => isDone(t) && t.done === day);
}

export function overdue(tasks: VTask[], today: string, f: EnergyFilter): VTask[] {
  return tasks.filter((t) => {
    const d = planDate(t);
    return isActive(t) && d !== undefined && d < today && !isDatedMilestone(t) && standsAlone(t) && energyOk(t, f);
  }).sort((a, b) => (planDate(a)! < planDate(b)! ? -1 : 1));
}

export function waiting(tasks: VTask[]): VTask[] {
  return tasks.filter((t) => isWaiting(t)).sort(byPriority);
}

/** Tagged #later, or deferred with a start date (🛫) still in the future. */
export function isLater(t: VTask, today = localToday()): boolean {
  return t.tags.some((x) => x.toLowerCase() === "later") || (!!t.start && t.start > today);
}

/** A repeating task (🔁). Without a date it lives in the Routines panel. */
export function isRoutine(t: VTask) { return !!t.recurrence; }

function undatedOpen(t: VTask) {
  return isActive(t) && !planDate(t) && !isLater(t) && !isRoutine(t) && !isMilestone(t);
}

/** Every open task with no day yet (not Later, not a routine, not a milestone): the "All" list under Plan. */
export function undated(tasks: VTask[], f: EnergyFilter): VTask[] {
  return tasks.filter((t) => undatedOpen(t) && energyOk(t, f)).sort(byPriority);
}

/** Undated repeating tasks; deferred ones wait in Later. */
export function routines(tasks: VTask[], f: EnergyFilter): VTask[] {
  return tasks.filter((t) => isOpen(t) && isRoutine(t) && !planDate(t) && !isLater(t) && energyOk(t, f)).sort(byPriority);
}

export function later(tasks: VTask[], f: EnergyFilter): VTask[] {
  const today = localToday();
  return tasks.filter((t) => isOpen(t) && !planDate(t) && isLater(t, today) && energyOk(t, f)).sort(byPriority);
}

export function isImportant(t: VTask) { return t.priority === "highest" || t.priority === "high"; }
/** A deadline within the next 7 days, or tagged #urgent. */
export function isUrgent(t: VTask, today = localToday()) {
  return (!!t.due && t.due <= addDays(today, 7)) || t.tags.some((x) => x.toLowerCase() === "urgent");
}
/** Triage holds undated open tasks: the ones still to be sorted before they get a day. */
export function matrixTasks(tasks: VTask[], f: EnergyFilter): VTask[] {
  return tasks.filter((t) => isActive(t) && !planDate(t) && !isLater(t) && !isRoutine(t) && energyOk(t, f));
}

export function inProject(tasks: VTask[], project: string, f: EnergyFilter): VTask[] {
  return tasks.filter((t) => undatedOpen(t) && t.project === project && energyOk(t, f)).sort(byPriority);
}

export function inbox(tasks: VTask[], inDaily: (t: VTask) => boolean, f: EnergyFilter): VTask[] {
  return tasks.filter((t) => undatedOpen(t) && !t.project && inDaily(t) && energyOk(t, f)).sort(byPriority);
}

export function estimateTotal(list: VTask[]): number {
  return list.reduce((s, t) => s + (t.estimateMin ?? 0), 0);
}

/** A task with no sub-tasks that has sat for `days` or more. */
export function needsFirstStep(t: VTask, today: string, days: number): boolean {
  if (!isOpen(t) || t.children.length) return false;
  const since = t.created ?? (planDate(t) && planDate(t)! < today ? planDate(t) : undefined);
  if (since && daysBetween(since, today) >= days) return true;
  const ageDays = (Date.now() - t.mtime) / 86400000;
  return ageDays >= days;
}


/** Minutes between two "HH:MM" strings. */
export function hm(s: string): number {
  const m = /^(\d{1,2}):?(\d{2})?$/.exec(s.trim());
  if (!m) return 0;
  return parseInt(m[1], 10) * 60 + (m[2] ? parseInt(m[2], 10) : 0);
}

export type SortMode = "priority" | "newest" | "oldest" | "due" | "az";
export const SORT_LABELS: Record<SortMode, string> = {
  priority: "Priority", newest: "Newest first", oldest: "Oldest first", due: "Deadline soonest", az: "A to Z",
};

export function sortTasks(list: VTask[], mode: SortMode): VTask[] {
  const out = [...list];
  const age = (a: VTask, b: VTask) => (a.added < b.added ? -1 : a.added > b.added ? 1 : a.path.localeCompare(b.path) || a.line - b.line);
  switch (mode) {
    case "newest": return out.sort((a, b) => age(b, a));
    case "oldest": return out.sort(age);
    case "due": return out.sort((a, b) => (a.due ?? "9999") < (b.due ?? "9999") ? -1 : (a.due ?? "9999") > (b.due ?? "9999") ? 1 : byPriority(a, b));
    case "az": return out.sort((a, b) => a.text.localeCompare(b.text, undefined, { sensitivity: "base" }));
    default: return out.sort(byPriority);
  }
}
