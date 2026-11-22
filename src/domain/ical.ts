import type { CalendarEvent } from "./event";

interface ICalProperty {
  name: string;
  params: Record<string, string>;
  value: string;
}

export interface ICalendarImportResult {
  events: CalendarEvent[];
  skippedCount: number;
  warnings: string[];
}

function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function unescapeText(value: string): string {
  return value.replace(/\\([nN,;\\])/g, (_match, escaped: string) => {
    if (escaped === "n" || escaped === "N") return "\n";
    return escaped;
  });
}

function utcStamp(value: string): string {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function foldIcalLine(line: string): string {
  const encoder = new TextEncoder();
  const result: string[] = [];
  let part = "";
  let bytes = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (bytes + size > 75) {
      result.push(part);
      part = ` ${character}`;
      bytes = 1 + size;
    } else {
      part += character;
      bytes += size;
    }
  }
  result.push(part);
  return result.join("\r\n");
}

export function createICalendar(events: CalendarEvent[], exportedAt = new Date()): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//viaNEONIA//rakuCalendar 1.0//JA",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:rakuCalendar"
  ];
  for (const event of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.id}@rakucalendar.local`,
      `DTSTAMP:${utcStamp(exportedAt.toISOString())}`,
      `DTSTART:${utcStamp(event.startAt)}`,
      `DTEND:${utcStamp(event.endAt)}`,
      `SUMMARY:${escapeText(event.title)}`,
      `LOCATION:${escapeText(event.destination)}`,
      `DESCRIPTION:${escapeText(event.memo)}`,
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldIcalLine).join("\r\n")}\r\n`;
}

function findUnquotedColon(line: string): number {
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"') quoted = !quoted;
    else if (line[index] === ":" && !quoted) return index;
  }
  return -1;
}

function splitUnquoted(value: string, separator: string): string[] {
  const parts: string[] = [];
  let quoted = false;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '"') quoted = !quoted;
    else if (value[index] === separator && !quoted) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function parseProperty(line: string): ICalProperty | null {
  const colon = findUnquotedColon(line);
  if (colon < 1) return null;
  const [rawName = "", ...rawParams] = splitUnquoted(line.slice(0, colon), ";");
  const name = (rawName.split(".").pop() ?? rawName).toUpperCase();
  const params: Record<string, string> = {};
  for (const rawParam of rawParams) {
    const separator = rawParam.indexOf("=");
    if (separator < 1) continue;
    const key = rawParam.slice(0, separator).toUpperCase();
    params[key] = rawParam.slice(separator + 1).replace(/^"(.*)"$/, "$1");
  }
  return { name, params, value: line.slice(colon + 1) };
}

interface DateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function utcMilliseconds(parts: DateParts): number {
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(parts.hour, parts.minute, parts.second, 0);
  return date.getTime();
}

function datePartsAt(timestamp: number, timeZone: string): DateParts {
  const values = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date(timestamp));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(values.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

function sameDateParts(left: DateParts, right: DateParts): boolean {
  return left.year === right.year && left.month === right.month && left.day === right.day &&
    left.hour === right.hour && left.minute === right.minute && left.second === right.second;
}

function dateFromProperty(property: ICalProperty): Date {
  if (property.params.VALUE?.toUpperCase() === "DATE" || /^\d{8}$/.test(property.value)) {
    throw new Error("終日予定は未対応です。");
  }
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/i.exec(property.value);
  if (!match) throw new Error("日時の形式に対応していません。");
  const parts: DateParts = {
    year: Number(match[1]), month: Number(match[2]), day: Number(match[3]),
    hour: Number(match[4]), minute: Number(match[5]), second: Number(match[6] ?? 0)
  };
  const calendarDate = new Date(utcMilliseconds({ ...parts, hour: 0, minute: 0, second: 0 }));
  if (calendarDate.getUTCFullYear() !== parts.year || calendarDate.getUTCMonth() + 1 !== parts.month ||
      calendarDate.getUTCDate() !== parts.day || parts.hour > 23 || parts.minute > 59 || parts.second > 59) {
    throw new Error("日時が正しくありません。");
  }
  if (match[7]) return new Date(utcMilliseconds(parts));
  const timeZone = property.params.TZID;
  if (!timeZone) {
    const local = new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    if (local.getFullYear() !== parts.year || local.getMonth() + 1 !== parts.month || local.getDate() !== parts.day) {
      throw new Error("日時が正しくありません。");
    }
    return local;
  }
  let timestamp = utcMilliseconds(parts);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const shown = datePartsAt(timestamp, timeZone);
    timestamp += utcMilliseconds(parts) - utcMilliseconds(shown);
  }
  if (!sameDateParts(datePartsAt(timestamp, timeZone), parts)) {
    throw new Error("指定されたタイムゾーンの日時を解釈できません。");
  }
  return new Date(timestamp);
}

