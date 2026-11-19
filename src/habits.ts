// Habits: repeating tasks and the days each was done. No streaks, no scores.
// No Obsidian imports, so it can be tested with plain Node.

export interface HabitTask { text: string; recurrence?: string; status: string; done?: string; start?: string }
export interface Habit<T extends HabitTask = HabitTask> { name: string; rule: string; days: Set<string>; open: T | null }

const OPEN = new Set([" ", "/"]);

/**
 * One row per repeating task that is still running (it has an open copy not deferred past today).
 * The Tasks plugin keeps each finished copy with its ✅ date, so those dates are the days it was done.
 */
export function habits<T extends HabitTask>(tasks: T[], today: string): Habit<T>[] {
  const rows = new Map<string, Habit<T>>();
  for (const t of tasks) {
    if (!t.recurrence) continue;
    const name = t.text.trim();
    const key = `${name.toLowerCase()}|${t.recurrence.trim().toLowerCase()}`;
    let h = rows.get(key);
    if (!h) { h = { name, rule: t.recurrence.trim(), days: new Set(), open: null }; rows.set(key, h); }
    if (t.status.toLowerCase() === "x" && t.done) h.days.add(t.done);
    if (OPEN.has(t.status) && !(t.start && t.start > today)) h.open = t;
  }
  return [...rows.values()].filter((h) => h.open).sort((a, b) => a.name.localeCompare(b.name));
}

/** The `n` days ending today, oldest first. */
export function lastDays(today: string, n: number): string[] {
  const out: string[] = [];
  const d = new Date(today + "T00:00:00");
  d.setDate(d.getDate() - (n - 1));
  for (let i = 0; i < n; i++) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    d.setDate(d.getDate() + 1);
  }
  return out;
}
