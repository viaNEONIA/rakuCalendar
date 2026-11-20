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
      request.onsuccess = () => resolve({ ...DEFAULT_SETTINGS, ...(request.result?.value as Partial<CalendarSettings> | undefined), slotMinutes: 15 });
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function restoreData(
  events: CalendarEvent[],
  settings: CalendarSettings,
  mode: "merge" | "replace",
  conflictPolicy: "keep-local" | "use-backup" = "keep-local"
): Promise<{ added: number; updated: number; skipped: number }> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction([EVENT_STORE, SETTINGS_STORE], "readwrite");
      const eventStore = tx.objectStore(EVENT_STORE);
      let summary = { added: 0, updated: 0, skipped: 0 };
      const writeSettings = () => tx.objectStore(SETTINGS_STORE).put({ key: "current", value: { ...DEFAULT_SETTINGS, ...settings, slotMinutes: 15 } });
      if (mode === "replace") {
        eventStore.clear();
        for (const event of events) eventStore.put(event);
        summary.added = events.length;
        writeSettings();
      } else {
        const request = eventStore.getAll();
        request.onsuccess = () => {
          const existing = new Map((request.result as CalendarEvent[]).map((event) => [event.id, event]));
          for (const event of events) {
            const previous = existing.get(event.id);
            if (!previous) { eventStore.put(event); summary.added += 1; }
            else if (previous.title === event.title && previous.destination === event.destination && previous.startAt === event.startAt && previous.endAt === event.endAt && previous.memo === event.memo && previous.color === event.color) summary.skipped += 1;
            else if (conflictPolicy === "use-backup") { eventStore.put(event); summary.updated += 1; }
            else summary.skipped += 1;
          }
          writeSettings();
        };
      }
      tx.oncomplete = () => resolve(summary);
      tx.onerror = () => reject(tx.error ?? new Error("復元に失敗しました"));
      tx.onabort = () => reject(tx.error ?? new Error("復元を取り消しました"));
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
