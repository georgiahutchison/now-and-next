import { Modal, Notice, Setting, TFile, normalizePath } from "obsidian";
import type NowAndNextPlugin from "../main";

const SECTIONS = ["Suggestions", "Questions", "Improvements", "Future options"] as const;

const TEMPLATE = `# Now & Next ideas

Plain bullets, so nothing here shows in the planner. Add from anywhere with Cmd+P → "Add a plugin idea".

${SECTIONS.map((s) => `## ${s}\n`).join("\n")}`;

/** Adds one bullet under the chosen heading of the ideas note. */
export class IdeaModal extends Modal {
  private section: (typeof SECTIONS)[number] = "Suggestions";

  constructor(private plugin: NowAndNextPlugin) { super(plugin.app); }

  onOpen() {
    this.setTitle("Add a plugin idea");
    new Setting(this.contentEl).setName("Heading").addDropdown((d) => {
      for (const s of SECTIONS) d.addOption(s, s);
      d.setValue(this.section).onChange((v) => { this.section = v as (typeof SECTIONS)[number]; });
    });
    const input = this.contentEl.createEl("textarea", { cls: "nn-modal-input nn-capture-multi", attr: { rows: "3" } });
    input.placeholder = "The idea, question or improvement (Enter saves)";
    const save = async () => {
      const v = input.value.replace(/\s+/g, " ").trim();
      if (!v) return;
      this.close();
      await this.append(v);
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void save(); } });
    new Setting(this.contentEl).addButton((b) => b.setButtonText("Save").setCta().onClick(save));
    window.setTimeout(() => input.focus(), 0);
  }

  private async append(text: string) {
    const { app } = this.plugin;
    const path = normalizePath(this.plugin.settings.ideasNote || "Now & Next ideas.md");
    let file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      const dir = path.split("/").slice(0, -1).join("/");
      if (dir && !app.vault.getAbstractFileByPath(dir)) await app.vault.createFolder(dir);
      file = await app.vault.create(path, TEMPLATE);
    }
    const heading = `## ${this.section}`;
    await app.vault.process(file as TFile, (data) => {
      const lines = data.split("\n");
      let i = lines.findIndex((l) => l.trim() === heading);
      if (i < 0) { lines.push("", heading); i = lines.length - 1; }
      // Insert after the last line of this section (before the next heading).
      let end = i + 1;
      while (end < lines.length && !/^#{1,6} /.test(lines[end])) end++;
      let at = end;
      while (at > i + 1 && lines[at - 1].trim() === "") at--;
      lines.splice(at, 0, `- ${text}`);
      return lines.join("\n");
    });
    new Notice(`Added to ${this.section}`, 1500);
  }

  onClose() { this.contentEl.empty(); }
}
