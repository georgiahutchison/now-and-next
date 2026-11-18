import { App, PluginSettingTab, Setting } from "obsidian";
import type NowAndNextPlugin from "./main";
import type { Energy } from "./tasks";
import type { SortMode } from "./queries";

export type Zoom = "day" | "week" | "month";

export type SupportKey =
  | "focus" | "dailyCap" | "carryOver" | "capture" | "doneList" | "energy" | "visibleTime"
  | "timer" | "estimates" | "firstStep" | "waiting" | "weeklyReview" | "calm" | "talk";

export const SUPPORTS: { key: SupportKey; name: string; desc: string }[] = [
  { key: "focus", name: "Focus mode", desc: "Today only, one task at a time: Now and Next." },
  { key: "dailyCap", name: "Daily cap", desc: "Shows when a day has more tasks than your cap and offers to move the extras on." },
  { key: "carryOver", name: "Carry-over tray", desc: "Unfinished tasks from past days wait in a 'Carry over?' tray. Off: they show on today instead." },
  { key: "capture", name: "Quick capture", desc: "A capture box at the top that drops a thought into today's note." },
  { key: "doneList", name: "Done list", desc: "Each day shows what you finished." },
  { key: "energy", name: "Energy tags", desc: "Low, medium, high energy on tasks, and a filter for how you feel right now." },
  { key: "visibleTime", name: "Visible time", desc: "A bar showing how much of your working day is left." },
  { key: "timer", name: "Task timer", desc: "A countdown on a task in the status bar." },
  { key: "estimates", name: "Time estimates", desc: "Estimates on tasks, totalled against your working hours." },
  { key: "firstStep", name: "First tiny step", desc: "A quiet prompt to add a 5-minute first step to tasks that have sat untouched." },
  { key: "waiting", name: "Waiting-on status", desc: "Mark tasks as waiting on someone; they move to their own strip." },
  { key: "weeklyReview", name: "Weekly review", desc: "A guided end-of-week review." },
  { key: "calm", name: "Calm view switch", desc: "A button that hides dates, emojis, counts and stats." },
  { key: "talk", name: "Talk it through", desc: "A button that opens Claudian so you can dictate tasks." },
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
  calm: boolean;
  energyFilter: Energy | "all";
  sortBy: SortMode;
  supports: Record<SupportKey, boolean>;
}

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
  calm: false,
  energyFilter: "all",
  sortBy: "priority",
  supports: Object.fromEntries(SUPPORTS.map((x) => [x.key, true])) as Record<SupportKey, boolean>,
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
      .setDesc("A task with no sub-tasks that has sat this long gets a quiet 'first step?' prompt.")
      .addSlider((sl) => sl.setLimits(1, 21, 1).setValue(s.stepPromptDays).setDynamicTooltip()
        .onChange(async (v) => { s.stepPromptDays = v; await save(); }));

    new Setting(containerEl).setName("Show weekend")
      .addToggle((t) => t.setValue(s.showWeekend).onChange(async (v) => { s.showWeekend = v; await save(); }));

    new Setting(containerEl).setName("Open at")
      .addDropdown((d) => d.addOptions({ day: "Day", week: "Week", month: "Month" }).setValue(s.defaultZoom)
        .onChange(async (v) => { s.defaultZoom = v as Zoom; await save(); }));

    new Setting(containerEl).setName("Supports").setHeading();
    containerEl.createEl("p", { cls: "setting-item-description", text: "Turn each support on or off. Everything is on to start." });
    for (const sp of SUPPORTS) {
      new Setting(containerEl).setName(sp.name).setDesc(sp.desc)
        .addToggle((t) => t.setValue(s.supports[sp.key]).onChange(async (v) => { s.supports[sp.key] = v; await save(); }));
    }

    new Setting(containerEl).setName("Display").setHeading();

    new Setting(containerEl).setName("Calm view")
      .setDesc("Hide dates, emojis, counts and stats; show only task text and checkboxes.")
      .addToggle((t) => t.setValue(s.calm).onChange(async (v) => { s.calm = v; await save(); }));
  }
}
