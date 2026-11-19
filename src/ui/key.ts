import { App, Modal } from "obsidian";

const ROWS: [string, string][] = [
  ["⏳ 2026-11-24", "Scheduled: the day the task sits on in the planner"],
  ["📅 2026-11-28", "Due: the deadline. A task with only a due date sits on that day"],
  ["🛫 2026-11-20", "Start: not before this day"],
  ["✅ 2026-11-19", "Done on this day (added when you tick it)"],
  ["❌ 2026-11-19", "Cancelled (dropped) on this day"],
  ["➕ 2026-11-10", "Created on this day"],
  ["🔁 every week", "Repeats. Ticking it creates the next one"],
  ["🔺", "Highest priority"],
  ["⏫", "High priority"],
  ["🔼", "Medium priority"],
  ["🔽", "Low priority"],
  ["⏬", "Lowest priority"],
  ["- [ ]", "To do"],
  ["- [x]", "Done"],
  ["- [/]", "In progress"],
  ["- [w]", "Waiting on someone"],
  ["- [-]", "Cancelled"],
  ["#energy/low · /mid · /high", "Energy the task needs"],
  ["#later", "In the Later panel, out of the area tabs"],
  ["🛫 future date", "Deferred: in Later until that day"],
  ["#urgent", "Urgent in Triage (so is a deadline within 7 days)"],
  ["[est:: 30m]", "Time estimate (30m, 1h, 1h30m)"],
  ["#health, #pro-practice …", "Area: puts the task in that area's tab (spaces become hyphens)"],
  ["Indented - [ ]", "A task in its own right (shown as its own card)"],
  ["Indented - (no box)", "Detail: stays in the note, not shown or counted"],
  ["[[Note]] in a task", "Project: shown before the task (else the note it is in)"],
  ["Click task text", "Open the task in its note"],
  ["Double-click task text", "Edit the wording in place (Enter saves, Escape cancels)"],
  ["× on hover", "Drop the task (Undo appears for a few seconds)"],
];

export class KeyModal extends Modal {
  constructor(app: App) { super(app); }

  onOpen() {
    this.setTitle("Key");
    const table = this.contentEl.createEl("table", { cls: "nn-key" });
    for (const [sym, meaning] of ROWS) {
      const tr = table.createEl("tr");
      tr.createEl("td", { cls: "nn-key-sym", text: sym });
      tr.createEl("td", { text: meaning });
    }
  }

  onClose() { this.contentEl.empty(); }
}
