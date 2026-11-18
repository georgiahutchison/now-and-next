import { Notice } from "obsidian";
import type NowAndNextPlugin from "./main";

/** One countdown at a time, shown in the status bar. No log, no score. */
export class Timer {
  private el: HTMLElement;
  private handle: number | null = null;
  private endsAt = 0;
  private label = "";

  constructor(private plugin: NowAndNextPlugin) {
    this.el = plugin.addStatusBarItem();
    this.el.addClass("nn-timer", "mod-clickable");
    this.el.setAttr("aria-label", "Click to stop the timer");
    this.el.addEventListener("click", () => this.stop());
    this.el.hide();
  }

  start(label: string, minutes = this.plugin.settings.timerMinutes) {
    this.stop(true);
    this.label = label;
    this.endsAt = Date.now() + minutes * 60_000;
    this.el.show();
    this.tick();
    this.handle = window.setInterval(() => this.tick(), 1000);
    new Notice(`Timer started: ${minutes} min`, 2000);
  }

  stop(silent = false) {
    if (this.handle !== null) window.clearInterval(this.handle);
    const wasRunning = this.handle !== null;
    this.handle = null;
    this.el.hide();
    if (wasRunning && !silent) new Notice("Timer stopped", 1500);
  }

  private tick() {
    const left = Math.max(0, this.endsAt - Date.now());
    const m = Math.floor(left / 60000);
    const s = Math.floor((left % 60000) / 1000);
    const short = this.label.length > 28 ? this.label.slice(0, 27) + "…" : this.label;
    this.el.setText(`⏱ ${m}:${String(s).padStart(2, "0")} · ${short}`);
    if (left <= 0) {
      this.stop(true);
      chime();
      new Notice(`Time's up: ${this.label}`, 10000);
    }
  }
}

function chime() {
  try {
    const ctx = new AudioContext();
    const notes = [660, 880];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.connect(g); g.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.25;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      o.start(t); o.stop(t + 0.65);
    });
  } catch { /* no audio available */ }
}
