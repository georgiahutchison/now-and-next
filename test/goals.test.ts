import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTaskLine, setFor, setId, removeTags, setText, displayText } from "../src/tasks.ts";
import { goals, numbers, byArea, makeId, matchesFrom, goalOf, daysLeftLabel, isMilestone } from "../src/goals.ts";

// Lines in the shape of the thesis plan note (read only, used as example data).
const DRAFT = "- [ ] Send Jen the draft of the Method and Results [est:: 30m] [from:: #4-Method #5-Results] 🔺 ⏳ 2026-12-01 📅 2026-12-03 🆔 draft #milestone #energy/mid #7-Submit";
const SUBMIT = "- [ ] Submit the thesis [from:: #7-Submit] 🔺 📅 2026-12-14 🆔 submit #milestone";

test("parse: 🆔, [from:: …] and [for:: …]", () => {
  const m = parseTaskLine(DRAFT)!;
  assert.equal(m.id, "draft");
  assert.deepEqual(m.from, { tags: ["4-Method", "5-Results"], places: [] });
  assert.ok(isMilestone(m));
  // Tags inside [from:: …] are not the milestone's own tags.
  assert.ok(!m.tags.includes("4-Method"));
  assert.ok(m.tags.includes("7-Submit"));
  assert.equal(m.text, "Send Jen the draft of the Method and Results");

  const t = parseTaskLine("- [ ] Abstract [est:: 30m] [for:: submit] #energy/mid #7-Submit")!;
  assert.equal(t.forId, "submit");
  assert.equal(t.text, "Abstract");
});

test("parse: [from:: …] with areas or folders after a comma", () => {
  const m = parseTaskLine("- [ ] Term done [from:: #uni, 2 Areas/health, reflections] #milestone")!;
  assert.deepEqual(m.from, { tags: ["uni"], places: ["2 Areas/health", "reflections"] });
});

test("setFor: adds before the Tasks fields, replaces, clears", () => {
  const line = "- [ ] Abstract [est:: 30m] #energy/mid 📅 2026-12-10";
  const a = setFor(line, "submit");
  assert.equal(a, "- [ ] Abstract [est:: 30m] #energy/mid [for:: submit] 📅 2026-12-10");
  assert.equal(parseTaskLine(a)!.due, "2026-12-10");
  assert.equal(parseTaskLine(setFor(a, "draft"))!.forId, "draft");
  assert.equal(setFor(a, null), line);
});

