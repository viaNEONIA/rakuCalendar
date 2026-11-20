import { beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { DEFAULT_SETTINGS } from "../src/domain/event";
import { makeBackup, parseBackup } from "../src/domain/backup";
import type { CalendarEvent } from "../src/domain/event";
import { getSettings, listEvents, restoreData } from "../src/storage/database";

const sample: CalendarEvent = {
  id: "a", title: "予定A", destination: "駅", startAt: "2026-11-21T00:00:00.000Z", endAt: "2026-11-21T00:30:00.000Z", memo: "", createdAt: "2026-11-20T00:00:00.000Z", updatedAt: "2026-11-20T00:00:00.000Z"
};

function deleteDb() {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("rakuCalendar");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

describe("JSON backup and restore", () => {
  beforeEach(async () => { await deleteDb(); });

  it("exports a schema v1 backup and rejects malformed or future data", () => {
    const backup = makeBackup([sample], DEFAULT_SETTINGS, new Date("2026-11-20T00:00:00Z"));
    expect(parseBackup(JSON.stringify(backup)).events).toEqual([sample]);
    expect(() => parseBackup("{" )).toThrow();
    expect(() => parseBackup(JSON.stringify({ ...backup, schemaVersion: 2 }))).toThrow(/対応していません/);
  });

  it("merges without duplicating identical IDs and requires a policy for conflicts", async () => {
    await restoreData([sample], DEFAULT_SETTINGS, "replace");
    const identical = await restoreData([sample], DEFAULT_SETTINGS, "merge");
    expect(identical).toEqual({ added: 0, updated: 0, skipped: 1 });
    const changed = { ...sample, title: "バックアップ版" };
    const kept = await restoreData([changed], DEFAULT_SETTINGS, "merge", "keep-local");
    expect(kept.skipped).toBe(1);
    const replaced = await restoreData([changed], DEFAULT_SETTINGS, "merge", "use-backup");
    expect(replaced.updated).toBe(1);
    expect((await listEvents())[0].title).toBe("バックアップ版");
  });

  it("replaces events and settings in one restore operation", async () => {
    await restoreData([sample], DEFAULT_SETTINGS, "replace");
    const replacement = { ...sample, id: "b", title: "置き換え" };
    const settings = { ...DEFAULT_SETTINGS, slotMinutes: 30 as const, showCurrentTime: false };
    const summary = await restoreData([replacement], settings, "replace");
    expect(summary.added).toBe(1);
    expect((await listEvents()).map((event) => event.id)).toEqual(["b"]);
    expect((await getSettings()).slotMinutes).toBe(15);
  });

  it("normalizes older drag-interval settings to the fixed 15-minute interval", () => {
    const backup = makeBackup([], { ...DEFAULT_SETTINGS, slotMinutes: 30 }, new Date("2026-11-20T00:00:00Z"));
    expect(parseBackup(JSON.stringify(backup)).settings.slotMinutes).toBe(15);
  });
});
