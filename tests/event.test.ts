import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, isValidEvent } from "../src/domain/event";

const validEvent = {
  id: "event-1",
  title: "打ち合わせ",
  destination: "",
  startAt: "2026-11-21T09:00:00+09:00",
  endAt: "2026-11-21T09:30:00+09:00",
  memo: "",
  createdAt: "2026-11-20T12:00:00+09:00",
  updatedAt: "2026-11-20T12:00:00+09:00"
};

describe("calendar foundation", () => {
  it("provides a supported default settings schema", () => {
    expect(DEFAULT_SETTINGS.schemaVersion).toBe(1);
    expect([10, 20, 30]).toContain(DEFAULT_SETTINGS.slotMinutes);
  });

  it("accepts an event with a positive duration", () => {
    expect(isValidEvent(validEvent)).toBe(true);
  });

  it("rejects empty titles and non-positive durations", () => {
    expect(isValidEvent({ ...validEvent, title: " " })).toBe(false);
    expect(isValidEvent({ ...validEvent, endAt: validEvent.startAt })).toBe(false);
  });
});
