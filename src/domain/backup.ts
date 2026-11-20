import { DEFAULT_SETTINGS, isValidEvent } from "./event";
import type { CalendarEvent, CalendarSettings } from "./event";

export interface CalendarBackup {
  format: "rakuCalendar-backup";
  schemaVersion: number;
  appVersion: string;
  exportedAt: string;
  timezone: string;
  events: CalendarEvent[];
  settings: CalendarSettings;
}

export function makeBackup(events: CalendarEvent[], settings: CalendarSettings, now = new Date()): CalendarBackup {
  return { format: "rakuCalendar-backup", schemaVersion: 1, appVersion: "0.1.0", exportedAt: now.toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, events, settings };
}

export function parseBackup(text: string): CalendarBackup {
  if (text.length > 20_000_000) throw new Error("バックアップファイルが大きすぎます。");
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error("JSONを読み取れません。ファイル内容を確認してください。"); }
  if (!parsed || typeof parsed !== "object") throw new Error("バックアップ形式が正しくありません。");
  const value = parsed as Partial<CalendarBackup>;
  if (value.format !== "rakuCalendar-backup") throw new Error("rakuCalendarのバックアップではありません。");
  if (!Number.isInteger(value.schemaVersion) || !value.schemaVersion || value.schemaVersion > 1) throw new Error("このバックアップのスキーマには対応していません。");
  if (value.schemaVersion !== 1) throw new Error("この古いバックアップ形式の移行処理はまだありません。");
  if (!Array.isArray(value.events) || value.events.length > 50_000 || !value.events.every(isValidEvent)) throw new Error("予定データに不正な項目があります。");
  const ids = new Set<string>();
  for (const event of value.events) {
    if (ids.has(event.id)) throw new Error("同じIDの予定が重複しています。");
    ids.add(event.id);
  }
  if (!value.settings || typeof value.settings !== "object") throw new Error("設定データがありません。");
  const settings = value.settings as CalendarSettings;
  if (![10, 15, 20, 30].includes(settings.slotMinutes) || ![0, 7, 14, 30].includes(settings.backupReminderDays) || typeof settings.showCurrentTime !== "boolean" || typeof settings.showNextEvent !== "boolean" || typeof settings.showOverlaps !== "boolean" || !Number.isInteger(settings.displayStartHour) || !Number.isInteger(settings.displayEndHour) || settings.displayStartHour < 0 || settings.displayStartHour > 23 || settings.displayEndHour < 1 || settings.displayEndHour > 24 || settings.displayStartHour >= settings.displayEndHour) throw new Error("設定データの値が正しくありません。");
  if (typeof value.exportedAt !== "string" || !Number.isFinite(Date.parse(value.exportedAt))) throw new Error("バックアップ日時が正しくありません。");
  if (typeof value.timezone !== "string" || typeof value.appVersion !== "string") throw new Error("バックアップの情報が不足しています。");
  if (settings.lastBackupCreatedAt !== undefined && (typeof settings.lastBackupCreatedAt !== "string" || !Number.isFinite(Date.parse(settings.lastBackupCreatedAt)))) throw new Error("最終バックアップ日時が正しくありません。");
  return { ...value, settings: { ...DEFAULT_SETTINGS, ...settings, slotMinutes: 15 }, events: value.events } as CalendarBackup;
}

export function eventsEqual(a: CalendarEvent, b: CalendarEvent): boolean {
  return a.id === b.id && a.title === b.title && a.destination === b.destination && a.startAt === b.startAt && a.endAt === b.endAt && a.memo === b.memo && a.color === b.color;
}
