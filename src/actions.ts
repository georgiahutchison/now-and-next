import { App, Menu, Notice, TFile } from "obsidian";
import {
  setDate, setPriority, setEnergy, setEstimate, setRecurrence, setEventLink, setStatus, newTaskLine, addDays, localToday, addTag, setText, removeTags,
  Priority, Energy, EventKind, parseDuration, PRIORITY_EMOJI, ENERGY_EMOJI,
} from "./tasks";
import { VTask, editTask, insertAfter, isWaiting, planDate } from "./store";
import { isLater } from "./queries";
import type NowAndNextPlugin from "./main";
import { DatePromptModal, TextPromptModal } from "./ui/modals";

interface TasksApi {
  executeToggleTaskDoneCommand(line: string, path: string): string;
  editTaskLineModal?(line: string): Promise<string>;
}

function tasksApi(app: App): TasksApi | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = (app as any).plugins?.plugins?.["obsidian-tasks-plugin"];
  return p?.apiV1 ?? null;
}

export class Actions {
  constructor(private plugin: NowAndNextPlugin) {}
  private get app() { return this.plugin.app; }

  /** Tick or untick through the Tasks plugin, so done dates and repeats work. */
  async toggleDone(t: VTask) {
    const api = tasksApi(this.app);
    await editTask(this.app, t, (line) => {
      if (api) return api.executeToggleTaskDoneCommand(line, t.path).split("\n");
      const done = /\[[xX]\]/.test(line);
      let out = setStatus(line, done ? " " : "x");
      out = setDate(out, "done", done ? null : localToday());
      return out;
    });
  }

  /** Change the wording only; dates, priority and tags stay. */
  async rename(t: VTask, text: string) {
    if (!text.trim() || text.trim() === t.text) return;
    await editTask(this.app, t, (l) => setText(l, text));
  }

  /** Open the Tasks plugin's own edit window for this task. */
  async editWithTasks(t: VTask) {
    const api = tasksApi(this.app);
    if (!api?.editTaskLineModal) { new Notice("The Tasks plugin's edit window isn't available. Is Tasks switched on?"); return; }
    const out = await api.editTaskLineModal(t.raw);
    if (!out || out === t.raw) return;
    await editTask(this.app, t, () => out.split("\n"));
  }

  async schedule(t: VTask, date: string | null) {
    // Moving a task moves its scheduled date; a due-only task gains a scheduled date.
    // Planning a task onto a day also brings it back from Later.
    await editTask(this.app, t, (l) => {
      let out = setDate(l, "scheduled", date);
      if (date) out = setDate(removeTags(out, ["later"]), "start", null);
      return out;
    });
  }

  /** Into the Later panel: tagged #later and taken off its day. */
  async toLater(t: VTask) {
    await editTask(this.app, t, (l) => addTag(setDate(l, "scheduled", null), "later"));
  }

  /** Out of Later: no #later tag and no future start date. */
  async fromLater(t: VTask) {
    await editTask(this.app, t, (l) => setDate(removeTags(l, ["later"]), "start", null));
  }

  /** Hide until the 1st of next month (🛫 start date), off its day. */
  async deferToNextMonth(t: VTask) {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const d = `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, "0")}-01`;
    await editTask(this.app, t, (l) => setDate(setDate(l, "scheduled", null), "start", d));
  }

  async urgent(t: VTask, on: boolean) {
    await editTask(this.app, t, (l) => (on ? addTag(l, "urgent") : removeTags(l, ["urgent"])));
  }

  async shift(t: VTask, days: number) {
    const from = planDate(t) ?? localToday();
    await this.schedule(t, addDays(from, days));
  }

  async priority(t: VTask, p: Priority) { await editTask(this.app, t, (l) => setPriority(l, p)); }
  async energy(t: VTask, e: Energy | null) { await editTask(this.app, t, (l) => setEnergy(l, e)); }
  async estimate(t: VTask, min: number | null) { await editTask(this.app, t, (l) => setEstimate(l, min)); }
  /** Tie the task to a calendar event; its own scheduled date is cleared so the event decides the day. */
  async eventLink(t: VTask, link: { kind: EventKind; title: string } | null) {
    // A repeating task keeps its own date: it anchors each copy to that month's event.
    await editTask(this.app, t, (l) => setEventLink(link && !t.recurrence ? setDate(l, "scheduled", null) : l, link));
  }

  promptEventLink(t: VTask, kind: EventKind) {
    new TextPromptModal(this.app, {
      title: { before: "Do this the day before an event", on: "Do this on the day of an event", after: "Do this the day after an event" }[kind],
      hint: "The event's title as it appears in your calendar. The task follows the event if it moves.",
      placeholder: "Supervision meeting",
      value: t.eventLink?.title ?? "",
      cta: "Save",
      onSubmit: (v) => this.eventLink(t, { kind, title: v.trim() }),
    }).open();
  }

  async repeat(t: VTask, rule: string | null) { await editTask(this.app, t, (l) => setRecurrence(l, rule)); }

