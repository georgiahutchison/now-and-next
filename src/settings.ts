import { App, PluginSettingTab, Setting, debounce } from "obsidian";
import type NowAndNextPlugin from "./main";
import type { Energy } from "./tasks";
import type { SortMode } from "./queries";

export type Zoom = "focus" | "day" | "three" | "week" | "month" | "matrix" | "habits";

export type SupportKey =
  | "focus" | "dailyCap" | "carryOver" | "capture" | "doneList" | "energy"
  | "timer" | "estimates" | "firstStep" | "waiting";

export const SUPPORTS: { key: SupportKey; name: string; desc: string }[] = [
  { key: "focus", name: "Focus mode", desc: "Today only, one task at a time: Now and Next." },
  { key: "dailyCap", name: "Daily cap", desc: "Shows when a day has more tasks than your cap and offers to move the extras on." },
  { key: "carryOver", name: "Carry-over tray", desc: "Unfinished tasks from past days wait in a 'Carry over?' tray. Off: they show on today instead." },
  { key: "capture", name: "Quick capture", desc: "A capture box at the top that drops a thought into today's note." },
  { key: "doneList", name: "Done list", desc: "Each day shows what you finished." },
  { key: "energy", name: "Energy tags", desc: "Low, medium, high energy on tasks, and a filter for how you feel right now." },
  { key: "timer", name: "Task timer", desc: "A countdown on a task in the status bar." },
  { key: "estimates", name: "Time estimates", desc: "Estimates on tasks, totalled against your working hours." },
  { key: "firstStep", name: "First tiny step", desc: "A quiet prompt to add a 5-minute first step to tasks that have sat untouched." },
  { key: "waiting", name: "Waiting-on status", desc: "Mark tasks as waiting on someone; they move to their own strip." },
];

export interface NowAndNextSettings {
  projectsFolder: string;
  excludeFolders: string[];
  dailyCap: number;
  dayStart: string;
  dayEnd: string;
  timerMinutes: number;
  stepPromptDays: number;
  showWeekend: boolean;
  defaultZoom: Zoom;
  ideasNote: string;
  energyFilter: Energy | "all";
  sortBy: SortMode;
  /** Manual order of tasks per day (YYYY-MM-DD -> note|wording ids). */
  order: Record<string, string[]>;
  supports: Record<SupportKey, boolean>;
  /** Calendar links (ICS), shown read-only in Plan (all spans). */
  calendars: CalendarLink[];
  /** Cycle day and phase from calendar events titled with the marker (day 1). */
  cycle: boolean;
  cycleMarker: string;
  /** A short prompt for today's phase: social plans, urgent things before luteal, low-spoon things in luteal. */
  cyclePrompts: boolean;
  /** Daily "How much energy today?" question; go-to projects and a reading place for low days. */
  checkIn: boolean;
  goTo: string[];
  readingNote: string;
  lastCheckIn: { date: string; level: "low" | "mid" | "high" | "skip" } | null;
}

export interface CalendarLink { name: string; url: string }

export const DEFAULT_SETTINGS: NowAndNextSettings = {
  projectsFolder: "domains",
  excludeFolders: ["systems/templates"],
  dailyCap: 5,
  dayStart: "09:00",
  dayEnd: "17:00",
  timerMinutes: 25,
  stepPromptDays: 5,
  showWeekend: false,
  defaultZoom: "week",
  ideasNote: "Now & Next ideas.md",
  energyFilter: "all",
  sortBy: "priority",
  order: {},
  supports: Object.fromEntries(SUPPORTS.map((x) => [x.key, true])) as Record<SupportKey, boolean>,
  calendars: [],
  cycle: true,
  cycleMarker: "🩸",
  cyclePrompts: true,
  checkIn: true,
  goTo: [],
  readingNote: "",
  lastCheckIn: null,
};

