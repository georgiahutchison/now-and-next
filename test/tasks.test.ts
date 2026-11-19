import { test } from "node:test";
import assert from "node:assert/strict";
import {
  areaLabel,
  parseTaskLine, parseFile, setDate, setPriority, setEnergy, setEstimate, setStatus,
  addTag, setText, tagFor, removeTags, newTaskLine, parseDuration, formatMinutes, addDays, mondayOf, weekday, daysBetween,
} from "../src/tasks.ts";

test("parses fields, tags, energy, estimate", () => {
  const t = parseTaskLine("- [ ] Call dentist [est:: 30m] ⏫ 🔁 every week ⏳ 2026-11-20 📅 2026-11-21 #health #energy/low ^abc")!;
  assert.equal(t.status, " ");
  assert.equal(t.priority, "high");
  assert.equal(t.scheduled, "2026-11-20");
  assert.equal(t.due, "2026-11-21");
  assert.equal(t.recurrence, "every week");
  assert.equal(t.estimateMin, 30);
  assert.equal(t.energy, "low");
  assert.deepEqual(t.tags, ["health", "energy/low"]);
  assert.equal(t.text, "Call dentist");
});

test("non-task lines", () => {
  assert.equal(parseTaskLine("- plain bullet"), null);
  assert.equal(parseTaskLine("text"), null);
  assert.ok(parseTaskLine("\t- [x] done thing ✅ 2026-11-01"));
});

test("setDate adds, replaces and removes; keeps block id last", () => {
  let l = "- [ ] thing ^id1";
  l = setDate(l, "scheduled", "2026-11-20");
  assert.equal(l, "- [ ] thing ⏳ 2026-11-20 ^id1");
  l = setDate(l, "scheduled", "2026-11-22");
  assert.equal(l, "- [ ] thing ⏳ 2026-11-22 ^id1");
  l = setDate(l, "scheduled", null);
  assert.equal(l, "- [ ] thing ^id1");
});

test("setPriority goes before dates", () => {
  assert.equal(setPriority("- [ ] a ⏳ 2026-11-20", "highest"), "- [ ] a 🔺 ⏳ 2026-11-20");
  assert.equal(setPriority("- [ ] a 🔺 ⏳ 2026-11-20", "none"), "- [ ] a ⏳ 2026-11-20");
  assert.equal(setPriority("- [ ] a", "low"), "- [ ] a 🔽");
});

test("setEstimate stays before fields so Tasks still reads them", () => {
  const l = setEstimate("- [ ] write ⏫ ⏳ 2026-11-20 #money", 90);
  assert.equal(l, "- [ ] write [est:: 1h30m] ⏫ ⏳ 2026-11-20 #money");
  const t = parseTaskLine(l)!;
  assert.equal(t.estimateMin, 90);
  assert.equal(t.scheduled, "2026-11-20");
  assert.equal(setEstimate(l, null), "- [ ] write ⏫ ⏳ 2026-11-20 #money");
});

test("setEnergy and addTag", () => {
  assert.equal(setEnergy("- [ ] a #energy/low", "high"), "- [ ] a #energy/high");
  assert.equal(setEnergy("- [ ] a #energy/low", null), "- [ ] a");
  assert.equal(addTag("- [ ] a #health", "health"), "- [ ] a #health");
  assert.equal(addTag("- [ ] a", "#travel"), "- [ ] a #travel");
});

test("setStatus", () => {
  assert.equal(setStatus("  - [ ] a", "w"), "  - [w] a");
});

test("newTaskLine", () => {
  assert.equal(newTaskLine("buy milk", { tag: "money", scheduled: "2026-11-20" }), "- [ ] buy milk #money ⏳ 2026-11-20");
});

test("parseFile finds parents and skips code fences", () => {
  const c = ["- [ ] parent", "\t- [ ] child", "\t\t- [x] grandchild", "- [ ] sibling", "```", "- [ ] in fence", "```", "text", "  - [ ] orphan"].join("\n");
  const ts = parseFile(c);
  assert.equal(ts.length, 5);
  assert.equal(ts[1].parentLine, 0);
  assert.equal(ts[2].parentLine, 1);
  assert.equal(ts[3].parentLine, null);
  assert.equal(ts[4].parentLine, null);
});

test("durations", () => {
  assert.equal(parseDuration("30m"), 30);
  assert.equal(parseDuration("1h"), 60);
  assert.equal(parseDuration("1h30m"), 90);
  assert.equal(parseDuration("1.5h"), 90);
  assert.equal(parseDuration("45"), 45);
  assert.equal(parseDuration("soon"), null);
  assert.equal(formatMinutes(90), "1h 30m");
});

