import { test } from "node:test";
import assert from "node:assert/strict";
import { habits, lastDays } from "../src/habits.ts";

test("habits: groups copies of a repeating task and collects its done days", () => {
  const rows = habits([
    { text: "Morning dog walk", recurrence: "every day", status: " " },
    { text: "Morning dog walk", recurrence: "every day", status: "x", done: "2026-11-18" },
    { text: "Morning dog walk", recurrence: "every day", status: "x", done: "2026-11-17" },
    { text: "Thesis session", recurrence: "every day", status: " " },
    { text: "Pay bills", recurrence: "every week", status: " ", start: "2027-01-01" }, // deferred: not shown
    { text: "Old habit", recurrence: "every day", status: "x", done: "2026-10-01" },  // no open copy: not shown
    { text: "One-off", status: " " },                                                 // not repeating
  ], "2026-11-19");
  assert.deepEqual(rows.map((r) => r.name), ["Morning dog walk", "Thesis session"]);
  assert.deepEqual([...rows[0].days].sort(), ["2026-11-17", "2026-11-18"]);
  assert.equal(rows[1].days.size, 0);
});

test("lastDays: n days ending today, across a month end", () => {
  assert.deepEqual(lastDays("2026-12-02", 4), ["2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02"]);
});