test("setId adds a 🆔; removeTags and setText keep [from:: …] whole", () => {
  assert.equal(parseTaskLine(setId("- [ ] Draft #milestone", "draft"))!.id, "draft");
  const kept = removeTags(DRAFT, ["4-Method", "7-Submit"]);
  assert.ok(kept.includes("[from:: #4-Method #5-Results]"));
  assert.ok(!/ #7-Submit/.test(kept));
  const renamed = setText(DRAFT, "Send Jen the draft");
  assert.ok(renamed.includes("[from:: #4-Method #5-Results]"));
  assert.equal(parseTaskLine(renamed)!.id, "draft");
  assert.equal(displayText("Read it [for:: draft] [from:: #a]"), "Read it");
});

type T = ReturnType<typeof mk>;
function mk(line: string, extra: { path?: string; project?: string | null; day?: string } = {}) {
  const p = parseTaskLine(line)!;
  return { ...p, key: line, path: extra.path ?? "05 Thesis Writing/Thesis plan to submission.md", project: extra.project ?? null, day: extra.day ?? p.scheduled ?? p.due };
}

function sample(): T[] {
  return [
    mk(DRAFT),
    mk(SUBMIT),
    mk("- [ ] Method: participants, measures [est:: 1h30m] ⏳ 2026-11-20 #4-Method", { project: "05 Thesis Writing" }),
    mk("- [x] Results, questions 1 and 2 [est:: 2h] #5-Results ✅ 2026-11-19", { project: "04 Analysis" }),
    mk("- [ ] Results: Iteration 2 [est:: 2h] #5-Results", { project: "04 Analysis" }),
    mk("- [ ] Use of AI statement [est:: 1h] #7-Submit"),
    mk("- [ ] Abstract #7-Submit [for:: draft]"),                 // override: counts toward the draft
    mk("- [ ] Word count #7-Submit [for:: none]"),               // kept out of every milestone
    mk("- [-] Old idea #4-Method ❌ 2026-11-18"),                // cancelled: not counted
    mk("- [ ] Pragmatism paragraph #3-Iteration-2"),             // matches nothing
  ];
}

test("goals: [for::] decides first, then [from::]; cancelled and unmatched left out", () => {
  const list = goals(sample());
  assert.deepEqual(list.map((g) => g.name), ["draft", "submit"]);
  const [draft, submit] = list;
  assert.deepEqual(draft.members.map((t) => t.text).sort(), [
    "Abstract", "Method: participants, measures", "Results, questions 1 and 2", "Results: Iteration 2",
  ]);
  assert.deepEqual(submit.members.map((t) => t.text), ["Use of AI statement"]);
  const tasks = sample();
  const l2 = goals(tasks);
  assert.equal(goalOf(tasks.find((t) => t.text === "Pragmatism paragraph")!, l2), undefined);
  assert.equal(goalOf(tasks.find((t) => t.text === "Word count")!, l2), undefined);
});

test("goals: a tag shared by two milestones feeds the open one with the nearest date", () => {
  const tasks = [
    mk("- [x] Draft [from:: #7-Submit] 📅 2026-12-03 🆔 draft #milestone ✅ 2026-12-02"),
    mk(SUBMIT),
    mk("- [ ] Abstract #7-Submit"),
  ];
  const [submit, draft] = goals(tasks);
  assert.equal(submit.name, "submit");
  assert.equal(draft.name, "draft");
  assert.deepEqual(submit.members.map((t) => t.text), ["Abstract"]);
});

test("numbers: done of total, hours left, not on a day, days left", () => {
  const [draft] = goals(sample());
  const n = numbers(draft, "2026-11-19", (t) => !!t.day);
  assert.equal(n.total, 4);
  assert.equal(n.done, 1);
  assert.equal(n.minutesLeft, 90 + 120);
  assert.equal(n.unestimated, 1);   // Abstract
  assert.equal(n.notOnADay, 2);     // Results: Iteration 2, Abstract
  assert.equal(n.daysLeft, 14);
  assert.equal(n.finished, false);
});

test("numbers: a goal without a date is finished when all its tasks are done", () => {
  const tasks = [
    mk("- [ ] Rag rug [from:: creative] 🆔 rug #milestone"),
    mk("- [x] Cut strips ✅ 2026-11-10", { project: "creative" }),
    mk("- [x] Warp the loom ✅ 2026-11-12", { project: "creative" }),
  ];
  const [g] = goals(tasks);
  assert.equal(g.kind, "goal");
  const n = numbers(g, "2026-11-19", () => false);
  assert.equal(n.daysLeft, undefined);
  assert.equal(n.finished, true);
  const empty = goals([mk("- [ ] Someday 🆔 someday #milestone")])[0];
  assert.equal(numbers(empty, "2026-11-19", () => false).finished, false);
});

test("byArea: done and total per area, largest first", () => {
  const [draft] = goals(sample());
  assert.deepEqual(byArea(draft), [
    { area: "04 Analysis", done: 1, total: 2 },
    { area: "", done: 0, total: 1 },
    { area: "05 Thesis Writing", done: 0, total: 1 },
  ]);
});

test("matchesFrom: folders and area names", () => {
  const t = mk("- [ ] Walk", { path: "2 Areas/health/exercise program/Movement routines.md", project: "health" });
  assert.ok(matchesFrom(t, { tags: [], places: ["2 Areas/health"] }));
  assert.ok(matchesFrom(t, { tags: [], places: ["Health"] }));
  assert.ok(!matchesFrom(t, { tags: [], places: ["2 Areas/heal"] }));
  assert.ok(matchesFrom(mk("- [ ] x #4-Method/write"), { tags: ["4-method"], places: [] }));
});

test("makeId and daysLeftLabel", () => {
  assert.equal(makeId("Send Jen the draft", []), "send-jen");
  assert.equal(makeId("Send Jen the draft", ["send-jen"]), "send-jen-2");
  assert.equal(makeId("None", []), "none-2");
  assert.equal(daysLeftLabel(0), "Due today");
  assert.equal(daysLeftLabel(1), "1 day left");
  assert.equal(daysLeftLabel(-3), "3 days past");
});

test("span: bar from the earliest task day to the 📅 date; done tasks on their ✅ day; undated counted", async () => {
  const { span } = await import("../src/goals.ts");
  const [draft] = goals(sample());
  const s = span(draft, "2026-11-19", (t) => t.day);
  assert.equal(s.start, "2026-11-19");             // Results 1 and 2, done 19 Nov
  assert.equal(s.end, "2026-12-03");
  assert.equal(s.openEnd, false);
  assert.deepEqual(s.dots.map((d) => [d.day, d.done]), [["2026-11-19", true], ["2026-11-20", false]]);
  assert.deepEqual(s.undated.map((t) => t.text).sort(), ["Abstract", "Results: Iteration 2"]);
});

test("span: a goal without a date runs to its last task; no tasks: today only", async () => {
  const { span } = await import("../src/goals.ts");
  const tasks = [
    mk("- [ ] Rug [from:: creative] 🆔 rug #milestone"),
    mk("- [ ] Weave ⏳ 2026-11-25", { project: "creative" }),
    mk("- [x] Cut ✅ 2026-11-10", { project: "creative" }),
  ];
  const s = span(goals(tasks)[0], "2026-11-19", (t) => t.day);
  assert.deepEqual([s.start, s.end, s.openEnd], ["2026-11-10", "2026-11-25", true]);
  const e = span(goals([mk("- [ ] Someday 🆔 x #milestone")])[0], "2026-11-19", () => undefined);
  assert.deepEqual([e.start, e.end], ["2026-11-19", "2026-11-19"]);
  const past = span(goals([mk("- [ ] Missed 📅 2026-11-01 🆔 m #milestone")])[0], "2026-11-19", () => undefined);
  assert.deepEqual([past.start, past.end], ["2026-11-01", "2026-11-01"]);
});

test("dayRange: inclusive, across a month end", async () => {
  const { dayRange } = await import("../src/goals.ts");
  assert.deepEqual(dayRange("2026-11-29", "2026-12-01"), ["2026-11-29", "2026-11-30", "2026-12-01"]);
});
