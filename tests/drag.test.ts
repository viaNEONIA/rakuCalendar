import { describe, expect, it } from "vitest";
import { changeEventTime, hasPointerScrollIntent, pointerScrollDelta, snapMinutes } from "../src/domain/time";
import type { CalendarEvent } from "../src/domain/event";

const base: CalendarEvent = {
  id: "move-me", title: "予定", destination: "", startAt: "2026-11-21T00:00:00.000Z", endAt: "2026-11-21T00:30:00.000Z", memo: "", createdAt: "", updatedAt: ""
};

describe("touch timeline time changes", () => {
  it("snaps pointer movement to the selected interval", () => {
    expect(snapMinutes(13, 72, 10)).toBe(10);
    expect(snapMinutes(20, 72, 10)).toBe(20);
  });

  it("prioritizes a small scroll gesture over opening an event", () => {
    expect(hasPointerScrollIntent(200, 205)).toBe(false);
    expect(hasPointerScrollIntent(200, 207)).toBe(true);
    expect(hasPointerScrollIntent(200, 193)).toBe(true);
  });

  it("scrolls the timeline opposite to the finger movement before long press", () => {
    expect(pointerScrollDelta(300, 340)).toBe(-40);
    expect(pointerScrollDelta(340, 300)).toBe(40);
  });

  it("moves an event while preserving its duration", () => {
    const moved = changeEventTime(base, "move", 20, 10);
    expect(Date.parse(moved.startAt) - Date.parse(base.startAt)).toBe(20 * 60_000);
    expect(Date.parse(moved.endAt) - Date.parse(base.endAt)).toBe(20 * 60_000);
    expect(Date.parse(moved.endAt) - Date.parse(moved.startAt)).toBe(30 * 60_000);
  });

  it("resizes only the dragged edge and prevents zero length", () => {
    const startChanged = changeEventTime(base, "resize-start", 10, 10);
    expect(startChanged.endAt).toBe(base.endAt);
    const endChanged = changeEventTime(base, "resize-end", -50, 10);
    expect(endChanged.startAt).toBe(base.startAt);
    expect(Date.parse(endChanged.endAt) - Date.parse(endChanged.startAt)).toBe(10 * 60_000);
  });
});
