import { App, Events, Notice, TFile, TFolder, debounce, moment, normalizePath } from "obsidian";
import { FileTask, parseFile, localToday, PRIORITY_RANK, tagFor } from "./tasks";
import type NowAndNextPlugin from "./main";

export interface VTask extends FileTask {
  path: string;
  key: string;
  mtime: number;
  /** Best guess at when the task was added (YYYY-MM-DD): ➕ date, else the note's date in its name, else when the note was created. */
  added: string;
  project: string | null;
  /** The project: a [[link]] in the task, else the note it's in (daily notes don't count). */
  projectNote: string | null;
  children: VTask[];
  parent: VTask | null;
}


export const DONE = new Set(["x", "X"]);
export const WAITING = "w";
export const CANCELLED = "-";

/** Open: anything not done, cancelled or waiting on someone, so custom statuses such as "?" still show. */
export function isOpen(t: VTask) { return !DONE.has(t.status) && t.status !== CANCELLED && t.status !== WAITING; }
export function isDone(t: VTask) { return DONE.has(t.status); }
export function isWaiting(t: VTask) { return t.status === WAITING; }
/** The day a task sits on: scheduled, else due. */
/** Finds the day for a task tied to a calendar event; set by the plugin once calendars load. */
let eventDayFor: (t: VTask) => string | undefined = () => undefined;
export function setEventResolver(fn: (t: VTask) => string | undefined) { eventDayFor = fn; }
/**
 * The day a task sits on. A repeating task tied to an event follows that month's event (its own date is the anchor).
 * Otherwise its scheduled date, else the day from its event link, else its due date.
 */
export function planDate(t: VTask): string | undefined {
  if (t.eventLink && t.recurrence) return eventDayFor(t) ?? t.scheduled ?? t.due;
  return t.scheduled ?? (t.eventLink ? eventDayFor(t) : undefined) ?? t.due;
}
export function byPriority(a: VTask, b: VTask) {
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.path.localeCompare(b.path) || a.line - b.line;
}

export class TaskStore extends Events {
  tasks: VTask[] = [];
  private byPath = new Map<string, VTask[]>();
  private ready = false;

  constructor(private app: App, private plugin: NowAndNextPlugin) {
    super();
  }

  private notify = debounce(() => this.trigger("changed"), 120, true);

  async init() {
    await this.reloadAll();
    const { vault } = this.app;
    const reparse = (f: unknown) => { if (f instanceof TFile && f.extension === "md") void this.reparse(f); };
    this.plugin.registerEvent(vault.on("modify", reparse));
    this.plugin.registerEvent(vault.on("create", reparse));
    this.plugin.registerEvent(vault.on("delete", (f) => { if (this.byPath.delete(f.path)) this.rebuild(); }));
    this.plugin.registerEvent(vault.on("rename", (f, old) => {
      if (this.byPath.delete(old)) this.rebuild();
      reparse(f);
    }));
    this.ready = true;
  }

  isReady() { return this.ready; }

  /** Left out: Obsidian's config, anything outside "Only these folders" (when set), and ignored folders or notes. */
  private excluded(path: string): boolean {
    const clean = (xs: string[]) => xs.map((x) => x.replace(/\/$/, "")).filter(Boolean);
    const under = (f: string) => path === f || path === f + ".md" || path.startsWith(f + "/");
    if (path.startsWith(this.app.vault.configDir + "/")) return true;
    const only = clean(this.plugin.settings.onlyFolders ?? []);
    if (only.length && !only.some(under)) return true;
    return clean(this.plugin.settings.excludeFolders).some(under);
  }

