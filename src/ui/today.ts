import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import { localToday } from "../tasks";
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
    root.toggleClass("nn-calm", this.plugin.settings.calm);
    if (!this.plugin.store.isReady()) { root.createDiv({ cls: "nn-empty", text: "Reading your tasks…" }); return; }

    const today = localToday();
    const tasks = this.plugin.store.tasks;
    const f = this.plugin.on("energy") ? this.plugin.settings.energyFilter : "all";

    const head = root.createDiv({ cls: "nn-side-head" });
    head.createDiv({ cls: "nn-side-title", text: new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }) });
    const btns = head.createDiv({ cls: "nn-side-btns" });
    const b = (icon: string, label: string, fn: () => unknown) => {
      const el = btns.createEl("button", { cls: "nn-text-btn" });
      setIcon(el.createSpan({ cls: "nn-btn-icon" }), icon);
      el.createSpan({ text: label });
      el.addEventListener("click", () => void fn());
    };
    if (this.plugin.on("focus")) b("target", "Focus", () => this.plugin.openPlanner({ focus: true }));
    if (this.plugin.on("talk")) b("mic", "Talk it through", () => this.plugin.talkItThrough());
    b("calendar-range", "Week", () => this.plugin.openPlanner({}));
    b("info", "Key", () => this.plugin.openKey());
    b("refresh-cw", "Reload", () => this.plugin.reloadApp());

    if (this.plugin.on("capture")) captureBox(this.plugin, root, { lines: 2 });

    const late = overdue(tasks, today, f);
    if (late.length && this.plugin.on("carryOver")) {
      const c = root.createDiv({ cls: "nn-side-note" });
      c.setText(`${late.length} to carry over from earlier days`);
      c.addEventListener("click", () => this.plugin.openPlanner({}));
    }

    let open = openOn(tasks, today, f);
    if (!this.plugin.on("carryOver")) open = [...late, ...open];
    const capOn = this.plugin.on("dailyCap");
    const cap = this.plugin.settings.dailyCap;
    const sec = root.createDiv({ cls: "nn-side-section" });
    const h = sec.createDiv({ cls: "nn-side-h", text: "Today" });
    if (!this.plugin.settings.calm) h.createSpan({ cls: "nn-day-meta", text: capOn ? ` ${open.length}/${cap}` : ` ${open.length}` });
    if (capOn && open.length > cap) sec.createDiv({ cls: "nn-side-note", text: "Over your cap. Open the week to move some on." });
    const list = sec.createDiv({ cls: "nn-day-list" });
    renderList(this.plugin, list, open, "Nothing planned for today.");
    dropZone(sec, this.plugin, (t) => this.plugin.actions.schedule(t, today));

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
