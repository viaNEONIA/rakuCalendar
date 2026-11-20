import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { DEFAULT_SETTINGS } from "../src/domain/event";
import type { CalendarEvent } from "../src/domain/event";

const storageState = vi.hoisted(() => ({ events: [] as CalendarEvent[] }));
vi.mock("../src/storage/database", () => ({
  listEvents: async () => storageState.events,
  getSettings: async () => ({ ...DEFAULT_SETTINGS }),
  saveSettings: vi.fn(),
  saveEvent: vi.fn(),
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
    storageState.events = [event];
    root = createRoot(container);
    await act(async () => { root?.render(<App />); });
  });

  afterEach(async () => {
    if (root) await act(async () => { root?.unmount(); });
    root = undefined;
    container.remove();
    storageState.events = [];
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
    expect(container.querySelectorAll(".resize-handle")).toHaveLength(2);

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
});
