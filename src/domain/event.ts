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
  /** Fixed 15-minute interaction interval. Kept in schema for older backups. */
  slotMinutes: 10 | 15 | 20 | 30;
  displayStartHour: number;
  displayEndHour: number;
  showCurrentTime: boolean;
  showNextEvent: boolean;
  showOverlaps: boolean;
  backupReminderDays: 0 | 7 | 14 | 30;
  lastBackupCreatedAt?: string;
}

export const EVENT_COLOR_PALETTE = [
  { name: "ローズ", value: "#F2B8C6" },
  { name: "ピーチ", value: "#F6CCAA" },
  { name: "レモン", value: "#F5E3A3" },
  { name: "セージ", value: "#C6DDB9" },
  { name: "ミント", value: "#B9DED4" },
  { name: "スカイ", value: "#BBD3EC" },
  { name: "ラベンダー", value: "#D1C2EA" },
  { name: "グレー", value: "#D9DDE5" }
] as const;

export const DEFAULT_EVENT_COLOR = EVENT_COLOR_PALETTE[5].value;

export const DEFAULT_SETTINGS: CalendarSettings = {
  schemaVersion: 1,
  slotMinutes: 15,
  displayStartHour: 0,
  displayEndHour: 24,
  showCurrentTime: true,
  showNextEvent: true,
  showOverlaps: true,
  backupReminderDays: 14
};

export function isValidEvent(value: unknown): value is CalendarEvent {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Partial<CalendarEvent>;
  if (typeof event.id !== "string" || !event.id) return false;
  if (typeof event.title !== "string" || !event.title.trim()) return false;
  if (typeof event.destination !== "string") return false;
  if (typeof event.memo !== "string") return false;
  if (typeof event.startAt !== "string" || typeof event.endAt !== "string") return false;
  if (typeof event.createdAt !== "string" || typeof event.updatedAt !== "string") return false;
  if (event.color !== undefined && typeof event.color !== "string") return false;
  const start = Date.parse(event.startAt);
  const end = Date.parse(event.endAt);
  return Number.isFinite(start) && Number.isFinite(end) && Number.isFinite(Date.parse(event.createdAt)) && Number.isFinite(Date.parse(event.updatedAt)) && end > start;
}