  promptRepeat(t: VTask) {
    new TextPromptModal(this.app, {
      title: "Repeat",
      hint: "In the Tasks plugin's words, for example: every 3 days, every week on Monday, every month on the 15th, every 2 weeks when done.",
      placeholder: "every 3 days",
      value: t.recurrence ?? "",
      cta: "Save",
      allowEmpty: true,
      onSubmit: (v) => this.repeat(t, v.trim() || null),
    }).open();
  }

  async tag(t: VTask, tag: string) { await editTask(this.app, t, (l) => addTag(l, tag)); }

  /** Move a task to an area: drop any other area tags, then add this one. */
  async moveToArea(t: VTask, area: string) {
    const others = this.plugin.store.projects().filter((p) => p !== area);
    await editTask(this.app, t, (l) => addTag(removeTags(l, others), area));
  }

  async waiting(t: VTask, on: boolean) { await editTask(this.app, t, (l) => setStatus(l, on ? "w" : " ")); }

  /** Drop (cancel) a task, with an Undo button for a few seconds. */
  async drop(t: VTask) {
    const original = t.raw;
    const dropped = setDate(setStatus(original, "-"), "cancelled", localToday());
    if (!(await editTask(this.app, t, () => dropped))) return;
    // One quiet line: the task's wording (shortened) and an Undo link.
    const frag = document.createDocumentFragment();
    const row = frag.createDiv({ cls: "nn-notice" });
    const name = t.text.length > 40 ? t.text.slice(0, 39).trimEnd() + "…" : t.text;
    row.createSpan({ cls: "nn-notice-text", text: `Dropped: ${name}` });
    const undo = row.createEl("button", { text: "Undo", cls: "nn-undo-btn" });
    const notice = new Notice(frag, 6000);
    undo.addEventListener("click", async () => {
      notice.hide();
      await editTask(this.app, { ...t, raw: dropped } as VTask, () => original);
    });
  }

  async deadline(t: VTask, date: string | null) { await editTask(this.app, t, (l) => setDate(l, "due", date)); }

  promptDeadline(t: VTask) {
    new DatePromptModal(this.app, t.due ?? localToday(), (d) => this.deadline(t, d), "Set a deadline", "Save").open();
  }

  /** Add a sub-task under the task. It takes the task's day (today if that day has passed), so it shows up where the task is. */
  async addSubtask(t: VTask, text: string) {
    const indent = t.indent + "\t";
    const day = planDate(t);
    const today = localToday();
    const scheduled = day ? (day < today ? today : day) : undefined;
    if (await insertAfter(this.app, t, [newTaskLine(text, { indent, scheduled })])) new Notice("First step added", 1500);
  }

  async open(t: VTask) {
    const f = this.app.vault.getAbstractFileByPath(t.path);
    if (!(f instanceof TFile)) return;
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(f, { eState: { line: t.line } });
  }

  promptFirstStep(t: VTask) {
    new TextPromptModal(this.app, {
      title: "What's the first 5-minute step?",
      hint: t.text,
      placeholder: "e.g. open the form and read the first page",
      cta: "Add as sub-task",
      onSubmit: (v) => this.addSubtask(t, v),
    }).open();
  }

  promptEstimate(t: VTask) {
    new TextPromptModal(this.app, {
      title: "How long might this take?",
      hint: t.text,
      placeholder: "e.g. 30m, 1h, 1h30m (leave empty to clear)",
      value: t.estimateMin ? String(t.estimateMin) + "m" : "",
      cta: "Save",
      allowEmpty: true,
      onSubmit: (v) => {
        if (!v.trim()) return this.estimate(t, null);
        const m = parseDuration(v);
        if (m === null) { new Notice("Try a time like 30m or 1h30m."); return; }
        return this.estimate(t, m);
      },
    }).open();
  }

  /** Give a routine its next date; Tasks then repeats it by its rule. */
  promptStart(t: VTask) {
    new DatePromptModal(this.app, localToday(), (d) => this.schedule(t, d), `Next date for: ${t.text}`, "Start").open();
  }

  promptDate(t: VTask) {
    new DatePromptModal(this.app, planDate(t) ?? localToday(), (d) => this.schedule(t, d)).open();
  }

