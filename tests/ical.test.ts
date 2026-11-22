import { describe, expect, it } from "vitest";
import { createICalendar, foldIcalLine, parseICalendar } from "../src/domain/ical";
import type { CalendarEvent } from "../src/domain/event";

const event: CalendarEvent = {
  id: "sample-1", title: "打ち合わせ,確認;追加\\メモ", destination: "会議室, 1", startAt: "2026-11-21T00:00:00.000Z", endAt: "2026-11-21T00:30:00.000Z", memo: "一行目\n二行目", createdAt: "2026-11-20T00:00:00.000Z", updatedAt: "2026-11-20T00:00:00.000Z"
};

describe("iCalendar export", () => {
  it("escapes text fields and writes timestamps in UTC with CRLF", () => {
    const calendar = createICalendar([event], new Date("2026-11-20T12:34:56.000Z"));
    expect(calendar).toContain("SUMMARY:打ち合わせ\\,確認\\;追加\\\\メモ");
    expect(calendar).toContain("DESCRIPTION:一行目\\n二行目");
    expect(calendar).toContain("DTSTART:20261121T000000Z");
    expect(calendar).toContain("DTSTAMP:20261120T123456Z");
    expect(calendar).toContain("\r\n");
    expect(calendar.endsWith("\r\n")).toBe(true);
  });

  it("folds long lines without breaking multibyte characters", () => {
    const folded = foldIcalLine(`SUMMARY:${"予".repeat(80)}`);
    const byteLengths = folded.split("\r\n").map((part) => new TextEncoder().encode(part).length);
    expect(byteLengths.every((length) => length <= 75)).toBe(true);
    expect(folded.replace(/\r\n /g, "")).toBe(`SUMMARY:${"予".repeat(80)}`);
  });
});

describe("iCalendar import", () => {
  it("reads timed events, unescapes fields, and resolves TZID timestamps", () => {
    const calendar = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:tokyo-1@example.test",
      "DTSTART;TZID=Asia/Tokyo:20261125T090000",
      "DTEND;TZID=Asia/Tokyo:20261125T094500",
      "SUMMARY:出張\\, 会議",
      "LOCATION:本社\\;2階",
      "DESCRIPTION:一行目\\n二行目",
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\r\n");
    const parsed = parseICalendar(calendar, new Date("2026-11-20T00:00:00.000Z"));
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0]).toMatchObject({
      title: "出張, 会議",
      destination: "本社;2階",
      memo: "一行目\n二行目",
      startAt: "2026-11-25T00:00:00.000Z",
      endAt: "2026-11-25T00:45:00.000Z"
    });
    expect(parsed.skippedCount).toBe(0);
  });

  it("unfolds lines, supports UTC and DURATION, and reports unsupported events", () => {
    const calendar = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:utc-1",
      "DTSTART:20261125T090000Z",
      "DURATION:PT30M",
      "SUMMARY:折り返された",
      " タイトル",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:all-day",
      "DTSTART;VALUE=DATE:20261126",
      "DTEND;VALUE=DATE:20261127",
      "SUMMARY:終日",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:repeat",
      "DTSTART:20261127T090000Z",
      "DTEND:20261127T093000Z",
      "RRULE:FREQ=WEEKLY",
      "SUMMARY:繰り返し",
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\n");
    const parsed = parseICalendar(calendar);
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0].title).toBe("折り返されたタイトル");
    expect(parsed.events[0].endAt).toBe("2026-11-25T09:30:00.000Z");
    expect(parsed.skippedCount).toBe(2);
    expect(parsed.warnings.join("\n")).toContain("終日予定は未対応");
    expect(parsed.warnings.join("\n")).toContain("繰り返し予定は未対応");
  });

  it("uses stable IDs to prevent duplicate imports and rejects invalid calendars", () => {
    const calendar = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:same-uid",
      "DTSTART:20261125T090000Z",
      "DTEND:20261125T093000Z",
      "SUMMARY:一件目",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:same-uid",
      "DTSTART:20261125T100000Z",
      "DTEND:20261125T103000Z",
      "SUMMARY:重複UID",
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\r\n");
    const first = parseICalendar(calendar);
    const second = parseICalendar(calendar);
    expect(first.events).toHaveLength(1);
    expect(first.events[0].id).toBe(second.events[0].id);
    expect(first.skippedCount).toBe(1);
    expect(() => parseICalendar("not a calendar")).toThrow(/iCalendar形式/);
  });

  it("imports the app's exported events", () => {
    const imported = parseICalendar(createICalendar([event], new Date("2026-11-20T12:34:56.000Z")));
    expect(imported.events).toHaveLength(1);
    expect(imported.events[0]).toMatchObject({
      title: event.title,
      destination: event.destination,
      startAt: event.startAt,
      endAt: event.endAt,
      memo: event.memo
    });
  });
});
