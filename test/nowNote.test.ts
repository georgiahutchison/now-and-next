import { test } from "node:test";
import assert from "node:assert/strict";
import { nowNextText } from "../src/nowNote.ts";

test("Now and Next note: two tasks", () => {
  assert.equal(nowNextText("2026-11-20", "Book dentist", "Call landlord"),
    "Now: Book dentist\nNext: Call landlord\n\nAs of 2026-11-20\n");
});

test("Now and Next note: one task, then none", () => {
  assert.equal(nowNextText("2026-11-20", "Book dentist"), "Now: Book dentist\nNext: nothing after this\n\nAs of 2026-11-20\n");
  assert.equal(nowNextText("2026-11-20"), "Now: nothing left for today\nNext: nothing\n\nAs of 2026-11-20\n");
});
