export interface CalendarEvent {
  id: string;
  title: string;
  destination: string;
  startAt: string;
  endAt: string;
  memo: string;
  color?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarSettings {
  schemaVersion: 1;
  slotMinutes: 10 | 20 | 30;
  displayStartHour: number;
  displayEndHour: number;
  showCurrentTime: boolean;
  showNextEvent: boolean;
}

export const DEFAULT_SETTINGS: CalendarSettings = {
  schemaVersion: 1,
  slotMinutes: 10,
  displayStartHour: 0,
  displayEndHour: 24,
  showCurrentTime: true,
  showNextEvent: true
};

export function isValidEvent(value: unknown): value is CalendarEvent {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Partial<CalendarEvent>;
  if (typeof event.id !== "string" || !event.id) return false;
  if (typeof event.title !== "string" || !event.title.trim()) return false;
  if (typeof event.destination !== "string") return false;
  if (typeof event.memo !== "string") return false;
  if (typeof event.startAt !== "string" || typeof event.endAt !== "string") return false;
  const start = Date.parse(event.startAt);
  const end = Date.parse(event.endAt);
  return Number.isFinite(start) && Number.isFinite(end) && end > start;
}
