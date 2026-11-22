import { describe, expect, it } from "vitest";
import { DEFAULT_EVENT_COLOR, DEFAULT_SETTINGS, EVENT_COLOR_PALETTE, getNextEventColor, isValidEvent, isValidEventImageDataUrl } from "../src/domain/event";

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
    expect(DEFAULT_SETTINGS.slotMinutes).toBe(15);
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

  it("accepts supported image data URLs and rejects invalid or oversized data", () => {
    expect(isValidEventImageDataUrl("data:image/png;base64,aGVsbG8=")).toBe(true);
    expect(isValidEventImageDataUrl("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false);
    expect(isValidEventImageDataUrl(`data:image/png;base64,${"a".repeat(7_000_000)}`)).toBe(false);
    expect(isValidEvent({ ...validEvent, imageDataUrl: "data:image/png;base64,aGVsbG8=" })).toBe(true);
  });

  it("rejects empty titles and non-positive durations", () => {
    expect(isValidEvent({ ...validEvent, title: " " })).toBe(false);
    expect(isValidEvent({ ...validEvent, endAt: validEvent.startAt })).toBe(false);
  });

  it("assigns a distinct light color even after the palette is exhausted", () => {
    expect(getNextEventColor([{ ...validEvent, id: "legacy-no-color" }])).not.toBe(DEFAULT_EVENT_COLOR);
    const events = EVENT_COLOR_PALETTE.map((color, index) => ({ ...validEvent, id: `event-${index}`, color: color.value }));
    const nextColor = getNextEventColor(events);
    expect(events.some((event) => event.color?.toLowerCase() === nextColor.toLowerCase())).toBe(false);
    const channels = nextColor.slice(1).match(/../g)?.map((channel) => Number.parseInt(channel, 16)) ?? [];
    expect(Math.min(...channels)).toBeGreaterThanOrEqual(160);
  });
});
