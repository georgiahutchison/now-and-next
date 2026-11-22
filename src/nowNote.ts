/** The text of the Now and Next note: today's two Focus tasks, then the day it is for. */
export function nowNextText(today: string, now?: string, next?: string): string {
  const lines = now
    ? [`Now: ${now}`, `Next: ${next ?? "nothing after this"}`]
    : ["Now: nothing left for today", "Next: nothing"];
  return `${lines.join("\n")}\n\nAs of ${today}\n`;
}