  async reloadAll() {
    this.byPath.clear();
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (this.excluded(f.path)) continue;
      const content = await this.app.vault.cachedRead(f);
      this.byPath.set(f.path, this.build(f, content));
    }
    this.rebuild();
  }

  async reparse(f: TFile) {
    if (this.excluded(f.path)) return;
    const content = await this.app.vault.cachedRead(f);
    this.byPath.set(f.path, this.build(f, content));
    this.rebuild();
  }

  private build(f: TFile, content: string): VTask[] {
    const parsed = parseFile(content);
    const list: VTask[] = parsed.map((p) => ({
      ...p, path: f.path, key: `${f.path}::${p.line}`, mtime: f.stat.mtime, project: null, projectNote: null, children: [], parent: null,
      added: p.created ?? noteDate(f),
    }));
    const byLine = new Map(list.map((t) => [t.line, t]));
    for (const t of list) {
      if (t.parentLine !== null) {
        const p = byLine.get(t.parentLine);
        if (p) { t.parent = p; p.children.push(t); }
      }
    }
    return list;
  }

  private rebuild() {
    const projects = this.projects();
    const folder = this.plugin.settings.projectsFolder.replace(/\/$/, "");
    this.tasks = [];
    for (const list of this.byPath.values()) {
      for (const t of list) {
        t.project = projectOf(t, projects, folder, this.dailyArea());
        t.projectNote = t.link ?? (this.isInDailyFolder(t) ? null : t.path.split("/").pop()!.replace(/\.md$/, ""));
        this.tasks.push(t);
      }
    }
    this.notify();
  }

  get(key: string): VTask | undefined {
    const [path, line] = key.split("::");
    return this.byPath.get(path)?.find((t) => t.line === Number(line));
  }

  /** Subfolders of the projects folder, read fresh each time. */
  projects(): string[] {
    const f = this.app.vault.getAbstractFileByPath(normalizePath(this.plugin.settings.projectsFolder));
    if (!(f instanceof TFolder)) return [];
    return f.children.filter((c): c is TFolder => c instanceof TFolder).map((c) => c.name).sort((a, b) => a.localeCompare(b));
  }

  dailyFolder(): string {
    return this.plugin.dailyNoteOptions().folder;
  }

  /** The area whose folder holds the daily notes (e.g. "diary" in "2 Areas/diary"), if any. */
  dailyArea(): string | null {
    const folder = this.plugin.settings.projectsFolder.replace(/\/$/, "");
    const d = this.dailyFolder();
    if (!d.startsWith(folder + "/")) return null;
    const name = d.slice(folder.length + 1).split("/")[0];
    return this.projects().includes(name) ? name : null;
  }

  isInDailyFolder(t: VTask): boolean {
    const d = this.dailyFolder();
    return d === "" ? !t.path.includes("/") : t.path.startsWith(d + "/");
  }
}

function projectOf(t: VTask, projects: string[], folder: string, dailyArea: string | null): string | null {
  let byFolder: string | null = null;
  for (const p of projects) if (t.path.startsWith(`${folder}/${p}/`)) { byFolder = p; break; }
  let byTag: string | null = null;
  const tags = t.tags.map((x) => x.toLowerCase());
  for (const p of projects) {
    const lp = tagFor(p).toLowerCase();
    if (tags.some((x) => x === lp || x.startsWith(lp + "/"))) { byTag = p; break; }
  }
  // Daily notes are where things get captured: an area tag there says where the task belongs.
  if (byFolder && byFolder === dailyArea && byTag) return byTag;
  if (byFolder) return byFolder;
  if (byTag) return byTag;
  if (t.parent) return t.parent.project;
  return null;
}

// ---------- writing ----------

export type LineEdit = (line: string) => string | string[];

/**
 * Edit one task line in place. The line is found by its number and checked against
 * the text we read; if the note changed underneath, we search for the same text.
 */
export async function editTask(app: App, t: VTask, fn: LineEdit): Promise<boolean> {
  const file = app.vault.getAbstractFileByPath(t.path);
  if (!(file instanceof TFile)) { new Notice("Now & Next: note not found."); return false; }
  let ok = true;
  await app.vault.process(file, (data) => {
    const lines = data.split("\n");
    let i = t.line;
    if (lines[i]?.replace(/\r$/, "") !== t.raw) i = lines.findIndex((l) => l.replace(/\r$/, "") === t.raw);
    if (i < 0) { ok = false; return data; }
    const out = fn(lines[i].replace(/\r$/, ""));
    lines.splice(i, 1, ...(Array.isArray(out) ? out : [out]));
    return lines.join("\n");
  });
  if (!ok) new Notice("Now & Next: that task changed in its note. Try again.");
  return ok;
}

/** Insert lines right after a task (used for sub-tasks). */
export async function insertAfter(app: App, t: VTask, newLines: string[]): Promise<boolean> {
  return editTask(app, t, (line) => [line, ...newLines]);
}

export async function appendToFile(app: App, path: string, line: string, templatePath?: string) {
  let file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) {
    const dir = path.split("/").slice(0, -1).join("/");
    if (dir && !app.vault.getAbstractFileByPath(dir)) await app.vault.createFolder(dir);
    let initial = "";
    if (templatePath) {
      const tf = app.vault.getAbstractFileByPath(normalizePath(templatePath.endsWith(".md") ? templatePath : templatePath + ".md"));
      if (tf instanceof TFile) initial = await app.vault.read(tf);
    }
    file = await app.vault.create(path, initial);
  }
  await app.vault.process(file as TFile, (data) => {
    const sep = data === "" || data.endsWith("\n") ? "" : "\n";
    return `${data}${sep}${line}\n`;
  });
}

export function todayStr(): string {
  return localToday();
}

export function dailyNotePath(folder: string, format: string, date: string): string {
  const name = moment(date, "YYYY-MM-DD").format(format || "YYYY-MM-DD");
  return normalizePath(folder ? `${folder}/${name}.md` : `${name}.md`);
}

/** The date in a note's name (e.g. 2026-11-19), else the day the note was created. */
function noteDate(f: TFile): string {
  const m = /(\d{4})[-_. ]?(\d{2})[-_. ]?(\d{2})/.exec(f.basename);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return moment(f.stat.ctime).format("YYYY-MM-DD");
}
