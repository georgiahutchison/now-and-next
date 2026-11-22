// Goals and milestones: which tasks count toward each, and the numbers shown for it.
// No Obsidian imports, so it can be tested with plain Node.
//
// A milestone is a task tagged #milestone. With a 📅 date it is a milestone; without one it is a goal,
// done when its tasks are done. Its short name is its Tasks 🆔 (e.g. 🆔 draft).
// A task counts toward a milestone when it has [for:: id], or when it matches the milestone's
// [from:: #tag Area] list. [for:: none] keeps a task out of every milestone.

/** Days from a to b (YYYY-MM-DD). Kept here so this file has no imports. */
function daysBetween(a: string, b: string): number {
  const t = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  return Math.round((t(b) - t(a)) / 86400000);
}

export const MILESTONE_TAG = "milestone";
export const NO_MILESTONE = "none";

export interface GoalTask {
  key: string;
  text: string;
  status: string;
  tags: string[];
  path: string;
  project: string | null;
  due?: string;
  id?: string;
  /** ⛔: the 🆔s this task (or milestone) waits on. */
  waitsOn?: string[];
  forId?: string;
  from?: { tags: string[]; places: string[] };
  estimateMin?: number;
}

export interface Goal<T extends GoalTask = GoalTask> {
  task: T;
  /** The 🆔, if it has one. */
  id?: string;
  /** Short name: the 🆔, else the task's wording. */
  name: string;
  /** "milestone" has a 📅 date; "goal" has none. */
  kind: "milestone" | "goal";
  due?: string;
  members: T[];
}

export interface GoalNumbers {
  total: number;
  done: number;
  open: number;
  /** Minutes left, from [est::] on open tasks. */
  minutesLeft: number;
  /** Open tasks with no est. */
  unestimated: number;
  /** Open tasks that have no day yet. */
  notOnADay: number;
  /** Days from today to the 📅 date (negative once past); undefined for a goal. */
  daysLeft?: number;
  /** The milestone is ticked, or (for a goal) every task toward it is done. */
  finished: boolean;
}

const DONE = new Set(["x", "X"]);
/** Open: anything not done or cancelled (custom statuses such as "?" included). */
export const isOpenStatus = (s: string) => !DONE.has(s) && s !== "-";
export const isDoneStatus = (s: string) => DONE.has(s);

export function isMilestone(t: { tags: string[] }): boolean {
  return t.tags.some((x) => x.toLowerCase() === MILESTONE_TAG);
}

function tagMatch(tags: string[], want: string): boolean {
  const w = want.toLowerCase();
  return tags.some((x) => { const l = x.toLowerCase(); return l === w || l.startsWith(w + "/"); });
}

/** Does the task fall under the milestone's [from:: …] list (a tag, an area name, or a folder)? */
export function matchesFrom(t: GoalTask, from: { tags: string[]; places: string[] } | undefined): boolean {
  if (!from) return false;
  if (from.tags.some((w) => tagMatch(t.tags, w))) return true;
  return from.places.some((p) => {
    const clean = p.replace(/\/$/, "");
    if (t.project && t.project.toLowerCase() === clean.toLowerCase()) return true;
    return t.path === clean + ".md" || t.path.startsWith(clean + "/");
  });
}

