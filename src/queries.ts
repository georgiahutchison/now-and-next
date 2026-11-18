import { addDays, daysBetween, mondayOf, Energy } from "./tasks";
import { VTask, isOpen, isDone, isWaiting, planDate, byPriority, CANCELLED } from "./store";

export type EnergyFilter = Energy | "all";

export function energyOk(t: VTask, f: EnergyFilter) {
  return f === "all" || t.energy === f;
}

/** Top-level tasks only, unless a child has its own date (then it stands alone). */
function standsAlone(t: VTask) {
  return !t.parent || planDate(t) !== planDate(t.parent);
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

function undatedOpen(t: VTask) {
  return isOpen(t) && !planDate(t) && !t.parent;
}

export function priorities(tasks: VTask[], f: EnergyFilter): VTask[] {
  return tasks.filter((t) => undatedOpen(t) && (t.priority === "highest" || t.priority === "high") && energyOk(t, f)).sort(byPriority);
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

export interface WeekStats { done: number; planned: number; pct: number }

export function weekStats(tasks: VTask[], monday: string): WeekStats {
  const end = addDays(monday, 6);
  const inWeek = (d?: string) => !!d && d >= monday && d <= end;
  const keys = new Set<string>();
  let done = 0;
  for (const t of tasks) {
    if (t.status === CANCELLED) continue;
    const doneHere = isDone(t) && inWeek(t.done);
    if (doneHere || (inWeek(planDate(t)) && (isOpen(t) || isDone(t)))) keys.add(t.key);
    if (doneHere) done++;
  }
  const planned = keys.size;
  return { done, planned, pct: planned ? Math.round((done / planned) * 100) : 0 };
}

export function stats(tasks: VTask[], today: string) {
  const mon = mondayOf(today);
  const thisWeek = weekStats(tasks, mon);
  const last4 = [1, 2, 3, 4].map((i) => weekStats(tasks, addDays(mon, -7 * i)));
  const withPlans = last4.filter((w) => w.planned > 0);
  const avg = withPlans.length ? Math.round(withPlans.reduce((s, w) => s + w.pct, 0) / withPlans.length) : 0;
  let streak = thisWeek.done > 0 ? 1 : 0;
  for (let i = 1; i < 104; i++) {
    if (weekStats(tasks, addDays(mon, -7 * i)).done > 0) streak++; else break;
  }
  return { thisWeek, avg, streak };
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
