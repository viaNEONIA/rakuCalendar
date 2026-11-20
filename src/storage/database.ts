import type { CalendarEvent, CalendarSettings } from "../domain/event";
import { DEFAULT_SETTINGS } from "../domain/event";

const DB_NAME = "rakuCalendar";
const DB_VERSION = 1;
const EVENT_STORE = "events";
const SETTINGS_STORE = "settings";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(EVENT_STORE)) {
        const events = db.createObjectStore(EVENT_STORE, { keyPath: "id" });
        events.createIndex("startAt", "startAt");
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDBを開けませんでした"));
  });
}

export async function listEvents(): Promise<CalendarEvent[]> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(EVENT_STORE, "readonly").objectStore(EVENT_STORE).getAll();
      request.onsuccess = () => resolve(request.result as CalendarEvent[]);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function saveEvent(event: CalendarEvent): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(EVENT_STORE, "readwrite").objectStore(EVENT_STORE).put(event);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function deleteEvent(id: string): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(EVENT_STORE, "readwrite").objectStore(EVENT_STORE).delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function getSettings(): Promise<CalendarSettings> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(SETTINGS_STORE, "readonly").objectStore(SETTINGS_STORE).get("current");
      request.onsuccess = () => resolve((request.result?.value as CalendarSettings | undefined) ?? DEFAULT_SETTINGS);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function saveSettings(settings: CalendarSettings): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(SETTINGS_STORE, "readwrite").objectStore(SETTINGS_STORE).put({ key: "current", value: settings });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
