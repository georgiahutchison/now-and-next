import { Notice } from "obsidian";
import { addDays, weekday } from "./tasks";
import { VTask } from "./store";
import { openOn, isImportant, isBlocked } from "./queries";
import { shortDate } from "./ui/render";
import type NowAndNextPlugin from "./main";

/** A task's identity for ordering: its note and wording (line numbers shift too easily). */
export function orderId(t: VTask): string {
  return `${t.path}|${t.text}`;
}

/** Tasks in the saved order for this day; tasks not yet placed keep their order after them. */
export function applyOrder(plugin: NowAndNextPlugin, day: string, list: VTask[]): VTask[] {
  const saved = plugin.settings.order[day] ?? [];
  const pos = new Map(saved.map((id, i) => [id, i]));
  return list
    .map((t, i) => ({ t, i }))
    .sort((a, b) => {
      const pa = pos.get(orderId(a.t)), pb = pos.get(orderId(b.t));
      if (pa !== undefined && pb !== undefined) return pa - pb;
      if (pa !== undefined) return -1;
      if (pb !== undefined) return 1;
      return a.i - b.i;
    })
    .map((x) => x.t);
}

/** Save a day's order, dropping days in the past so the setting stays small. */
export async function saveOrder(plugin: NowAndNextPlugin, day: string, ids: string[], today: string) {
  const order = plugin.settings.order;
  order[day] = ids;
  for (const d of Object.keys(order)) if (d < today) delete order[d];
  await plugin.saveData(plugin.settings);
  plugin.store.trigger("changed");
}

/** Put `moved` just before `target` (or at the end) in this day's order. */
export async function placeBefore(plugin: NowAndNextPlugin, day: string, list: VTask[], moved: VTask, target: VTask | null, today: string) {
  const ids = list.map(orderId).filter((id) => id !== orderId(moved));
  const at = target ? ids.indexOf(orderId(target)) : -1;
  if (at < 0) ids.push(orderId(moved)); else ids.splice(at, 0, orderId(moved));
  await saveOrder(plugin, day, ids, today);
}

/**
 * Move the tasks over the cap: from the bottom of the day up, leaving 🔺/⏫ tasks where they are,
 * each to the next working day that still has room. Says what went where.
 */
export async function moveExtrasOn(plugin: NowAndNextPlugin, day: string, ordered: VTask[]) {
  const s = plugin.settings;
  const excess = ordered.length - s.dailyCap;
  if (excess <= 0) return;
  const movable = [...ordered].reverse().filter((t) => !isImportant(t)).slice(0, excess);
  if (!movable.length) { new Notice("Every task over the cap is a priority, so nothing was moved."); return; }
  const added = new Map<string, number>();
  const moves: string[] = [];
  for (const t of movable) {
    let d = addDays(day, 1);
    for (let guard = 0; guard < 60; guard++, d = addDays(d, 1)) {
      if (!s.showWeekend && weekday(d) >= 5) continue;
      const load = openOn(plugin.store.tasks, d, "all").filter((x) => !isBlocked(x, plugin.store.tasks)).length + (added.get(d) ?? 0);
      if (load < s.dailyCap) break;
    }
    added.set(d, (added.get(d) ?? 0) + 1);
    await plugin.actions.schedule(t, d);
    moves.push(`${t.text} → ${shortDate(d)}`);
  }
  const frag = document.createDocumentFragment();
  frag.createDiv({ text: "Moved:" });
  for (const m of moves) frag.createDiv({ text: m });
  new Notice(frag, 8000);
}
