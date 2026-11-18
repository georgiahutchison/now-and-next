import { addDays, localToday, mondayOf } from "../tasks";
import { VTask, isOpen, isDone, planDate } from "../store";
import { weekStats } from "../queries";
import { StepModal } from "./modals";
import type NowAndNextPlugin from "../main";

/** Guided end-of-week review: wins, leftovers, three priorities for next week. */
export function openWeeklyReview(plugin: NowAndNextPlugin) {
  const today = localToday();
  const mon = mondayOf(today);
  const sun = addDays(mon, 6);
  const nextMon = addDays(mon, 7);
  const inWeek = (d?: string) => !!d && d >= mon && d <= sun;
  const store = plugin.store;
  const a = plugin.actions;
  const picked = new Set<string>();

  const row = (el: HTMLElement, t: VTask) => el.createDiv({ cls: "nn-review-row" });

  new StepModal(plugin.app, "Weekly review", [
    {
      title: "What you finished",
      render: (el) => {
        const done = store.tasks.filter((t) => isDone(t) && inWeek(t.done));
        const st = weekStats(store.tasks, mon);
        el.createEl("p", { text: done.length ? `${done.length} done this week (${st.pct}% of what was planned).` : "Nothing ticked off this week." });
        const list = el.createEl("ul", { cls: "nn-review-list" });
        for (const t of done) list.createEl("li", { text: t.text });
      },
    },
    {
      title: "Still open from this week",
      render: (el, rerender) => {
        const left = store.tasks.filter((t) => isOpen(t) && !t.parent && (inWeek(planDate(t)) || (planDate(t) ?? "9999") < mon));
        if (!left.length) { el.createEl("p", { text: "Nothing left over." }); return; }
        el.createEl("p", { text: "For each: carry it to next week, put it back in its list, or let it go." });
        const all = el.createEl("button", { text: "All to next Monday" });
        all.addEventListener("click", async () => { for (const t of left) await a.schedule(t, nextMon); setTimeout(rerender, 300); });
        for (const t of left) {
          const r = row(el, t);
          r.createSpan({ cls: "nn-review-text", text: t.text });
          const b = (label: string, fn: () => Promise<unknown>) => r.createEl("button", { text: label }).addEventListener("click", async () => { await fn(); setTimeout(rerender, 300); });
          b("Next week", () => a.schedule(t, nextMon));
          b("Unplan", () => a.schedule(t, null));
          b("Drop", () => a.drop(t));
        }
      },
    },
    {
      title: "Three priorities for next week",
      render: (el, rerender) => {
        const pool = store.tasks.filter((t) => isOpen(t) && !t.parent && !planDate(t));
        el.createEl("p", { text: `Pick up to three. They get ⏫ and wait in Priorities. Picked: ${picked.size} of 3.` });
        if (!pool.length) { el.createEl("p", { text: "No undated tasks to choose from." }); return; }
        const list = el.createDiv({ cls: "nn-review-pick" });
        for (const t of pool) {
          const r = row(list, t);
          const cb = r.createEl("input", { type: "checkbox" });
          cb.checked = picked.has(t.key) || t.priority === "high" || t.priority === "highest";
          cb.disabled = !cb.checked && picked.size >= 3;
          r.createSpan({ cls: "nn-review-text", text: t.text + (t.project ? ` · ${t.project}` : "") });
          cb.addEventListener("change", async () => {
            if (cb.checked) { picked.add(t.key); await a.priority(t, "high"); }
            else { picked.delete(t.key); await a.priority(t, "none"); }
            setTimeout(rerender, 300);
          });
        }
      },
    },
  ]).open();
}
