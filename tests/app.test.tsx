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
    if (type === "pointerdown") await new Promise((resolve) => setTimeout(resolve, 340));
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
    expect(container.querySelector(".add-button")).toBeNull();
    expect(container.querySelector(".resize-handle")).toBeNull();

    await click(container.querySelector(".event-card"));
    expect(container.querySelector('[role="dialog"] h2')?.textContent).toBe("予定の詳細");
    expect(container.querySelector(".event-detail-memo")?.textContent).toBe("閲覧確認");
    await click(container.querySelector('[aria-label="閉じる"]'));

    await click(container.querySelector(".mode-toggle"));
    expect(container.querySelector(".app-shell")?.classList.contains("is-edit-mode")).toBe(true);
    expect(container.querySelector(".add-button")).not.toBeNull();
    expect(container.querySelectorAll(".resize-handle")).toHaveLength(4);

    await click(container.querySelector(".event-card"));
    expect(container.querySelector('[role="dialog"] h2')?.textContent).toBe("予定を編集");
    expect(container.querySelectorAll(".color-swatch")).toHaveLength(8);
    await click(container.querySelector('[aria-label="閉じる"]'));

    await click(container.querySelector(".add-button"));
    const timeInputs = Array.from(container.querySelectorAll<HTMLInputElement>('input[name="startAt"], input[name="endAt"]'));
    expect(timeInputs.map((input) => input.step)).toEqual(["900", "900"]);
    expect(timeInputs[0].value.slice(-2)).toMatch(/^(00|15|30|45)$/);
    expect(timeInputs[1].value.slice(-2)).toMatch(/^(00|15|30|45)$/);
    expect(new Date(timeInputs[1].value).getTime() - new Date(timeInputs[0].value).getTime()).toBe(30 * 60_000);
  });

  it("jumps to the next day that has a scheduled event", async () => {
    const today = new Date();
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    const expected = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
    await click(container.querySelector(".scheduled-day-button"));
    expect(container.querySelector<HTMLInputElement>('[aria-label="表示日"]')?.value).toBe(expected);
    expect(container.querySelector(".event-card")?.textContent).toContain("翌日の予定");
  });

  it("allows deliberate overlap when times are entered in the edit form", async () => {
    await click(container.querySelector(".mode-toggle"));
    await click(container.querySelector(".event-card"));
    const startInput = container.querySelector<HTMLInputElement>('input[name="startAt"]');
    const endInput = container.querySelector<HTMLInputElement>('input[name="endAt"]');
    const form = container.querySelector<HTMLFormElement>(".event-form");
    if (!startInput || !endInput || !form) throw new Error("Expected edit form fields were not rendered");
    const date = startInput.value.slice(0, 10);
    startInput.value = `${date}T10:15`;
    endInput.value = `${date}T10:45`;
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
});