  menu(t: VTask, evt: MouseEvent) {
    const m = new Menu();
    const today = localToday();
    m.addItem((i) => i.setTitle("Edit…").setIcon("pencil").onClick(() => this.editWithTasks(t)));
    m.addItem((i) => i.setTitle("Open in note").setIcon("file-text").onClick(() => this.open(t)));
    m.addSeparator();
    m.addItem((i) => i.setTitle("Today").setIcon("sun").onClick(() => this.schedule(t, today)));
    m.addItem((i) => i.setTitle("Move to next day").setIcon("arrow-right").onClick(() => this.shift(t, 1)));
    m.addItem((i) => i.setTitle("Move to previous day").setIcon("arrow-left").onClick(() => this.shift(t, -1)));
    m.addItem((i) => i.setTitle("Pick a day…").setIcon("calendar").onClick(() => this.promptDate(t)));
    m.addItem((i) => i.setTitle(t.due ? "Change deadline…" : "Deadline…").setIcon("calendar-clock").onClick(() => this.promptDeadline(t)));
    if (t.due) m.addItem((i) => i.setTitle("Remove deadline").setIcon("calendar-x").onClick(() => this.deadline(t, null)));
    if (t.scheduled) m.addItem((i) => i.setTitle("Unplan (back to its list)").setIcon("undo-2").onClick(() => this.schedule(t, null)));
    const inLater = isLater(t);
    m.addItem((i) => i.setTitle(inLater ? "Back from Later" : "Move to Later").setIcon("archive").onClick(() => (inLater ? this.fromLater(t) : this.toLater(t))));
    m.addItem((i) => i.setTitle("Defer to next month").setIcon("calendar-arrow-up").onClick(() => this.deferToNextMonth(t)));
    m.addItem((i) => i.setTitle("Day before an event…").setIcon("calendar-minus").setChecked(t.eventLink?.kind === "before").onClick(() => this.promptEventLink(t, "before")));
    m.addItem((i) => i.setTitle("Day of an event…").setIcon("calendar-check").setChecked(t.eventLink?.kind === "on").onClick(() => this.promptEventLink(t, "on")));
    m.addItem((i) => i.setTitle("Day after an event…").setIcon("calendar-plus").setChecked(t.eventLink?.kind === "after").onClick(() => this.promptEventLink(t, "after")));
    if (t.eventLink) m.addItem((i) => i.setTitle("Remove event link").setIcon("unlink").onClick(() => this.eventLink(t, null)));
    if (t.recurrence && !planDate(t)) m.addItem((i) => i.setTitle("Start routine…").setIcon("repeat").onClick(() => this.promptStart(t)));
    m.addSeparator();
    const rules: [string | null, string][] = [
      ["every day", "Daily"], ["every weekday", "Weekdays"], ["every week", "Weekly"], ["every 2 weeks", "Fortnightly"],
      ["every month", "Monthly"], ["every year", "Yearly"],
    ];
    const cur = t.recurrence?.toLowerCase() ?? null;
    for (const [r, label] of rules) {
      m.addItem((i) => i.setTitle(`Repeat: ${label}`).setChecked(cur === r).onClick(() => this.repeat(t, r)));
    }
    const custom = cur !== null && !rules.some(([r]) => r === cur);
    m.addItem((i) => i.setTitle(custom ? `Repeat: ${t.recurrence}…` : "Repeat: Other…").setChecked(custom).onClick(() => this.promptRepeat(t)));
    m.addItem((i) => i.setTitle("Repeat: None").setChecked(cur === null).onClick(() => this.repeat(t, null)));
    m.addSeparator();
    const pr: [Priority, string][] = [["highest", "Highest"], ["high", "High"], ["medium", "Medium"], ["none", "Normal"], ["low", "Low"]];
    for (const [p, label] of pr) {
      const e = p === "none" ? "" : PRIORITY_EMOJI[p as Exclude<Priority, "none">] + " ";
      m.addItem((i) => i.setTitle(`Priority: ${e}${label}`).setChecked(t.priority === p).onClick(() => this.priority(t, p)));
    }
    m.addSeparator();
    const on = (k: Parameters<NowAndNextPlugin["on"]>[0]) => this.plugin.on(k);
    if (on("energy")) {
      const en: [Energy | null, string][] = [["low", "Low"], ["mid", "Medium"], ["high", "High"], [null, "None"]];
      for (const [e, label] of en) {
        m.addItem((i) => i.setTitle(`Energy: ${e ? ENERGY_EMOJI[e] + " " : ""}${label}`).setChecked((t.energy ?? null) === e).onClick(() => this.energy(t, e)));
      }
    }
    if (on("estimates")) m.addItem((i) => i.setTitle("Estimate…").setIcon("hourglass").onClick(() => this.promptEstimate(t)));
    m.addSeparator();
    if (on("timer")) m.addItem((i) => i.setTitle(`Start timer (${this.plugin.settings.timerMinutes} min)`).setIcon("timer")
      .onClick(() => this.plugin.timer.start(t.text)));
    if (on("firstStep")) m.addItem((i) => i.setTitle("Add first step…").setIcon("footprints").onClick(() => this.promptFirstStep(t)));
    // A waiting task can always be set back to to-do, even with the support off.
    if (on("waiting") || isWaiting(t)) m.addItem((i) => i.setTitle(isWaiting(t) ? "No longer waiting" : "Waiting on someone").setIcon("hourglass")
      .onClick(() => this.waiting(t, !isWaiting(t))));
    m.addItem((i) => i.setTitle("Drop (cancel)").setIcon("x").onClick(() => this.drop(t)));
    m.showAtMouseEvent(evt);
  }
}
