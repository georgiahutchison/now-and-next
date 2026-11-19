import { App, Modal } from "obsidian";

// Each section: a heading, then [symbol or action, meaning] rows.
const SECTIONS: [string, [string, string][]][] = [
  ["Dates", [
    ["⏳ 2026-11-24", "Scheduled: the day the task sits on in the planner"],
    ["📅 2026-11-28", "Due: the deadline. A task with only a due date sits on that day"],
    ["🛫 2026-11-20", "Start: not before this day. A start in a later month puts the task in Later"],
    ["✅ 2026-11-19", "Done on this day (added when you tick it)"],
    ["❌ 2026-11-19", "Cancelled (dropped) on this day"],
    ["➕ 2026-11-10", "Created on this day"],
    ["🔁 every week", "Repeats. Ticking it creates the next one. With no date it waits in Routines"],
  ]],
  ["Priority and status", [
    ["🔺", "Highest priority (important in Triage)"],
    ["⏫", "High priority (important in Triage)"],
    ["🔼", "Medium priority"],
    ["🔽", "Low priority"],
    ["⏬", "Lowest priority"],
    ["- [ ]", "To do"],
    ["- [x]", "Done"],
    ["- [/]", "In progress"],
    ["- [w]", "Waiting on someone: shown in the Waiting on others strip"],
    ["- [-]", "Cancelled"],
  ]],
  ["Tags and fields", [
    ["#health, #pro-practice …", "Area: puts the task in that area's tab (spaces become hyphens)"],
    ["#later", "In the Later panel, out of the area tabs"],
    ["#urgent", "Urgent in Triage (so is a deadline within 7 days)"],
    ["#energy/low · /mid · /high", "Energy the task needs, shown as 🪫 low, 🔋 medium, ⚡ high"],
    ["[est:: 30m]", "Time estimate (30m, 1h, 1h30m)"],
    ["[[Note]] in a task", "Project: shown before the task (else the note it is in)"],
    ["Indented - [ ]", "A task in its own right (shown as its own card)"],
    ["Indented - (no box)", "Detail: stays in the note, not shown or counted"],
  ]],
  ["On a task card", [
    ["Click task text", "Open the task in its note"],
    ["Double-click task text", "Edit the wording in place (Enter saves, Escape cancels)"],
    ["… or right-click", "Menu: days, deadline, Later, repeat, priority, energy, estimate, timer, first step, waiting, drop"],
    ["× on hover", "Drop the task (Undo appears for a few seconds)"],
    ["Drag onto a day", "Schedule it there; the thin line shows where it lands in the day's order"],
    ["Drag onto an area tab", "Take it off its day and back to that area"],
    ["Drag onto Later", "Move it to Later"],
    ["Drag an area tab onto a task", "Move the task to that area (its other area tags are removed)"],
    ["Drag between Triage boxes", "Sets or clears ⏫ and #urgent; deadlines are left as they are"],
  ]],
  ["In the planner", [
    ["Day name", "Opens that day"],
    ["6/5 · Move extras on", "More tasks than your daily cap; moves the extras to the next working day with room"],
    ["Start (Routines)", "Gives an undated repeating task its next date"],
    ["Faint time and title", "A calendar event from your calendar links (read-only)"],
    ["1 · 3 · 7 · Month", "In Plan: one day, yesterday to tomorrow, a week, or a month"],
    ["Cmd/Ctrl + and -", "In Plan: step between 1, 3, 7 days and Month"],
    ["Reload icon", "Refresh Now & Next and fetch calendars again"],
  ]],
];

export class KeyModal extends Modal {
  constructor(app: App) { super(app); }

  onOpen() {
    this.setTitle("Key");
    for (const [heading, rows] of SECTIONS) {
      this.contentEl.createEl("h4", { cls: "nn-key-h", text: heading });
      const table = this.contentEl.createEl("table", { cls: "nn-key" });
      for (const [sym, meaning] of rows) {
        const tr = table.createEl("tr");
        tr.createEl("td", { cls: "nn-key-sym", text: sym });
        tr.createEl("td", { text: meaning });
      }
    }
  }

  onClose() { this.contentEl.empty(); }
}
