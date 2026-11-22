// "Waits on": the Tasks plugin's ⛔ field names the 🆔s a task waits on (a comma list).
// A task is waiting while any task it names is still open. No Obsidian imports, so it can be tested with plain Node.

export interface DepTask { id?: string; waitsOn?: string[]; status: string }

/** Finished: done or cancelled. Any other status counts as open. */
const FINISHED = new Set(["x", "X", "-"]);

/** Every task with a 🆔, by its 🆔 (lower case). */
export function idIndex<T extends DepTask>(tasks: T[]): Map<string, T[]> {
  const ix = new Map<string, T[]>();
  for (const t of tasks) {
    if (!t.id) continue;
    const k = t.id.toLowerCase();
    const list = ix.get(k);
    if (list) list.push(t); else ix.set(k, [t]);
  }
  return ix;
}

/** The still-open tasks this one waits on. An id no task has is ignored, so nothing gets stuck. */
export function openBlockers<T extends DepTask>(t: T, ix: Map<string, T[]>): T[] {
  if (!t.waitsOn?.length) return [];
  const out: T[] = [];
  for (const id of t.waitsOn) {
    for (const b of ix.get(id.toLowerCase()) ?? []) {
      if (b !== t && !FINISHED.has(b.status) && !out.includes(b)) out.push(b);
    }
  }
  return out;
}
