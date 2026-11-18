import { App, Events, Notice, TFile, TFolder, debounce, moment, normalizePath } from "obsidian";
import { FileTask, parseFile, localToday, PRIORITY_RANK } from "./tasks";
import type NowAndNextPlugin from "./main";

export interface VTask extends FileTask {
  path: string;
  key: string;
  mtime: number;
  project: string | null;
  children: VTask[];
  parent: VTask | null;
}

export const OPEN = new Set([" ", "/"]);
export const DONE = new Set(["x", "X"]);
export const WAITING = "w";
export const CANCELLED = "-";

export function isOpen(t: VTask) { return OPEN.has(t.status); }
export function isDone(t: VTask) { return DONE.has(t.status); }
export function isWaiting(t: VTask) { return t.status === WAITING; }
/** The day a task sits on: scheduled, else due. */
export function planDate(t: VTask): string | undefined { return t.scheduled ?? t.due; }
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

  private excluded(path: string): boolean {
    const ex = this.plugin.settings.excludeFolders.map((x) => x.replace(/\/$/, "")).filter(Boolean);
    if (path.startsWith(this.app.vault.configDir + "/")) return true;
    return ex.some((f) => path === f || path.startsWith(f + "/"));
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
      ...p, path: f.path, key: `${f.path}::${p.line}`, mtime: f.stat.mtime, project: null, children: [], parent: null,
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
        t.project = projectOf(t, projects, folder);
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

  isInDailyFolder(t: VTask): boolean {
    const d = this.dailyFolder();
    return d === "" ? !t.path.includes("/") : t.path.startsWith(d + "/");
  }
}

function projectOf(t: VTask, projects: string[], folder: string): string | null {
  for (const p of projects) if (t.path.startsWith(`${folder}/${p}/`)) return p;
  const tags = t.tags.map((x) => x.toLowerCase());
  for (const p of projects) {
    const lp = p.toLowerCase();
    if (tags.some((x) => x === lp || x.startsWith(lp + "/"))) return p;
  }
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
