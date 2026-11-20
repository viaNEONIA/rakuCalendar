import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "../src/domain/event";
import { dayEvents, getNextEvent, layoutOverlaps } from "../src/domain/time";

function event(id: string, start: string, end: string): CalendarEvent {
  return { id, title: id, destination: "", startAt: `2026-11-21T${start}:00+09:00`, endAt: `2026-11-21T${end}:00+09:00`, memo: "", createdAt: "", updatedAt: "" };
}

describe("day timeline calculations", () => {
  it("returns events intersecting a selected day, including overnight events", () => {
    const previousNight = new Date(2026, 10, 21, 23, 30);
    const nextMorning = new Date(2026, 10, 22, 0, 30);
    const nextDay = { ...event("late", "23:30", "23:59"), startAt: previousNight.toISOString(), endAt: nextMorning.toISOString() };
    expect(dayEvents([nextDay], new Date(2026, 10, 22))).toHaveLength(1);
  });

  it("places two and three overlapping events in distinct columns", () => {
    const layout = layoutOverlaps([event("a", "09:00", "10:00"), event("b", "09:20", "10:20"), event("c", "09:40", "10:40")]);
    expect(layout.map((item) => item.column)).toEqual([0, 1, 2]);
    expect(layout.map((item) => item.columns)).toEqual([3, 3, 3]);
  });

  it("selects the active event first, otherwise the nearest upcoming event", () => {
    const events = [event("later", "11:00", "12:00"), event("active", "09:00", "10:30")];
    expect(getNextEvent(events, new Date("2026-11-21T00:15:00Z"))?.id).toBe("active");
    expect(getNextEvent(events, new Date("2026-11-21T02:00:00Z"))?.id).toBe("later");
  });
});
