import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { DEFAULT_SETTINGS } from "../src/domain/event";
import type { CalendarEvent } from "../src/domain/event";

const storageState = vi.hoisted(() => ({ events: [] as CalendarEvent[], saved: [] as CalendarEvent[] }));
vi.mock("../src/storage/database", () => ({
  listEvents: async () => storageState.events,
  getSettings: async () => ({ ...DEFAULT_SETTINGS }),
  saveSettings: vi.fn(),
  saveEvent: async (event: CalendarEvent) => { storageState.saved.push(event); },
  deleteEvent: vi.fn(),
  restoreData: vi.fn()
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | undefined;

async function click(element: Element | null) {
  if (!element) throw new Error("Expected control was not rendered");
  await act(async () => { element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
}

async function pointer(element: Element, type: string, clientY: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, { pointerId: { value: 7 }, pointerType: { value: "touch" }, clientY: { value: clientY } });
  await act(async () => {
    element.dispatchEvent(event);
    if (type === "pointerdown") await new Promise((resolve) => setTimeout(resolve, 450));
  });
}

describe("calendar viewing and editing modes", () => {
  beforeEach(async () => {
    container = document.createElement("div");
    document.body.append(container);
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 10, 0);
    const event: CalendarEvent = {
      id: "mode-test-event",
      title: "モード切替テスト",
      destination: "会議室",
      startAt: start.toISOString(),
      endAt: new Date(start.getTime() + 30 * 60_000).toISOString(),
      memo: "閲覧確認",
      createdAt: today.toISOString(),
      updatedAt: today.toISOString()
    };
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, 10, 0);
    storageState.events = [event, {
      ...event,
      id: "tomorrow-event",
      title: "翌日の予定",
      startAt: tomorrow.toISOString(),
      endAt: new Date(tomorrow.getTime() + 30 * 60_000).toISOString()
    }, {
      ...event,
      id: "blocked-event",
      title: "後続予定",
      startAt: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 11, 0).toISOString(),
      endAt: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 11, 30).toISOString()
    }];
    storageState.saved = [];
    root = createRoot(container);
    await act(async () => { root?.render(<App />); });
  });

  afterEach(async () => {
    if (root) await act(async () => { root?.unmount(); });
    root = undefined;
    container.remove();
    storageState.events = [];
    storageState.saved = [];
  });

  it("keeps schedule changes out of viewing mode and exposes them in editing mode", async () => {
    expect(container.querySelector(".mode-toggle")?.textContent).toBe("閲覧");
    expect(container.querySelector(".brand-line .mode-toggle")).toBeNull();
    expect(container.querySelector(".now-button")?.textContent).toBe("今の時間帯");
    expect(container.querySelector(".add-button")).toBeNull();
    expect(container.querySelector(".resize-handle")).toBeNull();

    await click(container.querySelector(".event-card"));
    expect(container.querySelector('[role="dialog"] h2')?.textContent).toBe("予定の詳細");
    expect(container.querySelector(".event-detail-memo")?.textContent).toBe("閲覧確認");
    await click(container.querySelector('[aria-label="閉じる"]'));

    await click(container.querySelector(".mode-toggle"));
    expect(container.querySelector(".app-shell")?.classList.contains("is-edit-mode")).toBe(true);
    expect(container.querySelector(".add-button")).not.toBeNull();
    expect(container.querySelectorAll(".resize-handle")).toHaveLength(0);

    await click(container.querySelector(".event-card"));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector(".time-adjust-controls")).not.toBeNull();
    await click(container.querySelector(".event-card"));
    expect(container.querySelector('[role="dialog"] h2')?.textContent).toBe("予定を編集");
    expect(container.querySelectorAll(".color-swatch")).toHaveLength(8);
    await click(container.querySelector('[aria-label="閉じる"]'));

    await click(container.querySelector(".add-button"));
    const timeInputs = Array.from(container.querySelectorAll<HTMLInputElement>('input[name="startHour"], input[name="startMinute"], input[name="endHour"], input[name="endMinute"]'));
    expect(timeInputs.map((input) => input.type)).toEqual(["number", "number", "number", "number"]);
    expect(container.querySelector<HTMLInputElement>('input[name="startMinute"]')?.step).toBe("15");
    expect(container.querySelector<HTMLInputElement>('input[name="endMinute"]')?.step).toBe("15");
    const startMinute = Number(container.querySelector<HTMLInputElement>('input[name="startHour"]')?.value) * 60 + Number(container.querySelector<HTMLInputElement>('input[name="startMinute"]')?.value);
    const endMinute = Number(container.querySelector<HTMLInputElement>('input[name="endHour"]')?.value) * 60 + Number(container.querySelector<HTMLInputElement>('input[name="endMinute"]')?.value);
    expect(endMinute - startMinute).toBe(30);
  });

  it("does not cancel the native click on a short touch", async () => {
    await click(container.querySelector(".mode-toggle"));
    const card = container.querySelector(".event-card");
    if (!card) throw new Error("Expected event card was not rendered");
    const down = new MouseEvent("pointerdown", { bubbles: true, cancelable: true });
    Object.defineProperties(down, { pointerId: { value: 8 }, pointerType: { value: "touch" }, clientY: { value: 120 } });
    await act(async () => { card.dispatchEvent(down); });
    expect(down.defaultPrevented).toBe(false);
    const up = new MouseEvent("pointerup", { bubbles: true, cancelable: true });
    Object.defineProperties(up, { pointerId: { value: 8 }, pointerType: { value: "touch" }, clientY: { value: 120 } });
    await act(async () => { card.dispatchEvent(up); });
    await click(card);
    expect(container.querySelector(".time-adjust-controls")).not.toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("selects with one tap and changes time with the bottom-left arrow controls", async () => {
    await click(container.querySelector(".mode-toggle"));
    const card = container.querySelector(".event-card");
    await click(card);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector(".event-shell")?.classList.contains("is-selected")).toBe(true);
    const laterButton = container.querySelector('[aria-label="15分後へ"]');
    await click(laterButton);
    await click(laterButton);
    await click(laterButton);
    const saved = storageState.saved.at(-1);
    expect(saved?.id).toBe("mode-test-event");
    const start = new Date(saved!.startAt);
    const end = new Date(saved!.endAt);
    const blocked = storageState.events.find((item) => item.id === "blocked-event")!;
    expect(start.getHours()).toBe(10);
    expect(start.getMinutes()).toBe(45);
    expect(end.getHours()).toBe(11);
    expect(end.getMinutes()).toBe(15);
    expect(Date.parse(start.toISOString())).toBeLessThan(Date.parse(blocked.endAt));
    expect(Date.parse(end.toISOString())).toBeGreaterThan(Date.parse(blocked.startAt));
  });

  it("extends and shortens a selected event by exactly 15 minutes", async () => {
    await click(container.querySelector(".mode-toggle"));
    await click(container.querySelector(".event-card"));
    const original = storageState.events.find((item) => item.id === "mode-test-event")!;
    await click(container.querySelector('[aria-label="15分延長"]'));
    const extended = storageState.saved.at(-1)!;
    expect(extended.startAt).toBe(original.startAt);
    expect(Date.parse(extended.endAt) - Date.parse(original.endAt)).toBe(15 * 60_000);
    await click(container.querySelector('[aria-label="15分短縮"]'));
    const shortened = storageState.saved.at(-1)!;
    expect(shortened.startAt).toBe(original.startAt);
    expect(shortened.endAt).toBe(original.endAt);
  });

  it("navigates to previous and next appointments across dates", async () => {
    const today = new Date();
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    await click(container.querySelector('[aria-label="翌日"]'));
    await click(container.querySelector('[aria-label="前の予定"]'));
    const todayKey = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, "0"), String(today.getDate()).padStart(2, "0")].join("-");
    expect(container.querySelector<HTMLInputElement>('[aria-label="表示日"]')?.value).toBe(todayKey);
    await click(container.querySelector('[aria-label="次の予定"]'));
    const tomorrowKey = [tomorrow.getFullYear(), String(tomorrow.getMonth() + 1).padStart(2, "0"), String(tomorrow.getDate()).padStart(2, "0")].join("-");
    expect(container.querySelector<HTMLInputElement>('[aria-label="表示日"]')?.value).toBe(tomorrowKey);
  });

  it("allows deliberate overlap when times are entered in the edit form", async () => {
    await click(container.querySelector(".mode-toggle"));
    await click(container.querySelector(".event-card"));
    await click(container.querySelector(".event-card"));
    const startMinute = container.querySelector<HTMLInputElement>('input[name="startMinute"]');
    const endMinute = container.querySelector<HTMLInputElement>('input[name="endMinute"]');
    const form = container.querySelector<HTMLFormElement>(".event-form");
    if (!startMinute || !endMinute || !form) throw new Error("Expected edit form fields were not rendered");
    startMinute.value = "15";
    endMinute.value = "45";
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(storageState.saved).toHaveLength(1);
    expect(new Date(storageState.saved[0].startAt).getTime()).toBeLessThan(new Date(storageState.events[0].endAt).getTime());
  });

  it("prevents a touch drag from moving a schedule into another event", async () => {
    await click(container.querySelector(".mode-toggle"));
    const timeline = container.querySelector<HTMLElement>(".timeline");
    const card = container.querySelector(".event-card");
    if (!timeline || !card) throw new Error("Expected timeline event was not rendered");
    timeline.getBoundingClientRect = () => ({ top: 0, bottom: 1000, left: 0, right: 400, width: 400, height: 1000, x: 0, y: 0, toJSON: () => ({}) });
    await pointer(card, "pointerdown", 120);
    await pointer(card, "pointermove", 174);
    await pointer(card, "pointerup", 174);
    const saved = storageState.saved.find((item) => item.id === "mode-test-event");
    expect(saved).toBeDefined();
    expect(Date.parse(saved!.endAt)).toBeLessThanOrEqual(Date.parse(storageState.events.find((item) => item.id === "blocked-event")!.startAt));
  });

  it("shows tomorrow's schedule after today's events are finished", async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    storageState.events = storageState.events.map((event) => event.id !== "tomorrow-event"
      ? { ...event, startAt: new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 10).toISOString(), endAt: new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 10, 30).toISOString() }
      : event);
    await act(async () => { root?.unmount(); root = createRoot(container); root.render(<App />); });
    expect(container.querySelector(".tomorrow-card")?.textContent).toContain("本日の予定完了、お疲れさまでした");
    expect(container.querySelector(".tomorrow-card")?.textContent).toContain("翌日の予定");
  });

  it("opens gap-created appointments with the title 移動", async () => {
    await click(container.querySelector(".mode-toggle"));
    const timeline = container.querySelector<HTMLElement>(".timeline");
    if (!timeline) throw new Error("Expected timeline to be rendered");
    timeline.getBoundingClientRect = () => ({ top: 0, bottom: 1800, left: 0, right: 400, width: 400, height: 1800, x: 0, y: 0, toJSON: () => ({}) });
    const tap = new MouseEvent("click", { bubbles: true, cancelable: true });
    Object.defineProperty(tap, "clientY", { value: 9 * 72 });
    await act(async () => { timeline.dispatchEvent(tap); });
    expect(container.querySelector<HTMLInputElement>('input[name="title"]')?.value).toBe("移動");
  });

  it("navigates to a pinned appointment with the pin button", async () => {
    storageState.events = storageState.events.map((event) => event.id === "tomorrow-event" ? { ...event, pinned: true } : event);
    await act(async () => { root?.unmount(); root = createRoot(container); root.render(<App />); });
    await click(container.querySelector('[aria-label="ピン留め予定へ"]'));
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowKey = [tomorrow.getFullYear(), String(tomorrow.getMonth() + 1).padStart(2, "0"), String(tomorrow.getDate()).padStart(2, "0")].join("-");
    expect(container.querySelector<HTMLInputElement>('[aria-label="表示日"]')?.value).toBe(tomorrowKey);
  });
});