test("dates", () => {
  assert.equal(addDays("2026-11-30", 1), "2026-12-01");
  assert.equal(mondayOf("2026-11-19"), "2026-11-16");
  assert.equal(mondayOf("2026-11-22"), "2026-11-16");
  assert.equal(weekday("2026-11-16"), 0);
  assert.equal(daysBetween("2026-11-16", "2026-11-19"), 3);
});

test("plain bullets under a task are details, not sub-tasks", () => {
  const c = ["- [ ] travel", "\t- [ ] prescriptions", "\t\t- Phenergan 25 mg", "\t- [ ] order sodii", "- [ ] glow up", "\t- keratin", "\t- halo", "", "POTS", "  - [ ] armpit"].join("\n");
  const ts = parseFile(c);
  assert.equal(ts.length, 5);
  assert.deepEqual(ts[1].details, ["Phenergan 25 mg"]);
  assert.equal(ts[2].parentLine, 0);
  assert.deepEqual(ts[3].details, ["keratin", "halo"]);
  assert.equal(ts[4].parentLine, null);
});

test("setText changes the wording and keeps fields, tags and block id", () => {
  assert.equal(
    setText("- [ ] Call dentist [est:: 30m] ⏫ 🔁 every week ⏳ 2026-11-20 #health ^abc", "Ring the dentist"),
    "- [ ] Ring the dentist [est:: 30m] ⏫ 🔁 every week ⏳ 2026-11-20 #health ^abc",
  );
  assert.equal(setText("\t- [x] buy #money milk ✅ 2026-11-19", "buy oat milk"), "\t- [x] buy oat milk #money ✅ 2026-11-19");
});

test("area names with spaces become hyphenated tags", () => {
  assert.equal(tagFor("pro practice"), "pro-practice");
  assert.equal(addTag("- [ ] write CV", "pro practice"), "- [ ] write CV #pro-practice");
  assert.deepEqual(parseTaskLine("- [ ] write CV #pro-practice")!.tags, ["pro-practice"]);
});

test("removeTags drops area tags only", () => {
  assert.equal(removeTags("- [ ] cv #health #energy/low #pro-practice", ["health", "pro practice"]), "- [ ] cv #energy/low");
});

test("first wikilink is the task's link; display text shows the link text", () => {
  const t = parseTaskLine("- [ ] ring the bank [[Privacy-Tracker|privacy]] about [[Other]] ⏳ 2026-11-20")!;
  assert.equal(t.link, "Privacy-Tracker");
  assert.equal(t.text, "ring the bank privacy about Other");
});

test("repeat rule stops at non-rule text", () => {
  assert.equal(parseTaskLine("- [ ] pay 🔁 every month on the 1st 👤 G 🛫 2027-01-01")!.recurrence, "every month on the 1st");
});

test("setRecurrence adds after priority and before dates, replaces and removes", async () => {
  const { setRecurrence } = await import("../src/tasks.ts");
  let l = "- [ ] Water plants ⏫ ⏳ 2026-11-20 #home";
  l = setRecurrence(l, "every week");
  assert.equal(l, "- [ ] Water plants ⏫ 🔁 every week ⏳ 2026-11-20 #home");
  assert.equal(parseTaskLine(l)!.recurrence, "every week");
  l = setRecurrence(l, "every 2 weeks");
  assert.equal(l, "- [ ] Water plants ⏫ 🔁 every 2 weeks ⏳ 2026-11-20 #home");
  l = setRecurrence(l, null);
  assert.equal(l, "- [ ] Water plants ⏫ ⏳ 2026-11-20 #home");
  assert.equal(setRecurrence("- [ ] Stretch", "every day"), "- [ ] Stretch 🔁 every day");
});

test("event links: parsed, kept out of the wording, set and removed", async () => {
  const { setEventLink } = await import("../src/tasks.ts");
  const t = parseTaskLine("- [ ] Print chapter [before:: Supervision meeting] ⏫ #uni")!;
  assert.deepEqual(t.eventLink, { kind: "before", title: "Supervision meeting" });
  assert.equal(t.text, "Print chapter");
  let l = setEventLink("- [ ] Send notes ⏳ 2026-11-20 #uni", { kind: "after", title: "Supervision meeting" });
  assert.equal(l, "- [ ] Send notes [after:: Supervision meeting] ⏳ 2026-11-20 #uni");
  l = setEventLink(l, null);
  assert.equal(l, "- [ ] Send notes ⏳ 2026-11-20 #uni");
});

test("areaLabel drops leading numbers and capitalises", () => {
  assert.equal(areaLabel("4 Method"), "Method");
  assert.equal(areaLabel("05 Thesis Writing"), "Thesis Writing");
  assert.equal(areaLabel("1-Decisions"), "Decisions");
  assert.equal(areaLabel("health"), "Health");
  assert.equal(areaLabel("2026"), "2026");
});
