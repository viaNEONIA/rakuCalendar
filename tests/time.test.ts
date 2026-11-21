import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "../src/domain/event";
import { dayEvents, defaultEventRange, getNextEvent, layoutOverlaps, nearestQuarterHourMinute, nextScheduledDay, resolveDragOverlaps, snapMinutes } from "../src/domain/time";

function event(id: string, start: string, end: string): CalendarEvent {
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  const date = new Date(2026, 10, 21);
  const startAt = new Date(date.getFullYear(), date.getMonth(), date.getDate(), startHour, startMinute).toISOString();
  const endAt = new Date(date.getFullYear(), date.getMonth(), date.getDate(), endHour, endMinute).toISOString();
  return { id, title: id, destination: "", startAt, endAt, memo: "", createdAt: "", updatedAt: "" };
}

describe("day timeline calculations", () => {
  it("starts a new event at the next quarter hour and defaults to a 30-minute duration", () => {
    const { start, end } = defaultEventRange(new Date(2026, 10, 21), new Date(2026, 10, 21, 9, 17));
    expect(start.getHours()).toBe(9);
    expect(start.getMinutes()).toBe(30);
    expect(end.getTime() - start.getTime()).toBe(30 * 60_000);
  });

  it("starts a new event after the next scheduled event and skips a gap that is too short", () => {
    const day = new Date(2026, 10, 21);
    const now = new Date(2026, 10, 21, 9, 0);
    const events = [event("next", "10:00", "10:30"), event("later", "10:45", "11:00")];
    const { start, end } = defaultEventRange(day, now, events);
    expect(start.getHours()).toBe(11);
    expect(start.getMinutes()).toBe(0);
    expect(end.getMinutes()).toBe(30);
  });

  it("keeps the selected day at the end of the day when quarter-hour rounding would cross midnight", () => {
    const { start, end } = defaultEventRange(new Date(2026, 10, 21), new Date(2026, 10, 21, 23, 50));
    expect(start.getDate()).toBe(21);
    expect(start.getHours()).toBe(23);
    expect(start.getMinutes()).toBe(45);
    expect(end.getDate()).toBe(22);
  });

  it("snaps empty timeline taps to the nearest quarter hour", () => {
    expect(nearestQuarterHourMinute(9 * 60 + 7)).toBe(9 * 60);
    expect(nearestQuarterHourMinute(9 * 60 + 8)).toBe(9 * 60 + 15);
  });

  it("snaps drag movement to 15-minute increments", () => {
    expect(snapMinutes(17, 72, 15)).toBe(15);
    expect(snapMinutes(19, 72, 15)).toBe(15);
    expect(snapMinutes(28, 72, 15)).toBe(30);
  });

  it("snaps a dragged event to the nearest free 15-minute boundary instead of overlapping", () => {
    const moving = event("moving", "09:00", "09:30");
    const blocked = event("blocked", "10:00", "10:30");
    const proposed = { ...moving, startAt: new Date(2026, 10, 21, 9, 45).toISOString(), endAt: new Date(2026, 10, 21, 10, 15).toISOString() };
    const resolved = resolveDragOverlaps(moving, proposed, "move", [blocked]);
    expect(new Date(resolved.startAt).getTime()).toBe(new Date(2026, 10, 21, 9, 30).getTime());
    expect(Date.parse(resolved.endAt)).toBeLessThanOrEqual(Date.parse(blocked.startAt));
  });

  it("snaps forward to the next free boundary when a drag crosses an event", () => {
    const moving = event("moving", "09:00", "09:30");
    const blocked = event("blocked", "10:00", "10:30");
    const proposed = { ...moving, startAt: new Date(2026, 10, 21, 10, 15).toISOString(), endAt: new Date(2026, 10, 21, 10, 45).toISOString() };
    const resolved = resolveDragOverlaps(moving, proposed, "move", [blocked]);
    expect(new Date(resolved.startAt).getTime()).toBe(new Date(2026, 10, 21, 10, 30).getTime());
    expect(Date.parse(blocked.endAt)).toBeLessThanOrEqual(Date.parse(resolved.startAt));
  });

  it("keeps a resized event outside the neighboring event", () => {
    const resizing = event("resizing", "09:00", "09:30");
    const blocked = event("blocked", "10:00", "10:30");
    const proposed = { ...resizing, endAt: new Date(2026, 10, 21, 10, 15).toISOString() };
    const resolved = resolveDragOverlaps(resizing, proposed, "resize-end", [blocked]);
    expect(Date.parse(resolved.endAt)).toBe(Date.parse(blocked.startAt));
  });
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

  it("separates zero-duration events with identical start and end times", () => {
    const layout = layoutOverlaps([event("zero-a", "09:00", "09:00"), event("zero-b", "09:00", "09:00")]);
    expect(layout.map((item) => item.column)).toEqual([0, 1]);
    expect(layout.map((item) => item.columns)).toEqual([2, 2]);
  });

  it("selects the active event first, otherwise the nearest upcoming event", () => {
    const events = [event("later", "11:00", "12:00"), event("active", "09:00", "10:30")];
    expect(getNextEvent(events, new Date(2026, 10, 21, 9, 15))?.id).toBe("active");
    expect(getNextEvent(events, new Date(2026, 10, 21, 10, 45))?.id).toBe("later");
  });

  it("finds the next day with an event, including the continuation of an overnight event", () => {
    const overnight = event("overnight", "23:30", "23:59");
    overnight.endAt = new Date(2026, 10, 22, 1, 0).toISOString();
    expect(nextScheduledDay([overnight], "2026-11-21")).toBe("2026-11-22");
    expect(nextScheduledDay([event("later", "09:00", "09:30")], "2026-11-21")).toBeUndefined();
  });
});
