import type { CalendarEvent } from "./event";

export interface PositionedEvent {
  event: CalendarEvent;
  column: number;
  columns: number;
}

export type DragMode = "move" | "resize-start" | "resize-end";

export const EVENT_TIME_INCREMENT_MINUTES = 15;

const EVENT_DURATION_MINUTES = 30;
const incrementMs = EVENT_TIME_INCREMENT_MINUTES * 60_000;

function ceilToEventIncrement(date: Date): Date {
  const rounded = new Date(date);
  rounded.setSeconds(0, 0);
  rounded.setMinutes(Math.ceil(rounded.getMinutes() / EVENT_TIME_INCREMENT_MINUTES) * EVENT_TIME_INCREMENT_MINUTES);
  return rounded;
}

export function nextAvailableEventRange(startAt: Date, events: CalendarEvent[]): { start: Date; end: Date } {
  let start = ceilToEventIncrement(startAt);
  for (let attempt = 0; attempt <= events.length; attempt += 1) {
    const end = new Date(start.getTime() + EVENT_DURATION_MINUTES * 60_000);
    const collision = events
      .filter((event) => Date.parse(event.startAt) < end.getTime() && Date.parse(event.endAt) > start.getTime())
      .sort((a, b) => Date.parse(a.endAt) - Date.parse(b.endAt))[0];
    if (!collision) return { start, end };
    const afterCollision = new Date(Math.max(start.getTime() + incrementMs, Date.parse(collision.endAt)));
    start = ceilToEventIncrement(afterCollision);
  }
  const end = new Date(start.getTime() + EVENT_DURATION_MINUTES * 60_000);
  return { start, end };
}

export function defaultEventRange(day: Date, now: Date, events: CalendarEvent[] = []): { start: Date; end: Date } {
  const dayEventsList = dayEvents(events, day);
  const next = dayEventsList.find((event) => Date.parse(event.endAt) > now.getTime());
  let requestedStart = next
    ? new Date(Math.max(day.getTime(), Date.parse(next.endAt)))
    : new Date(day.getFullYear(), day.getMonth(), day.getDate(), now.getHours(), now.getMinutes());
  requestedStart = ceilToEventIncrement(requestedStart);
  if (!next && (requestedStart.getFullYear() !== day.getFullYear() || requestedStart.getMonth() !== day.getMonth() || requestedStart.getDate() !== day.getDate())) {
    requestedStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 45);
  }
  return nextAvailableEventRange(requestedStart, events);
}

export function nearestQuarterHourMinute(minuteOfDay: number): number {
  return Math.round(minuteOfDay / EVENT_TIME_INCREMENT_MINUTES) * EVENT_TIME_INCREMENT_MINUTES;
}

export function resolveDragOverlaps(
  original: CalendarEvent,
  proposed: CalendarEvent,
  mode: DragMode,
  otherEvents: CalendarEvent[]
): CalendarEvent {
  const startOf = (event: CalendarEvent) => Date.parse(event.startAt);
  const endOf = (event: CalendarEvent) => Date.parse(event.endAt);
  const referenceTime = mode === "resize-end" ? endOf(proposed) : startOf(proposed);
  const interval = mode === "resize-end" ? "end" : "start";
  const getRange = (value: number): CalendarEvent => mode === "move"
    ? { ...proposed, startAt: new Date(value).toISOString(), endAt: new Date(value + (endOf(original) - startOf(original))).toISOString() }
    : mode === "resize-start"
      ? { ...proposed, startAt: new Date(value).toISOString() }
      : { ...proposed, endAt: new Date(value).toISOString() };
  const overlaps = (candidate: CalendarEvent) => otherEvents.some((event) => startOf(candidate) < endOf(event) && endOf(candidate) > startOf(event));
  if (endOf(proposed) - startOf(proposed) < incrementMs || !overlaps(proposed)) return proposed;

  const floorIncrement = (value: number) => Math.floor(value / incrementMs) * incrementMs;
  const ceilIncrement = (value: number) => Math.ceil(value / incrementMs) * incrementMs;
  const values = new Set<number>([referenceTime, mode === "resize-end" ? endOf(original) : startOf(original)]);
  for (const other of otherEvents) {
    if (mode === "move") {
      const duration = endOf(original) - startOf(original);
      values.add(floorIncrement(startOf(other) - duration));
      values.add(ceilIncrement(endOf(other)));
    } else if (mode === "resize-start") {
      values.add(floorIncrement(startOf(other)));
      values.add(ceilIncrement(endOf(other)));
    } else {
      values.add(floorIncrement(startOf(other)));
      values.add(ceilIncrement(endOf(other)));
    }
  }
  const direction = Math.sign(referenceTime - (interval === "end" ? endOf(original) : startOf(original)));
  const valid = [...values]
    .map(getRange)
    .filter((candidate) => endOf(candidate) - startOf(candidate) >= incrementMs && !overlaps(candidate))
    .sort((a, b) => {
      const aTime = interval === "end" ? endOf(a) : startOf(a);
      const bTime = interval === "end" ? endOf(b) : startOf(b);
      const distance = Math.abs(aTime - referenceTime) - Math.abs(bTime - referenceTime);
      if (distance !== 0) return distance;
      return direction * (bTime - aTime);
    });
  return valid[0] ?? original;
}

export function nextScheduledDay(events: CalendarEvent[], selectedDay: string): string | undefined {
  const day = dateFromKey(selectedDay);
  day.setDate(day.getDate() + 1);
  const nextStart = day.getTime();
  const nextEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
  if (events.some((event) => Date.parse(event.startAt) < nextEnd && Date.parse(event.endAt) > nextStart)) return dayKey(day);
  const upcoming = events
    .map((event) => Date.parse(event.startAt))
    .filter((start) => start >= nextEnd)
    .sort((a, b) => a - b)[0];
  return upcoming === undefined ? undefined : dayKey(new Date(upcoming));
}

export function snapMinutes(deltaPixels: number, pixelsPerHour: number, slotMinutes: number): number {
  return Math.round(deltaPixels / pixelsPerHour * 60 / slotMinutes) * slotMinutes;
}

export const POINTER_SCROLL_THRESHOLD = 6;

export function hasPointerScrollIntent(startY: number, currentY: number): boolean {
  return Math.abs(currentY - startY) > POINTER_SCROLL_THRESHOLD;
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
  let active: Array<{ positioned: PositionedEvent; layoutEnd: number }> = [];
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
    active = active.filter((item) => item.layoutEnd > start);
    const used = new Set(active.map((item) => item.positioned.column));
    let column = 0;
    while (used.has(column)) column += 1;
    const placed = { event, column, columns: 1 };
    group.push(placed);
    const layoutEnd = end > start ? end : start + 37 * 60_000;
    active.push({ positioned: placed, layoutEnd });
    groupEnd = Math.max(groupEnd, layoutEnd);
  }
  if (group.length) finishGroup();
  return result;
}
