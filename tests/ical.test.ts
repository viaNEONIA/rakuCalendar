import { describe, expect, it } from "vitest";
import { createICalendar, foldIcalLine } from "../src/domain/ical";
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
