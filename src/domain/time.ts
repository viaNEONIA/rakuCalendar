import type { CalendarEvent } from "./event";

export interface PositionedEvent {
  event: CalendarEvent;
  column: number;
  columns: number;
}

export type DragMode = "move" | "resize-start" | "resize-end";

export function snapMinutes(deltaPixels: number, pixelsPerHour: number, slotMinutes: number): number {
  return Math.round(deltaPixels / pixelsPerHour * 60 / slotMinutes) * slotMinutes;
}

export function pointerScrollDelta(previousY: number, currentY: number): number {
  return previousY - currentY;
}

export function changeEventTime(event: CalendarEvent, mode: DragMode, deltaMinutes: number, slotMinutes: number): CalendarEvent {
  const start = Date.parse(event.startAt);
  const end = Date.parse(event.endAt);
  const slot = slotMinutes * 60_000;
  if (mode === "move") return { ...event, startAt: new Date(start + deltaMinutes * 60_000).toISOString(), endAt: new Date(end + deltaMinutes * 60_000).toISOString() };
  if (mode === "resize-start") {
    const nextStart = Math.min(start + deltaMinutes * 60_000, end - slot);
    return { ...event, startAt: new Date(nextStart).toISOString() };
  }
  const nextEnd = Math.max(end + deltaMinutes * 60_000, start + slot);
  return { ...event, endAt: new Date(nextEnd).toISOString() };
}

export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function localDateTime(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function dateFromKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function dayEvents(events: CalendarEvent[], day: Date): CalendarEvent[] {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
  return events.filter((event) => Date.parse(event.startAt) < end && Date.parse(event.endAt) > start)
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
}

export function getNextEvent(events: CalendarEvent[], now: Date): CalendarEvent | undefined {
  return [...events].filter((event) => Date.parse(event.endAt) > now.getTime())
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))[0];
}

export function layoutOverlaps(events: CalendarEvent[]): PositionedEvent[] {
  const sorted = [...events].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt) || Date.parse(a.endAt) - Date.parse(b.endAt));
  const result: PositionedEvent[] = [];
  let group: PositionedEvent[] = [];
  let active: PositionedEvent[] = [];
  let groupEnd = -Infinity;

  const finishGroup = () => {
    const columns = Math.max(1, ...group.map((item) => item.column + 1));
    group.forEach((item) => { item.columns = columns; });
    result.push(...group);
    group = [];
    active = [];
    groupEnd = -Infinity;
  };

  for (const event of sorted) {
    const start = Date.parse(event.startAt);
    const end = Date.parse(event.endAt);
    if (group.length && start >= groupEnd) finishGroup();
    active = active.filter((item) => Date.parse(item.event.endAt) > start);
    const used = new Set(active.map((item) => item.column));
    let column = 0;
    while (used.has(column)) column += 1;
    const placed = { event, column, columns: 1 };
    group.push(placed);
    active.push(placed);
    groupEnd = Math.max(groupEnd, end);
  }
  if (group.length) finishGroup();
  return result;
}
