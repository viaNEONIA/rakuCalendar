export interface CalendarEvent {
  id: string;
  title: string;
  destination: string;
  startAt: string;
  endAt: string;
  memo: string;
  color?: string;
  pinned?: boolean;
  imageDataUrl?: string;
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

function generatedPastel(index: number): string {
  const hue = (index * 47 + 19) % 360;
  const saturation = 52;
  const lightness = 88;
  const chroma = (1 - Math.abs(2 * lightness / 100 - 1)) * saturation / 100;
  const x = chroma * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = lightness / 100 - chroma / 2;
  const [r, g, b] = hue < 60 ? [chroma, x, 0] : hue < 120 ? [x, chroma, 0] : hue < 180 ? [0, chroma, x] : hue < 240 ? [0, x, chroma] : hue < 300 ? [x, 0, chroma] : [chroma, 0, x];
  return `#${[r, g, b].map((channel) => Math.round((channel + m) * 255).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

export function getNextEventColor(events: CalendarEvent[], excludeId?: string): string {
  const used = new Set(events.filter((event) => event.id !== excludeId).map((event) => (event.color ?? DEFAULT_EVENT_COLOR).toLowerCase()));
  const available = EVENT_COLOR_PALETTE.find((color) => !used.has(color.value.toLowerCase()));
  if (available) return available.value;
  for (let index = 0; ; index += 1) {
    const color = generatedPastel(index);
    if (!used.has(color.toLowerCase())) return color;
  }
}

export function getEventColorOptions(events: CalendarEvent[], editing: CalendarEvent) {
  const used = new Set(events.filter((event) => event.id !== editing.id).map((event) => (event.color ?? DEFAULT_EVENT_COLOR).toLowerCase()));
  const options: Array<{ name: string; value: string }> = EVENT_COLOR_PALETTE.filter((color) => !used.has(color.value.toLowerCase()));
  let generatedIndex = 0;
  while (options.length < 8) {
    const value = generatedPastel(generatedIndex++);
    if (!used.has(value.toLowerCase()) && !options.some((option) => option.value.toLowerCase() === value.toLowerCase())) {
      options.push({ name: `追加色${generatedIndex}`, value });
    }
  }
  if (editing.color && !options.some((option) => option.value.toLowerCase() === editing.color?.toLowerCase())) {
    options.push({ name: "現在の色", value: editing.color });
  }
  return options;
}

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

export function isValidEventImageDataUrl(value: unknown): value is string {
  return typeof value === "string" && value.length <= 7_000_000 && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}

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
  if (event.pinned !== undefined && typeof event.pinned !== "boolean") return false;
  if (event.imageDataUrl !== undefined && !isValidEventImageDataUrl(event.imageDataUrl)) return false;
  const start = Date.parse(event.startAt);
  const end = Date.parse(event.endAt);
  return Number.isFinite(start) && Number.isFinite(end) && Number.isFinite(Date.parse(event.createdAt)) && Number.isFinite(Date.parse(event.updatedAt)) && end > start;
}
