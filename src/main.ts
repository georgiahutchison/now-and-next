import { Notice, Plugin, TFile, TFolder, WorkspaceLeaf, debounce, normalizePath } from "obsidian";
import { DEFAULT_SETTINGS, NowAndNextSettings, NowAndNextSettingTab, SupportKey } from "./settings";
import { TaskStore, appendToFile, dailyNotePath, setEventResolver } from "./store";
import { Actions } from "./actions";
import { newTaskLine, localToday } from "./tasks";
import { PlannerView, PLANNER_VIEW } from "./ui/planner";
import { TodayView, TODAY_VIEW } from "./ui/today";
import { IdeaModal } from "./ui/ideas";
import { TextPromptModal } from "./ui/modals";
import { KeyModal } from "./ui/key";
import { Timer } from "./timer";
import { CalendarStore } from "./calendarStore";
import { linkedDay } from "./calendar";
import { focusQueue } from "./queries";
import { nowNextText } from "./nowNote";

export default class NowAndNextPlugin extends Plugin {
  settings!: NowAndNextSettings;
  store!: TaskStore;
  actions!: Actions;
  timer!: Timer;
  calendars!: CalendarStore;

  async onload() {
    await this.loadSettings();
    this.store = new TaskStore(this.app, this);
    this.actions = new Actions(this);
    this.timer = new Timer(this);
    this.calendars = new CalendarStore(this);
    setEventResolver((t) => t.eventLink
      ? linkedDay(t.eventLink.kind, this.calendars.eventDays(t.eventLink.title), localToday(), t.recurrence ? (t.scheduled ?? t.due) : undefined)
      : undefined);

    this.registerView(PLANNER_VIEW, (leaf) => new PlannerView(leaf, this));
    this.registerView(TODAY_VIEW, (leaf) => new TodayView(leaf, this));
    this.addSettingTab(new NowAndNextSettingTab(this.app, this));

    this.addRibbonIcon("calendar-check", "Open Now & Next", () => this.openPlanner({}));

    this.addCommand({ id: "open-planner", name: "Open planner", callback: () => this.openPlanner({}) });
    this.addCommand({ id: "show-sidebar", name: "Show today in sidebar", callback: () => this.ensureSidebar(true) });
    this.addCommand({ id: "focus-mode", name: "Focus mode", callback: () => { if (this.on("focus")) void this.openPlanner({ focus: true }); } });
    this.addCommand({ id: "capture", name: "Add task to today's daily note", callback: () => this.promptCapture() });
    this.addCommand({ id: "add-plugin-idea", name: "Add a plugin idea", callback: () => new IdeaModal(this).open() });
    this.addCommand({ id: "stop-timer", name: "Stop timer", callback: () => this.timer.stop() });
    this.addCommand({ id: "show-key", name: "Show the emoji key", callback: () => this.openKey() });
    this.addCommand({ id: "refresh", name: "Refresh Now & Next", callback: () => void this.reloadApp() });

    // Keep the areas folder setting pointing at the folder if it is renamed or moved.
    this.registerEvent(this.app.vault.on("rename", async (f, oldPath) => {
      const cur = this.settings.projectsFolder.replace(/\/$/, "");
      if (f instanceof TFolder && oldPath === cur) {
        this.settings.projectsFolder = f.path;
        await this.saveSettings();
        new Notice(`Now & Next: areas folder is now ${f.path}`);
      }
    }));

    this.app.workspace.onLayoutReady(async () => {
      await this.store.init();
      this.registerEvent(this.store.on("changed", () => this.writeNowNextSoon()));
      // A new day brings a new Now, even when nothing else changes.
      this.registerInterval(window.setInterval(() => this.writeNowNextSoon(), 5 * 60_000));
      this.writeNowNextSoon();
      await this.ensureSidebar(false);
      void this.calendars.init();
    });
  }

  onunload() {
    this.timer.stop(true);
  }

