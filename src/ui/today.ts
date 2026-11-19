import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import { localToday } from "../tasks";
import { planDate } from "../store";
import { applyOrder, placeBefore, moveExtrasOn } from "../order";
import { openOn, doneOn, overdue, waiting } from "../queries";
import { renderList, captureBox, dropZone } from "./render";
import type NowAndNextPlugin from "../main";

export const TODAY_VIEW = "now-and-next-today";

/** Compact sidebar view: today only. */
export class TodayView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private plugin: NowAndNextPlugin) { super(leaf); }

  getViewType() { return TODAY_VIEW; }
  getDisplayText() { return "Now & Next"; }
  getIcon() { return "calendar-check"; }

  async onOpen() {
    this.registerEvent(this.plugin.store.on("changed", () => this.render()));
    this.registerInterval(window.setInterval(() => this.render(), 60_000));
    this.render();
  }

  render() {
    const root = this.contentEl;
    root.empty();
    root.addClass("nn-root", "nn-side");
    if (!this.plugin.store.isReady()) { root.createDiv({ cls: "nn-empty", text: "Reading your tasks…" }); return; }

    const today = localToday();
    const tasks = this.plugin.store.tasks;
    const f = this.plugin.on("energy") ? this.plugin.settings.energyFilter : "all";

    const head = root.createDiv({ cls: "nn-side-head" });
    head.createDiv({ cls: "nn-side-title", text: new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }) });
    const btns = head.createDiv({ cls: "nn-side-btns" });
    const openBtn = btns.createEl("button", { cls: "nn-text-btn" });
    setIcon(openBtn.createSpan({ cls: "nn-btn-icon" }), "calendar-range");
    openBtn.createSpan({ text: "Open planner" });
    openBtn.addEventListener("click", () => void this.plugin.openPlanner({}));

    if (this.plugin.on("capture")) captureBox(this.plugin, root, { lines: 2 });

    const late = overdue(tasks, today, f);
    if (late.length && this.plugin.on("carryOver")) {
      const c = root.createDiv({ cls: "nn-side-note" });
      c.setText(`${late.length} to carry over from earlier days`);
      c.addEventListener("click", () => this.plugin.openPlanner({}));
    }

    let open = openOn(tasks, today, f);
    if (!this.plugin.on("carryOver")) open = [...late, ...open];
    open = applyOrder(this.plugin, today, open);
    const capOn = this.plugin.on("dailyCap");
    const cap = this.plugin.settings.dailyCap;
    const sec = root.createDiv({ cls: "nn-side-section" });
    const h = sec.createDiv({ cls: "nn-side-h", text: "Today" });
    if (capOn && open.length > cap) h.createSpan({ cls: "nn-day-meta", text: ` ${open.length}/${cap}` });
    if (capOn && open.length > cap) {
      const note = sec.createDiv({ cls: "nn-side-note" });
      note.setText("Over your cap. ");
      const b = note.createEl("button", { cls: "nn-over-btn", text: "Move extras on" });
      b.addEventListener("click", () => void moveExtrasOn(this.plugin, today, open));
    }
    const list = sec.createDiv({ cls: "nn-day-list" });
    renderList(this.plugin, list, open, "Nothing planned for today.", {
      onReorder: async (moved, before) => {
        if (planDate(moved) !== today) await this.plugin.actions.schedule(moved, today);
        await placeBefore(this.plugin, today, open, moved, before, today);
      },
    });
    dropZone(sec, this.plugin, async (t) => {
      if (planDate(t) !== today) await this.plugin.actions.schedule(t, today);
      await placeBefore(this.plugin, today, open, t, null, today);
    });

    const w = waiting(tasks);
    if (w.length) {
      const d = root.createEl("details", { cls: "nn-waiting" });
      d.createEl("summary", { text: `Waiting on others (${w.length})` });
      renderList(this.plugin, d, w, "");
    }

    const done = doneOn(tasks, today);
    if (done.length && this.plugin.on("doneList")) {
      const d = root.createEl("details", { cls: "nn-done" });
      d.open = true;
      d.createEl("summary", { text: `Done today (${done.length})` });
      renderList(this.plugin, d, done, "");
    }
  }
}
