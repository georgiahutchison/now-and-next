import { App, ButtonComponent, FuzzySuggestModal, Modal, Setting } from "obsidian";

/** Pick one item from a list by typing part of its name. */
export class PickModal<T> extends FuzzySuggestModal<T> {
  constructor(app: App, private items: T[], private label: (x: T) => string, private onPick: (x: T) => unknown, placeholder: string) {
    super(app);
    this.setPlaceholder(placeholder);
  }
  getItems() { return this.items; }
  getItemText(x: T) { return this.label(x); }
  onChooseItem(x: T) { void this.onPick(x); }
}

interface TextPromptOpts {
  title: string;
  hint?: string;
  placeholder?: string;
  value?: string;
  cta: string;
  allowEmpty?: boolean;
  onSubmit: (v: string) => unknown;
}

export class TextPromptModal extends Modal {
  constructor(app: App, private o: TextPromptOpts) { super(app); }

  onOpen() {
    const { contentEl } = this;
    this.setTitle(this.o.title);
    if (this.o.hint) contentEl.createEl("p", { text: this.o.hint, cls: "nn-modal-hint" });
    const input = contentEl.createEl("input", { type: "text", cls: "nn-modal-input" });
    input.placeholder = this.o.placeholder ?? "";
    input.value = this.o.value ?? "";
    const submit = () => {
      const v = input.value;
      if (!v.trim() && !this.o.allowEmpty) return;
      this.close();
      void this.o.onSubmit(v);
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
    new Setting(contentEl).addButton((b) => b.setButtonText(this.o.cta).setCta().onClick(submit));
    window.setTimeout(() => input.focus(), 0);
  }

  onClose() { this.contentEl.empty(); }
}

export class DatePromptModal extends Modal {
  constructor(app: App, private initial: string, private onPick: (d: string) => unknown, private titleText = "Pick a day", private cta = "Move") { super(app); }

  onOpen() {
    this.setTitle(this.titleText);
    const input = this.contentEl.createEl("input", { type: "date", cls: "nn-modal-input" });
    input.value = this.initial;
    const go = () => { if (input.value) { this.close(); void this.onPick(input.value); } };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    new Setting(this.contentEl).addButton((b) => b.setButtonText(this.cta).setCta().onClick(go));
    window.setTimeout(() => input.focus(), 0);
  }

  onClose() { this.contentEl.empty(); }
}

/** A step-through modal: each step renders into the body; Back / Next / Finish below. */
export class StepModal extends Modal {
  private i = 0;
  constructor(app: App, private titleText: string, private steps: { title: string; render: (el: HTMLElement, rerender: () => void) => void }[]) {
    super(app);
  }

  onOpen() { this.modalEl.addClass("nn-step-modal"); this.draw(); }

  private draw() {
    const { contentEl } = this;
    contentEl.empty();
    const step = this.steps[this.i];
    this.setTitle(`${this.titleText} · ${this.i + 1} of ${this.steps.length}`);
    contentEl.createEl("h3", { text: step.title, cls: "nn-step-title" });
    const body = contentEl.createDiv({ cls: "nn-step-body" });
    step.render(body, () => this.draw());
    const nav = contentEl.createDiv({ cls: "nn-step-nav" });
    if (this.i > 0) new ButtonComponent(nav).setButtonText("Back").onClick(() => { this.i--; this.draw(); });
    const last = this.i === this.steps.length - 1;
    new ButtonComponent(nav).setButtonText(last ? "Finish" : "Next").setCta().onClick(() => {
      if (last) this.close(); else { this.i++; this.draw(); }
    });
  }

  onClose() { this.contentEl.empty(); }
}