export class NowAndNextSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: NowAndNextPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;
    const save = async () => { await this.plugin.saveSettings(); };

    new Setting(containerEl).setName("Areas folder")
      .setDesc("Each subfolder is an area and gets a tab. Follows the folder if you rename or move it. A tag with the same name (for example #health) also counts.")
      .addText((t) => t.setValue(s.projectsFolder).onChange(async (v) => { s.projectsFolder = v.trim(); await save(); }));

    new Setting(containerEl).setName("Folders to ignore")
      .setDesc("One per line. Tasks in these folders (for example templates) are not shown.")
      .addTextArea((t) => t.setValue(s.excludeFolders.join("\n")).onChange(async (v) => {
        s.excludeFolders = v.split("\n").map((x) => x.trim()).filter(Boolean); await save();
      }));

    new Setting(containerEl).setName("Daily cap")
      .setDesc("Most tasks you want planned on one day. Days over the cap say so quietly.")
      .addSlider((sl) => sl.setLimits(1, 12, 1).setValue(s.dailyCap).setDynamicTooltip()
        .onChange(async (v) => { s.dailyCap = v; await save(); }));

    new Setting(containerEl).setName("Working day")
      .setDesc("Start and end (24-hour). Used for the time-left bar and estimate totals.")
      .addText((t) => t.setPlaceholder("09:00").setValue(s.dayStart).onChange(async (v) => { s.dayStart = v.trim(); await save(); }))
      .addText((t) => t.setPlaceholder("17:00").setValue(s.dayEnd).onChange(async (v) => { s.dayEnd = v.trim(); await save(); }));

    new Setting(containerEl).setName("Timer length (minutes)")
      .addSlider((sl) => sl.setLimits(5, 90, 5).setValue(s.timerMinutes).setDynamicTooltip()
        .onChange(async (v) => { s.timerMinutes = v; await save(); }));

    new Setting(containerEl).setName("First-step prompt after (days)")
      .setDesc("A task with no indented tasks under it that has sat this long gets a 'first step?' prompt.")
      .addSlider((sl) => sl.setLimits(1, 21, 1).setValue(s.stepPromptDays).setDynamicTooltip()
        .onChange(async (v) => { s.stepPromptDays = v; await save(); }));

    new Setting(containerEl).setName("Show weekend")
      .addToggle((t) => t.setValue(s.showWeekend).onChange(async (v) => { s.showWeekend = v; await save(); }));

    new Setting(containerEl).setName("Open at")
      .addDropdown((d) => d.addOptions({ focus: "Focus", matrix: "Triage", day: "Plan: 1 day", three: "Plan: 3 days", week: "Plan: 7 days", month: "Plan: Month", habits: "Habits" }).setValue(s.defaultZoom)
        .onChange(async (v) => { s.defaultZoom = v as Zoom; await save(); }));

    new Setting(containerEl).setName("Supports").setHeading();
    containerEl.createEl("p", { cls: "setting-item-description", text: "Turn each support on or off. Everything is on to start." });
    for (const sp of SUPPORTS) {
      new Setting(containerEl).setName(sp.name).setDesc(sp.desc)
        .addToggle((t) => t.setValue(s.supports[sp.key]).onChange(async (v) => { s.supports[sp.key] = v; await save(); }));
    }

    new Setting(containerEl).setName("Calendars").setHeading();
    containerEl.createEl("p", { cls: "setting-item-description", text:
      "Events from these calendars show at the top of each day in Plan, and as a count in Month. They are read-only. " +
      "Google: Settings, your calendar, Secret address in iCal format. Outlook: Settings, Calendar, Shared calendars, Publish a calendar, ICS link. " +
      "The links are private: anyone with one can read that calendar. They are kept in this plugin's settings only." });
    const refetch = debounce(() => void this.plugin.calendars.refresh(), 1200, true);
    s.calendars.forEach((c, i) => {
      new Setting(containerEl)
        .addText((t) => t.setPlaceholder("Name").setValue(c.name).onChange(async (v) => { c.name = v.trim(); await save(); refetch(); }))
        .addText((t) => {
          t.setPlaceholder("https://… .ics").setValue(c.url).onChange(async (v) => { c.url = v.trim(); await save(); refetch(); });
          t.inputEl.addClass("nn-cal-url");
        })
        .addExtraButton((b) => b.setIcon("trash-2").setTooltip("Remove").onClick(async () => {
          s.calendars.splice(i, 1); await save(); refetch(); this.display();
        }));
    });
    new Setting(containerEl).addButton((b) => b.setButtonText("Add calendar").onClick(async () => {
      s.calendars.push({ name: "", url: "" }); await save(); this.display();
    }));

    new Setting(containerEl).setName("Cycle").setHeading();
    new Setting(containerEl).setName("Show cycle day")
      .setDesc("Shows the cycle day and phase under each date in Plan. Day 1 is any calendar event whose title is the marker below.")
      .addToggle((t) => t.setValue(s.cycle).onChange(async (v) => { s.cycle = v; await save(); }));
    new Setting(containerEl).setName("Day 1 marker")
      .addText((t) => t.setValue(s.cycleMarker).onChange(async (v) => { s.cycleMarker = v.trim(); await save(); }));
    new Setting(containerEl).setName("Phase prompts")
      .setDesc("Under the check-in: social plans in the follicular and ovulation phases, urgent things in the 5 days before luteal, go-to projects in luteal.")
      .addToggle((t) => t.setValue(s.cyclePrompts).onChange(async (v) => { s.cyclePrompts = v; await save(); }));

    new Setting(containerEl).setName("Daily check-in").setHeading();
    new Setting(containerEl).setName("Ask how much energy I have")
      .setDesc("Once a day, a question at the top of the sidebar and planner. On a low day it lists your go-to projects and a reading place.")
      .addToggle((t) => t.setValue(s.checkIn).onChange(async (v) => { s.checkIn = v; await save(); }));
    new Setting(containerEl).setName("Go-to projects for low days")
      .setDesc("One per line: a note or folder path, or a note name. A note that doesn't exist yet is created when you open it.")
      .addTextArea((t) => t.setValue(s.goTo.join("\n")).onChange(async (v) => {
        s.goTo = v.split("\n").map((x) => x.trim()).filter(Boolean); await save();
      }));
    new Setting(containerEl).setName("Reading")
      .setDesc("A note or folder for reading on low days.")
      .addText((t) => t.setValue(s.readingNote).onChange(async (v) => { s.readingNote = v.trim(); await save(); }));

    new Setting(containerEl).setName("Notes").setHeading();

    new Setting(containerEl).setName("Ideas note")
      .setDesc("Where 'Add a plugin idea' writes. Created if missing.")
      .addText((t) => t.setValue(s.ideasNote).onChange(async (v) => { s.ideasNote = v.trim(); await save(); }));
  }
}