/** Open milestones first, then by date (goals without a date last), then by wording. */
function goalOrder<T extends GoalTask>(a: Goal<T>, b: Goal<T>): number {
  const fa = isDoneStatus(a.task.status) ? 1 : 0;
  const fb = isDoneStatus(b.task.status) ? 1 : 0;
  return fa - fb || (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.name.localeCompare(b.name);
}

/**
 * Every milestone and goal with the tasks that count toward it. Cancelled tasks are left out.
 * [for:: id] decides first. Otherwise a task goes to the first milestone (in the order above) whose
 * [from:: …] it matches, so a tag shared by two milestones feeds the open one with the nearest date.
 */
export function goals<T extends GoalTask>(tasks: T[]): Goal<T>[] {
  const list: Goal<T>[] = tasks
    .filter((t) => isMilestone(t) && t.status !== "-")
    .map((t) => ({ task: t, id: t.id, name: t.id ?? t.text, kind: t.due ? "milestone" : "goal", due: t.due, members: [] }));
  list.sort(goalOrder);
  const byId = new Map<string, Goal<T>>();
  for (const g of list) if (g.id && !byId.has(g.id.toLowerCase())) byId.set(g.id.toLowerCase(), g);
  for (const t of tasks) {
    if (isMilestone(t) || t.status === "-") continue;
    const g = goalFor(t, list, byId);
    if (g) g.members.push(t);
  }
  return list;
}

function goalFor<T extends GoalTask>(t: T, list: Goal<T>[], byId: Map<string, Goal<T>>): Goal<T> | undefined {
  if (t.forId) {
    if (t.forId.toLowerCase() === NO_MILESTONE) return undefined;
    const g = byId.get(t.forId.toLowerCase());
    if (g) return g;
  }
  return list.find((g) => matchesFrom(t, g.task.from));
}

/** The milestone a task counts toward, if any. */
export function goalOf<T extends GoalTask>(t: T, list: Goal<T>[]): Goal<T> | undefined {
  return list.find((g) => g.members.includes(t));
}

export function numbers<T extends GoalTask>(g: Goal<T>, today: string, hasDay: (t: T) => boolean): GoalNumbers {
  const open = g.members.filter((t) => isOpenStatus(t.status));
  const done = g.members.filter((t) => isDoneStatus(t.status));
  const ticked = isDoneStatus(g.task.status);
  return {
    total: open.length + done.length,
    done: done.length,
    open: open.length,
    minutesLeft: open.reduce((s, t) => s + (t.estimateMin ?? 0), 0),
    unestimated: open.filter((t) => !t.estimateMin).length,
    notOnADay: open.filter((t) => !hasDay(t)).length,
    daysLeft: g.due ? daysBetween(today, g.due) : undefined,
    finished: ticked || (g.kind === "goal" && done.length > 0 && open.length === 0),
  };
}

/** Done and total for each area among a milestone's tasks ("" = no area), largest first. */
export function byArea<T extends GoalTask>(g: Goal<T>): { area: string; done: number; total: number }[] {
  const rows = new Map<string, { area: string; done: number; total: number }>();
  for (const t of g.members) {
    if (!isOpenStatus(t.status) && !isDoneStatus(t.status)) continue;
    const k = t.project ?? "";
    const r = rows.get(k) ?? { area: k, done: 0, total: 0 };
    r.total++;
    if (isDoneStatus(t.status)) r.done++;
    rows.set(k, r);
  }
  return [...rows.values()].sort((a, b) => b.total - a.total || a.area.localeCompare(b.area));
}

/** A short 🆔 from the wording ("Send Jen the draft" -> "send-jen"), not one of `taken`. */
export function makeId(text: string, taken: string[]): string {
  const words = text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter(Boolean);
  const base = words.slice(0, 2).join("-") || "milestone";
  const used = new Set(taken.map((x) => x.toLowerCase()));
  if (!used.has(base) && base !== NO_MILESTONE) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** "3 days left", "Due today", "2 days past". */
export function daysLeftLabel(n: number): string {
  if (n === 0) return "Due today";
  if (n > 0) return `${n} ${n === 1 ? "day" : "days"} left`;
  return `${-n} ${n === -1 ? "day" : "days"} past`;
}

// ---------- Gantt ----------

export interface GanttDot<T> { day: string; done: boolean; task: T }
export interface GanttSpan<T> {
  /** First day of the bar: the earliest day a task toward it sits on or was done (today if none). */
  start: string;
  /** Last day: the 📅 date, else (for a goal) the last task's day. */
  end: string;
  /** A goal without a date: the bar has no fixed end. */
  openEnd: boolean;
  dots: GanttDot<T>[];
  /** Open tasks with no day. */
  undated: T[];
}

/** Where a milestone's bar runs and the day of each of its tasks. A done task sits on its ✅ day. */
export function span<T extends GoalTask & { done?: string }>(g: Goal<T>, today: string, dayOf: (t: T) => string | undefined): GanttSpan<T> {
  const dots: GanttDot<T>[] = [];
  const undated: T[] = [];
  for (const t of g.members) {
    const done = isDoneStatus(t.status);
    if (!done && !isOpenStatus(t.status)) continue;
    const day = done ? t.done ?? dayOf(t) : dayOf(t);
    if (day) dots.push({ day, done, task: t });
    else if (!done) undated.push(t);
  }
  dots.sort((a, b) => a.day.localeCompare(b.day));
  const days = dots.map((d) => d.day);
  let start = days[0] ?? (g.due && g.due < today ? g.due : today);
  if (g.due && g.due < start) start = g.due;
  const last = days[days.length - 1];
  let end = g.due ?? (last && last > start ? last : start);
  if (end < start) end = start;
  return { start, end, openEnd: !g.due, dots, undated };
}

/** Days from `from` to `to`, both included. */
export function dayRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let i = 0, n = daysBetween(from, to); i <= n; i++) {
    const d = new Date(Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10) + i));
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// ---------- order between milestones (⛔) ----------

function plusDays(d: string, n: number): string {
  const t = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + n));
  return t.toISOString().slice(0, 10);
}

/** The milestones in `list` that `g` waits on: ⛔ names their 🆔. */
export function waitsOnGoals<T extends GoalTask>(g: Goal<T>, list: Goal<T>[]): Goal<T>[] {
  const ids = (g.task.waitsOn ?? []).map((x) => x.toLowerCase());
  return list.filter((o) => o !== g && o.id && ids.includes(o.id.toLowerCase()));
}

/** Each milestone after the ones it waits on; otherwise the order given. A loop (a waits on b, b on a) keeps the given order. */
export function dependencyOrder<T extends GoalTask>(list: Goal<T>[]): Goal<T>[] {
  const out: Goal<T>[] = [];
  const placed = new Set<Goal<T>>();
  const visiting = new Set<Goal<T>>();
  const visit = (g: Goal<T>) => {
    if (placed.has(g) || visiting.has(g)) return;
    visiting.add(g);
    for (const b of waitsOnGoals(g, list)) visit(b);
    visiting.delete(g);
    placed.add(g);
    out.push(g);
  };
  for (const g of list) visit(g);
  return out;
}

/**
 * A goal with no date that waits on other milestones starts the day after the last of them ends,
 * so the order shows on the timeline even without dates. Dated milestones keep their own span.
 */
export function chainSpans<T extends GoalTask>(list: Goal<T>[], spans: Map<Goal<T>, { start: string; end: string; openEnd: boolean }>) {
  for (const g of dependencyOrder(list)) {
    const sp = spans.get(g);
    if (!sp || !sp.openEnd) continue;
    const ends = waitsOnGoals(g, list).map((b) => spans.get(b)?.end).filter((x): x is string => !!x);
    if (!ends.length) continue;
    const after = plusDays(ends.sort()[ends.length - 1], 1);
    if (sp.start < after) sp.start = after;
    if (sp.end < sp.start) sp.end = sp.start;
  }
}
