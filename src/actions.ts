import { App, Menu, Notice, TFile } from "obsidian";
import {
  setDate, setPriority, setEnergy, setEstimate, setStatus, newTaskLine, addDays, localToday, addTag, setText, removeTags,
  Priority, Energy, parseDuration, PRIORITY_EMOJI,
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
    const frag = document.createDocumentFragment();
    frag.createSpan({ text: `Dropped: ${t.text} ` });
    const undo = frag.createEl("button", { text: "Undo", cls: "nn-undo-btn" });
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

  async addSubtask(t: VTask, text: string) {
    const indent = t.indent + "\t";
    await insertAfter(this.app, t, [newTaskLine(text, { indent })]);
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
        m.addItem((i) => i.setTitle(`Energy: ${label}`).setChecked((t.energy ?? null) === e).onClick(() => this.energy(t, e)));
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