function durationMilliseconds(value: string): number | null {
  const match = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(value);
  if (!match || !match.slice(1).some(Boolean)) return null;
  const total = (((Number(match[1] ?? 0) * 7 + Number(match[2] ?? 0)) * 24 +
    Number(match[3] ?? 0)) * 60 + Number(match[4] ?? 0)) * 60_000 + Number(match[5] ?? 0) * 1_000;
  return total > 0 ? total : null;
}

function stableId(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ (code + index), 0x85ebca6b);
  }
  return `ics-${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
}

function unfoldLines(text: string): string[] {
  const physicalLines = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const lines: string[] = [];
  for (const line of physicalLines) {
    if (/^[ \t]/.test(line) && lines.length) lines[lines.length - 1] += line.slice(1);
    else if (line) lines.push(line);
  }
  return lines;
}

export function parseICalendar(text: string, importedAt = new Date()): ICalendarImportResult {
  if (text.length > 20_000_000) throw new Error("ICSファイルが大きすぎます。20MB以下を選択してください。");
  const lines = unfoldLines(text);
  if (!lines.some((line) => line.toUpperCase() === "BEGIN:VCALENDAR") ||
      !lines.some((line) => line.toUpperCase() === "END:VCALENDAR")) {
    throw new Error("iCalendar形式のファイルではありません。");
  }

  const components: string[] = [];
  const rawEvents: string[][] = [];
  let activeEvent: string[] | null = null;
  let startedCalendar = false;
  let endedCalendar = false;
  for (const line of lines) {
    const property = parseProperty(line);
    if (!property) continue;
    if (property.name === "BEGIN") {
      const component = property.value.toUpperCase();
      if (component === "VCALENDAR") { startedCalendar = true; components.push(component); }
      else {
        if (activeEvent && components.at(-1) === "VEVENT") activeEvent.push(line);
        components.push(component);
        if (component === "VEVENT") activeEvent = [];
      }
      continue;
    }
    if (property.name === "END") {
      const component = property.value.toUpperCase();
      if (component === "VEVENT" && activeEvent) {
        rawEvents.push(activeEvent);
        activeEvent = null;
      }
      if (components.at(-1) === component) components.pop();
      if (component === "VCALENDAR") endedCalendar = true;
      continue;
    }
    if (activeEvent && components.at(-1) === "VEVENT") activeEvent.push(line);
  }
  if (!startedCalendar || !endedCalendar || components.length || activeEvent) {
    throw new Error("iCalendarの構造が正しくありません。");
  }
  if (!rawEvents.length) throw new Error("ICSファイルに予定がありません。");

  const result: ICalendarImportResult = { events: [], skippedCount: 0, warnings: [] };
  const seenUids = new Set<string>();
  const createdAt = importedAt.toISOString();
  rawEvents.forEach((linesForEvent, index) => {
    const properties = new Map<string, ICalProperty>();
    for (const line of linesForEvent) {
      const property = parseProperty(line);
      if (property && !properties.has(property.name)) properties.set(property.name, property);
    }
    try {
      if (properties.has("RRULE") || properties.has("RDATE") || properties.has("EXDATE") || properties.has("RECURRENCE-ID")) {
        throw new Error("繰り返し予定は未対応です。");
      }
      if (properties.get("STATUS")?.value.toUpperCase() === "CANCELLED") throw new Error("キャンセル済みの予定です。");
      const uid = properties.get("UID")?.value.trim() ?? "";
      if (uid && seenUids.has(uid)) throw new Error("同じUIDの予定が重複しています。");
      const startProperty = properties.get("DTSTART");
      if (!startProperty) throw new Error("開始日時がありません。");
      const start = dateFromProperty(startProperty);
      const endProperty = properties.get("DTEND");
      const duration = properties.get("DURATION") ? durationMilliseconds(properties.get("DURATION")!.value) : null;
      const end = endProperty ? dateFromProperty(endProperty) : duration ? new Date(start.getTime() + duration) : null;
      if (!end || end <= start) throw new Error("終了日時または有効な期間がありません。");
      if (uid) seenUids.add(uid);
      const title = unescapeText(properties.get("SUMMARY")?.value ?? "").trim() || "予定";
      const destination = unescapeText(properties.get("LOCATION")?.value ?? "");
      const memo = unescapeText(properties.get("DESCRIPTION")?.value ?? "");
      const identity = uid || `${title}| ${start.toISOString()}|${end.toISOString()}|${destination}|${index}`;
      result.events.push({
        id: stableId(identity), title, destination, startAt: start.toISOString(), endAt: end.toISOString(),
        memo, createdAt, updatedAt: createdAt
      });
    } catch (error) {
      result.skippedCount += 1;
      result.warnings.push(`予定${index + 1}: ${error instanceof Error ? error.message : "読み取れませんでした。"}`);
    }
  });
  return result;
}
