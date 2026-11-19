// Calendar (ICS) parsing. Times are checked in Sydney time, whatever the machine's zone.
process.env.TZ = "Australia/Sydney";
import { test } from "node:test";
import assert from "node:assert/strict";
import { expandEvents, nextDay } from "../src/calendar.ts";

const SYDNEY = `BEGIN:VTIMEZONE
TZID:Australia/Sydney
BEGIN:STANDARD
TZOFFSETFROM:+1100
TZOFFSETTO:+1000
TZNAME:AEST
DTSTART:19700405T030000
RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU
END:STANDARD
BEGIN:DAYLIGHT
TZOFFSETFROM:+1000
TZOFFSETTO:+1100
TZNAME:AEDT
DTSTART:19701004T020000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=1SU
END:DAYLIGHT
END:VTIMEZONE`;

const cal = (...parts: string[]) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//EN", ...parts, "END:VCALENDAR"].join("\r\n");

const vevent = (...lines: string[]) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n");

const brief = (ics: string, from: string, to: string) =>
  expandEvents(ics, "Test", from, to).map((e) => `${e.day} ${e.time ?? "all day"} ${e.title}`);

test("nextDay crosses month ends", () => {
  assert.equal(nextDay("2026-11-30"), "2026-12-01");
  assert.equal(nextDay("2026-12-31"), "2027-01-01");
});

test("all-day event sits on its day only (DTEND is the day after)", () => {
  const ics = cal(vevent("UID:a1", "DTSTART;VALUE=DATE:20261125", "DTEND;VALUE=DATE:20261126", "SUMMARY:Mum's birthday"));
  assert.deepEqual(brief(ics, "2026-11-01", "2026-11-30"), ["2026-11-25 all day Mum's birthday"]);
});

test("multi-day all-day event covers each day, cut to the range", () => {
  const ics = cal(vevent("UID:a2", "DTSTART;VALUE=DATE:20261124", "DTEND;VALUE=DATE:20261127", "SUMMARY:Conference"));
  assert.deepEqual(brief(ics, "2026-11-25", "2026-11-30"), ["2026-11-25 all day Conference", "2026-11-26 all day Conference"]);
});

test("UTC time is shown in local time, on the local day", () => {
  const ics = cal(vevent("UID:t1", "DTSTART:20261124T223000Z", "DTEND:20261124T233000Z", "SUMMARY:Supervision"));
  assert.deepEqual(brief(ics, "2026-11-24", "2026-11-25"), ["2026-11-25 09:30 Supervision"]);
});

test("weekly repeat with EXDATE, a moved and a cancelled occurrence (Google style)", () => {
  const ics = cal(
    SYDNEY,
    vevent("UID:w1", "DTSTART;TZID=Australia/Sydney:20261102T100000", "DTEND;TZID=Australia/Sydney:20261102T110000",
      "RRULE:FREQ=WEEKLY;BYDAY=MO", "EXDATE;TZID=Australia/Sydney:20261109T100000", "SUMMARY:Team check-in"),
    vevent("UID:w1", "RECURRENCE-ID;TZID=Australia/Sydney:20261116T100000",
      "DTSTART;TZID=Australia/Sydney:20261117T140000", "DTEND;TZID=Australia/Sydney:20261117T150000", "SUMMARY:Team check-in (moved)"),
    vevent("UID:w1", "RECURRENCE-ID;TZID=Australia/Sydney:20261123T100000", "STATUS:CANCELLED",
      "DTSTART;TZID=Australia/Sydney:20261123T100000", "DTEND;TZID=Australia/Sydney:20261123T110000", "SUMMARY:Team check-in"),
  );
  assert.deepEqual(brief(ics, "2026-11-01", "2026-12-07"), [
    "2026-11-02 10:00 Team check-in",
    "2026-11-17 14:00 Team check-in (moved)",
    "2026-11-30 10:00 Team check-in",
    "2026-12-07 10:00 Team check-in",
  ]);
});

test("Outlook-style Windows zone name, defined in the feed", () => {
  const ics = cal(
    SYDNEY.replace("TZID:Australia/Sydney", "TZID:AUS Eastern Standard Time"),
    vevent("UID:o1", "DTSTART;TZID=AUS Eastern Standard Time:20261120T083000",
      "DTEND;TZID=AUS Eastern Standard Time:20261120T090000", "SUMMARY:GP appointment"),
  );
  assert.deepEqual(brief(ics, "2026-11-20", "2026-11-20"), ["2026-11-20 08:30 GP appointment"]);
});

test("time zone conversion: a London event lands on the right Sydney day and hour", () => {
  const london = `BEGIN:VTIMEZONE
TZID:Europe/London
BEGIN:STANDARD
TZOFFSETFROM:+0100
TZOFFSETTO:+0000
TZNAME:GMT
DTSTART:19701025T020000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
BEGIN:DAYLIGHT
TZOFFSETFROM:+0000
TZOFFSETTO:+0100
TZNAME:BST
DTSTART:19700329T010000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
END:VTIMEZONE`;
  const ics = cal(london, vevent("UID:l1", "DTSTART;TZID=Europe/London:20261120T200000", "DTEND;TZID=Europe/London:20261120T210000", "SUMMARY:Call with Lucy"));
  // 20:00 GMT is 07:00 the next morning in Sydney (AEDT, +11).
  assert.deepEqual(brief(ics, "2026-11-20", "2026-11-21"), ["2026-11-21 07:00 Call with Lucy"]);
});

test("daily repeat with COUNT stops; yearly all-day repeat finds this year's date", () => {
  const ics = cal(
    vevent("UID:d1", "DTSTART:20261118T220000Z", "RRULE:FREQ=DAILY;COUNT=3", "SUMMARY:Meds"),
    vevent("UID:y1", "DTSTART;VALUE=DATE:19901122", "DTEND;VALUE=DATE:19901123", "RRULE:FREQ=YEARLY", "SUMMARY:Anniversary"),
  );
  assert.deepEqual(brief(ics, "2026-11-18", "2026-11-25"), [
    "2026-11-19 09:00 Meds",
    "2026-11-20 09:00 Meds",
    "2026-11-21 09:00 Meds",
    "2026-11-22 all day Anniversary",
  ]);
});

test("cancelled events, events outside the range and untitled events", () => {
  const ics = cal(
    vevent("UID:c1", "DTSTART:20261120T000000Z", "STATUS:CANCELLED", "SUMMARY:Cancelled thing"),
    vevent("UID:c2", "DTSTART:20261001T000000Z", "SUMMARY:Last month"),
    vevent("UID:c3", "DTSTART;VALUE=DATE:20261121"),
  );
  assert.deepEqual(brief(ics, "2026-11-01", "2026-11-30"), ["2026-11-21 all day Untitled event"]);
});

test("same day: all-day first, then by time", () => {
  const ics = cal(
    vevent("UID:s1", "DTSTART:20261120T030000Z", "SUMMARY:Afternoon"),
    vevent("UID:s2", "DTSTART;VALUE=DATE:20261120", "SUMMARY:Whole day"),
    vevent("UID:s3", "DTSTART:20261119T220000Z", "SUMMARY:Morning"),
  );
  assert.deepEqual(brief(ics, "2026-11-20", "2026-11-20"), ["2026-11-20 all day Whole day", "2026-11-20 09:00 Morning", "2026-11-20 14:00 Afternoon"]);
});
