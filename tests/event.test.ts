import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, EVENT_COLOR_PALETTE, isValidEvent } from "../src/domain/event";

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

  it("offers only light colors in the event palette", () => {
    expect(EVENT_COLOR_PALETTE).toHaveLength(8);
    for (const { value } of EVENT_COLOR_PALETTE) {
      const channels = value.slice(1).match(/../g)?.map((channel) => Number.parseInt(channel, 16)) ?? [];
      expect(channels).toHaveLength(3);
      expect(Math.min(...channels)).toBeGreaterThanOrEqual(160);
    }
  });

  it("accepts an event with a positive duration", () => {
    expect(isValidEvent(validEvent)).toBe(true);
  });

  it("rejects empty titles and non-positive durations", () => {
    expect(isValidEvent({ ...validEvent, title: " " })).toBe(false);
    expect(isValidEvent({ ...validEvent, endAt: validEvent.startAt })).toBe(false);
  });
});
