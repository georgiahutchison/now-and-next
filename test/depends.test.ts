import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTaskLine, newTaskLine } from "../src/tasks.ts";
import { idIndex, openBlockers } from "../src/depends.ts";
import { goals, dependencyOrder, chainSpans, waitsOnGoals, isOpenStatus, span } from "../src/goals.ts";

test("⛔ is read as a list of 🆔s and kept out of the wording", () => {
  const t = parseTaskLine("- [ ] Write the Results ⛔ method,data ⏳ 2026-11-24")!;
  assert.deepEqual(t.waitsOn, ["method", "data"]);
  assert.equal(t.text, "Write the Results");
});

test("waiting: blocked while a named task is open; ready once done or cancelled; unknown ids ignored", () => {
  const a = { id: "method", status: " " };
  const b = { id: "data", status: "x" };
  const c = { waitsOn: ["method", "data", "nobody"], status: " " };
  const ix = idIndex([a, b, c]);
  assert.deepEqual(openBlockers(c, ix), [a]);
  a.status = "x";
  assert.deepEqual(openBlockers(c, ix), []);
  a.status = "-";
  assert.deepEqual(openBlockers(c, ix), []);
  assert.deepEqual(openBlockers({ waitsOn: ["nobody"], status: " " }, ix), []);
});

test("custom statuses such as ? count as open; done and cancelled do not", () => {
  assert.equal(isOpenStatus("?"), true);
  assert.equal(isOpenStatus(" "), true);
  assert.equal(isOpenStatus("x"), false);
  assert.equal(isOpenStatus("-"), false);
});

const task = (line: string, key: string) => ({ ...parseTaskLine(line)!, key, path: "plan.md", project: null });

test("milestones: order follows ⛔; an undated goal starts after the milestone it waits on", () => {
  const tasks = [
    task("- [ ] Submit the thesis #milestone 🆔 submit ⛔ revise 📅 2026-12-14", "a"),
    task("- [ ] Revise after feedback #milestone 🆔 revise ⛔ draft", "b"),
    task("- [ ] Send Jen the draft #milestone 🆔 draft 📅 2026-12-03", "c"),
  ];
  const list = goals(tasks);
  const ordered = dependencyOrder(list).map((g) => g.id);
  assert.deepEqual(ordered, ["draft", "revise", "submit"]);
  const revise = list.find((g) => g.id === "revise")!;
  assert.deepEqual(waitsOnGoals(revise, list).map((g) => g.id), ["draft"]);
  const spans = new Map(list.map((g) => [g, span(g, "2026-11-22", () => undefined)]));
  chainSpans(list, spans);
  assert.equal(spans.get(revise)!.start, "2026-12-04");
});

test("a new task can be added toward a milestone", () => {
  assert.equal(newTaskLine("Check figures", { forId: "draft" }), "- [ ] Check figures [for:: draft]");
});