  async loadSettings() {
    const data = (await this.loadData()) ?? {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    this.settings.supports = Object.assign({}, DEFAULT_SETTINGS.supports, data.supports ?? {});
    this.settings.order = Object.assign({}, data.order ?? {});
    this.settings.calendars = Array.isArray(data.calendars) ? data.calendars : [];
    this.settings.goTo = Array.isArray(data.goTo) ? data.goTo : [];
    this.settings.onlyFolders = Array.isArray(data.onlyFolders) ? data.onlyFolders : [];
    // The energy filter is for right now: it starts at "Any" each time so it can't hide tasks unnoticed.
    this.settings.energyFilter = "all";
  }

  /** Is this support switched on in settings? */
  on(k: SupportKey): boolean { return this.settings.supports[k] !== false; }

  async saveSettings() {
    await this.saveData(this.settings);
    await this.store.reloadAll(); // folders may have changed; also re-renders every view
  }

  // ---------- views ----------

  async openPlanner(opts: { focus?: boolean }) {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(PLANNER_VIEW)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: PLANNER_VIEW, active: true });
    }
    await workspace.revealLeaf(leaf);
    const v = leaf.view;
    if (v instanceof PlannerView && opts.focus !== undefined) v.setFocus(opts.focus);
  }

  /** Put the Today view in the left sidebar, next to Files / Search / Bookmarks. */
  async ensureSidebar(reveal: boolean) {
    // While Reload is redrawing the existing views, don't add a second sidebar panel.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any).__nowAndNextReloading) return;
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(TODAY_VIEW)[0];
    if (!leaf) {
      const l = workspace.getLeftLeaf(false);
      if (!l) return;
      await l.setViewState({ type: TODAY_VIEW, active: reveal });
      leaf = l;
    }
    if (reveal) await workspace.revealLeaf(leaf);
  }


  openKey() { new KeyModal(this.app).open(); }

  /** Reload Obsidian (same as the "Reload app without saving" command). */
  /**
   * Refresh Now & Next only: reload the plugin (picking up a new build), then redraw the
   * sidebar panel and planner page in place. The rest of Obsidian is left alone.
   */
  async reloadApp() {
    const { workspace } = this.app;
    const id = this.manifest.id;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plugins = (this.app as any).plugins;
    const leaves = [PLANNER_VIEW, TODAY_VIEW].flatMap((type) => workspace.getLeavesOfType(type).map((leaf) => ({ leaf, type })));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__nowAndNextReloading = true;
    try {
      await plugins.disablePlugin(id);
      await plugins.enablePlugin(id);
      for (const { leaf, type } of leaves) await leaf.setViewState({ type, active: false });
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).__nowAndNextReloading;
    }
    new Notice("Now & Next refreshed", 1500);
  }

  // ---------- Now and Next note ----------

  writeNowNextSoon = debounce(() => void this.writeNowNext(), 500, true);

  /** Keep the Now and Next note in step with Focus. Writes only when the text changes. */
  async writeNowNext() {
    const setting = this.settings.nowNextNote.trim();
    if (!setting || !this.on("focus")) return;
    const path = normalizePath(setting.endsWith(".md") ? setting : `${setting}.md`);
    const planner = this.app.workspace.getLeavesOfType(PLANNER_VIEW)[0]?.view;
    const skipped = planner instanceof PlannerView ? planner.skipped : [];
    const filter = this.on("energy") ? this.settings.energyFilter : "all";
    const today = localToday();
    const [now, next] = focusQueue(this.store.tasks, today, filter, skipped);
    const text = nowNextText(today, now?.text, next?.text);
    const { vault } = this.app;
    const file = vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      if ((await vault.read(file)) !== text) await vault.modify(file, text);
      return;
    }
    const dir = path.split("/").slice(0, -1).join("/");
    if (dir && !vault.getAbstractFileByPath(dir)) await vault.createFolder(dir);
    await vault.create(path, text);
  }

  // ---------- daily note + capture ----------

  dailyNoteOptions(): { folder: string; format: string; template: string } {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dn = (this.app as any).internalPlugins?.getPluginById?.("daily-notes");
    const o = dn?.instance?.options ?? {};
    return { folder: (o.folder ?? "").replace(/\/$/, ""), format: o.format || "YYYY-MM-DD", template: o.template ?? "" };
  }

  async capture(text: string, opts: { scheduled?: string; tag?: string; forId?: string } = {}) {
    const o = this.dailyNoteOptions();
    const path = dailyNotePath(o.folder, o.format, localToday());
    await appendToFile(this.app, path, newTaskLine(text, opts), o.template || undefined);
    new Notice(`Saved to ${path}`, 1500);
  }

  promptCapture() {
    new TextPromptModal(this.app, {
      title: "Add task to today's daily note",
      hint: "Goes into today's daily note as a task. Sort it later.",
      placeholder: "What's on your mind?",
      cta: "Save",
      onSubmit: (v) => this.capture(v),
    }).open();
  }

}
