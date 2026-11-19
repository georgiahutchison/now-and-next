import { addDays, daysBetween, Energy, localToday } from "./tasks";
import { VTask, isOpen, isDone, isWaiting, planDate, byPriority } from "./store";

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
  return tasks.filter((t) => isOpen(t) && planDate(t) === day && standsAlone(t) && energyOk(t, f)).sort(byPriority);
}

export function doneOn(tasks: VTask[], day: string): VTask[] {
  return tasks.filter((t) => isDone(t) && t.done === day);
}

export function overdue(tasks: VTask[], today: string, f: EnergyFilter): VTask[] {
  return tasks.filter((t) => {
    const d = planDate(t);
    return isOpen(t) && d !== undefined && d < today && standsAlone(t) && energyOk(t, f);
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
  return isOpen(t) && !planDate(t) && !isLater(t) && !isRoutine(t);
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
  return tasks.filter((t) => isOpen(t) && !planDate(t) && !isLater(t) && !isRoutine(t) && energyOk(t, f));
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
