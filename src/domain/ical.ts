import type { CalendarEvent } from "./event";

function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
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
