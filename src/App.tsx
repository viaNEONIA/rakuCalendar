import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent, PointerEvent as ReactPointerEvent } from "react";
import { DEFAULT_EVENT_COLOR, DEFAULT_SETTINGS, EVENT_COLOR_PALETTE } from "./domain/event";
import type { CalendarEvent, CalendarSettings } from "./domain/event";
import { makeBackup, parseBackup } from "./domain/backup";
import type { CalendarBackup } from "./domain/backup";
import { createICalendar } from "./domain/ical";
import { changeEventTime, dayEvents, dateFromKey, dayKey, EVENT_TIME_INCREMENT_MINUTES, getNextEvent, layoutOverlaps, localDateTime, nearestQuarterHourMinute, defaultEventRange, hasPointerScrollIntent, nextAvailableEventRange, nextScheduledDay, pointerScrollDelta, resolveDragOverlaps, snapMinutes } from "./domain/time";
import type { DragMode } from "./domain/time";
import { deleteEvent, getSettings, listEvents, restoreData, saveEvent, saveSettings } from "./storage/database";

const HOUR_HEIGHT = 72;

interface DragSeed {
  event: CalendarEvent;
  mode: DragMode;
  clientY: number;
  scrollTop: number;
  pointerId: number;
  capture: HTMLElement;
  timer?: number;
  scrolling?: boolean;
}

interface DragPreview extends DragSeed {
  preview: CalendarEvent;
}

function makeInitialEvent(day: Date, now: Date, events: CalendarEvent[]): CalendarEvent {
  const { start, end } = defaultEventRange(day, now, events);
  return {
    id: crypto.randomUUID(), title: "", destination: "", startAt: localDateTime(start), endAt: localDateTime(end),
    memo: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
}

function formatTime(iso: string) {
  return new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function App() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [selectedDay, setSelectedDay] = useState(() => dayKey(new Date()));
  const [now, setNow] = useState(() => new Date());
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [viewingEvent, setViewingEvent] = useState<CalendarEvent | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [loaded, setLoaded] = useState(false);
  const [settings, setSettings] = useState<CalendarSettings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [backupPreview, setBackupPreview] = useState<CalendarBackup | null>(null);
  const [restoreMode, setRestoreMode] = useState<"merge" | "replace">("merge");
  const [conflictPolicy, setConflictPolicy] = useState<"keep-local" | "use-backup">("keep-local");
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState("");
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const [undoVisible, setUndoVisible] = useState(false);
  const timelineRef = useRef<HTMLDivElement>(null);
  const dragSeed = useRef<DragSeed | null>(null);
  const dragRef = useRef<DragPreview | null>(null);
  const suppressClick = useRef(false);
  const lastTap = useRef<{ id: string; at: number } | null>(null);
  const history = useRef<Array<{ before: CalendarEvent; after: CalendarEvent }>>([]);
  const historyIndex = useRef(0);
  const current = new Date();
  const day = dateFromKey(selectedDay);
  const todaysEvents = useMemo(() => dayEvents(events, day), [events, selectedDay]);
  const displayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), settings.displayStartHour);
  const displayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), settings.displayEndHour);
  const visibleEvents = useMemo(() => todaysEvents.filter((event) => Date.parse(event.startAt) < displayEnd.getTime() && Date.parse(event.endAt) > displayStart.getTime()), [todaysEvents, settings.displayStartHour, settings.displayEndHour]);
  const positioned = useMemo(() => layoutOverlaps(visibleEvents), [visibleEvents]);
  const nextEvent = useMemo(() => getNextEvent(dayEvents(events, current), now), [events, now, selectedDay]);
  const isToday = selectedDay === dayKey(now);

  useEffect(() => {
    void Promise.all([listEvents(), getSettings()]).then(([savedEvents, savedSettings]) => { setEvents(savedEvents); setSettings(savedSettings); }).finally(() => setLoaded(true));
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => { if (loaded) void saveSettings(settings); }, [settings, loaded]);

  useEffect(() => {
    if (!loaded || !isToday || !timelineRef.current) return;
    const minute = now.getHours() * 60 + now.getMinutes();
    timelineRef.current.scrollTop = Math.max(0, (minute - settings.displayStartHour * 60) * HOUR_HEIGHT / 60 - 30 * HOUR_HEIGHT / 60);
  }, [loaded]);

  const changeDay = (delta: number) => {
    const next = dateFromKey(selectedDay);
    next.setDate(next.getDate() + delta);
    setSelectedDay(dayKey(next));
  };

  async function persist(event: CalendarEvent) {
    await saveEvent(event);
    setEvents((items) => [...items.filter((item) => item.id !== event.id), event]);
    setEditing(null);
  }

  async function remove(id: string) {
    await deleteEvent(id);
    setEvents((items) => items.filter((item) => item.id !== id));
    setEditing(null);
  }

  function startPointer(e: ReactPointerEvent<HTMLElement>, event: CalendarEvent, mode: DragMode) {
    // Keep the native click generated after a short touch so tap selection and double-tap edit work.
    e.stopPropagation();
    const timeline = timelineRef.current;
    const seed: DragSeed = { event, mode, clientY: e.clientY, scrollTop: timeline?.scrollTop ?? 0, pointerId: e.pointerId, capture: e.currentTarget };
    dragSeed.current = seed;
    try { seed.capture.setPointerCapture(seed.pointerId); } catch { /* capture may be unavailable */ }
    const activate = () => {
      const next: DragPreview = { ...seed, preview: event };
      dragRef.current = next;
      setDragPreview(next);
    };
    if (mode !== "move") activate();
    else seed.timer = window.setTimeout(() => { setSelectedEventId(event.id); activate(); }, 420);
  }

  function movePointer(e: ReactPointerEvent<HTMLElement>) {
    const seed = dragSeed.current;
    const current = dragRef.current;
    if (!current && seed) {
      const movement = e.clientY - seed.clientY;
      if (seed.scrolling || hasPointerScrollIntent(seed.clientY, e.clientY)) {
        if (seed.timer) window.clearTimeout(seed.timer);
        if (!seed.scrolling) suppressClick.current = true;
        const timeline = timelineRef.current;
        if (timeline) timeline.scrollTop += pointerScrollDelta(seed.clientY, e.clientY);
        dragSeed.current = { ...seed, clientY: e.clientY, scrollTop: timeline?.scrollTop ?? seed.scrollTop, scrolling: true, timer: undefined };
      }
      return;
    }
    if (!current || e.pointerId !== current.pointerId) return;
    const timeline = timelineRef.current;
    if (!timeline) return;
    const bounds = timeline.getBoundingClientRect();
    if (e.clientY < bounds.top + 64) timeline.scrollTop -= 10;
    else if (e.clientY > bounds.bottom - 64) timeline.scrollTop += 10;
    const delta = snapMinutes(e.clientY - current.clientY + timeline.scrollTop - current.scrollTop, HOUR_HEIGHT, EVENT_TIME_INCREMENT_MINUTES);
    const proposed = changeEventTime(current.event, current.mode, delta, EVENT_TIME_INCREMENT_MINUTES);
    const updated = { ...current, preview: resolveDragOverlaps(current.event, proposed, current.mode, events.filter((event) => event.id !== current.event.id)) };
    dragRef.current = updated;
    setDragPreview(updated);
  }

  async function finishPointer(e: ReactPointerEvent<HTMLElement>) {
    const seed = dragSeed.current;
    if (seed && e.pointerId !== seed.pointerId) return;
    if (seed?.timer) window.clearTimeout(seed.timer);
    const current = dragRef.current;
    dragSeed.current = null;
    dragRef.current = null;
    setDragPreview(null);
    if (!current || e.pointerId !== current.pointerId) {
      const scrollIntent = Boolean(seed && (seed.scrolling || hasPointerScrollIntent(seed.clientY, e.clientY)));
      if (scrollIntent) {
        if (seed && !seed.scrolling && timelineRef.current) {
          timelineRef.current.scrollTop += pointerScrollDelta(seed.clientY, e.clientY);
        }
        window.setTimeout(() => { suppressClick.current = false; }, 0);
      }
      return;
    }
    suppressClick.current = true;
    window.setTimeout(() => { suppressClick.current = false; }, 0);
    const after = { ...current.preview, updatedAt: new Date().toISOString() };
    if (after.startAt === current.event.startAt && after.endAt === current.event.endAt) return;
    await saveEvent(after);
    setEvents((items) => items.map((item) => item.id === after.id ? after : item));
    history.current = [...history.current.slice(0, historyIndex.current), { before: current.event, after }];
    historyIndex.current = history.current.length;
    setUndoVisible(true);
    window.setTimeout(() => setUndoVisible(false), 5000);
  }

  async function travelHistory(direction: "undo" | "redo") {
    const index = direction === "undo" ? historyIndex.current - 1 : historyIndex.current;
    const item = history.current[index];
    if (!item) return;
    const target = direction === "undo" ? item.before : item.after;
    await saveEvent(target);
    setEvents((items) => items.map((event) => event.id === target.id ? target : event));
    historyIndex.current += direction === "undo" ? -1 : 1;
    setUndoVisible(historyIndex.current > 0 || historyIndex.current < history.current.length);
  }

  async function exportBackup() {
    const createdAt = new Date();
    const updatedSettings = { ...settings, lastBackupCreatedAt: createdAt.toISOString() };
    const backup = makeBackup(events, updatedSettings, createdAt);
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `rakuCalendar-backup-${createdAt.toISOString().replace(/[-:T]/g, "").slice(0, 12)}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setSettings(updatedSettings);
    setSettingsMessage("バックアップファイルを作成しました。保存先でファイルを確認してください。");
  }

  function exportICalendar() {
    if (!todaysEvents.length) { setSettingsMessage("この日に出力できる予定はありません。"); return; }
    const blob = new Blob([createICalendar(todaysEvents)], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `rakuCalendar-${selectedDay.replaceAll("-", "")}.ics`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setSettingsMessage(`${selectedDay}の予定${todaysEvents.length}件をICSファイルに出力しました。カレンダーアプリからインポートしてください。`);
  }

  async function readBackup(file?: File) {
    if (!file) return;
    try {
      if (file.size > 20_000_000) throw new Error("ファイルサイズが20MBを超えています。");
      const backup = parseBackup(await file.text());
      setBackupPreview(backup);
      setRestoreMode("merge");
      setReplaceConfirmed(false);
      setSettingsMessage("");
    } catch (error) { setSettingsMessage(error instanceof Error ? error.message : "ファイルを読み取れませんでした。"); }
  }

  async function restoreBackup() {
    if (!backupPreview || (restoreMode === "replace" && !replaceConfirmed)) return;
    const result = await restoreData(backupPreview.events, backupPreview.settings, restoreMode, conflictPolicy);
    const [savedEvents, savedSettings] = await Promise.all([listEvents(), getSettings()]);
    setEvents(savedEvents);
    setSettings(savedSettings);
    setBackupPreview(null);
    setSettingsMessage(`復元しました。追加 ${result.added}件、更新 ${result.updated}件、スキップ ${result.skipped}件。`);
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable='true']")) return;
      if (e.shiftKey) void travelHistory("redo");
      else void travelHistory("undo");
      e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  function submitForm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    const form = new FormData(e.currentTarget);
    const readDateTime = (prefix: "start" | "end") => {
      const date = dateFromKey(String(form.get(`${prefix}Date`)));
      const hour = Number(form.get(`${prefix}Hour`));
      const minute = Number(form.get(`${prefix}Minute`));
      if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) return new Date(NaN);
      date.setHours(hour, minute, 0, 0);
      return date;
    };
    const start = readDateTime("start");
    const end = readDateTime("end");
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
      window.alert("終了時刻は開始時刻より後にしてください。");
      return;
    }
    void persist({ ...editing, title: String(form.get("title")).trim(), destination: String(form.get("destination")).trim(), startAt: start.toISOString(), endAt: end.toISOString(), memo: String(form.get("memo")).trim(), color: String(form.get("color")), updatedAt: new Date().toISOString() });
  }

  async function adjustSelectedTime(direction: -1 | 1) {
    const selected = events.find((event) => event.id === selectedEventId);
    if (!selected) return;
    const after = { ...changeEventTime(selected, "move", direction * EVENT_TIME_INCREMENT_MINUTES, EVENT_TIME_INCREMENT_MINUTES), updatedAt: new Date().toISOString() };
    if (after.startAt === selected.startAt) return;
    await saveEvent(after);
    setEvents((items) => items.map((event) => event.id === after.id ? after : event));
    history.current = [...history.current.slice(0, historyIndex.current), { before: selected, after }];
    historyIndex.current = history.current.length;
    setUndoVisible(true);
    window.setTimeout(() => setUndoVisible(false), 5000);
  }

  function onEventTap(event: CalendarEvent) {
    if (mode === "view") { setViewingEvent(event); return; }
    if (suppressClick.current) return;
    const at = Date.now();
    if (lastTap.current?.id === event.id && at - lastTap.current.at <= 420) {
      lastTap.current = null;
      setSelectedEventId(event.id);
      setEditing(event);
      return;
    }
    lastTap.current = { id: event.id, at };
    setSelectedEventId(event.id);
  }

  function jumpToNext() {
    if (!nextEvent || !timelineRef.current) return;
    const start = new Date(nextEvent.startAt);
    timelineRef.current.scrollTo({ top: Math.max(0, (start.getHours() * 60 + start.getMinutes() - settings.displayStartHour * 60) * HOUR_HEIGHT / 60 - 80), behavior: "smooth" });
  }

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const colorOptions = editing?.color && !EVENT_COLOR_PALETTE.some((color) => color.value.toLowerCase() === editing.color?.toLowerCase())
    ? [...EVENT_COLOR_PALETTE, { name: "現在の色", value: editing.color }]
    : EVENT_COLOR_PALETTE;
  const nextScheduleDate = nextScheduledDay(events, selectedDay);

  return <div className={`app-shell${mode === "edit" ? " is-edit-mode" : ""}`}>
    <header className="topbar">
      <div className="brand-line"><span className="mini-mark">r</span><strong>rakuCalendar</strong><button className={`mode-toggle${mode === "edit" ? " is-editing" : ""}`} aria-pressed={mode === "edit"} aria-label={mode === "view" ? "編集モードへ切り替え" : "閲覧モードへ切り替え"} onClick={() => {
        const nextMode = mode === "view" ? "edit" : "view";
        if (nextMode === "view") {
          if (dragSeed.current?.timer) window.clearTimeout(dragSeed.current.timer);
          dragSeed.current = null; dragRef.current = null; suppressClick.current = false; setDragPreview(null); setSelectedEventId(null); lastTap.current = null;
        }
        setMode(nextMode);
      }}>{mode === "view" ? "閲覧" : "編集"}</button><button className="icon-button settings-button" aria-label="設定" onClick={() => setSettingsOpen(true)}>⚙</button></div>
      <div className="date-controls">
        <button className="icon-button" aria-label="前日" onClick={() => changeDay(-1)}>‹</button>
        <label className="date-label"><span>{day.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "short" })}</span><input aria-label="表示日" type="date" value={selectedDay} onChange={(e) => setSelectedDay(e.target.value)} /></label>
        <button className="icon-button" aria-label="翌日" onClick={() => changeDay(1)}>›</button>
        <button className="today-button" onClick={() => setSelectedDay(dayKey(new Date()))}>今日</button>
      </div>
      {nextScheduleDate && <div className="scheduled-day-row"><button className="scheduled-day-button" onClick={() => setSelectedDay(nextScheduleDate)}>次の予定がある日へ · {dateFromKey(nextScheduleDate).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", weekday: "short" })}</button></div>}
    </header>

    {settings.showNextEvent && <section className="next-card" onClick={jumpToNext} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); jumpToNext(); } }} role="button" tabIndex={0} aria-label="次の予定へ移動">
      <span className="next-label">{nextEvent ? (Date.parse(nextEvent.startAt) <= now.getTime() ? "進行中の予定" : "次の予定") : "これからの予定"}</span>
      {nextEvent ? <><strong>{nextEvent.title}</strong><span className="next-time">{formatTime(nextEvent.startAt)}{nextEvent.destination && ` · ${nextEvent.destination}`}</span></> : <span className="next-empty">予定はありません</span>}
    </section>}
    {settings.backupReminderDays > 0 && (!settings.lastBackupCreatedAt || Date.now() - Date.parse(settings.lastBackupCreatedAt) >= settings.backupReminderDays * 86_400_000) && <div className="backup-notice">バックアップの作成時期です <button onClick={() => setSettingsOpen(true)}>設定を開く</button></div>}

    <main className="timeline" ref={timelineRef} aria-label="1日の予定" onClick={(e) => {
      if (mode !== "edit" || (e.target as HTMLElement).closest("button, input, label")) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const rawMinute = settings.displayStartHour * 60 + Math.floor(((e.clientY - rect.top + e.currentTarget.scrollTop) / HOUR_HEIGHT) * 60);
      const snappedMinute = nearestQuarterHourMinute(rawMinute);
      const minute = Math.max(settings.displayStartHour * 60, Math.min(settings.displayEndHour * 60 - 30, snappedMinute));
      const start = dateFromKey(selectedDay);
      start.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
      const { start: availableStart, end } = nextAvailableEventRange(start, events);
      const created = makeInitialEvent(dateFromKey(selectedDay), availableStart, []);
      created.startAt = localDateTime(availableStart);
      created.endAt = localDateTime(end);
      setEditing(created);
    }}>
      <div className="time-grid" style={{ height: `${(settings.displayEndHour - settings.displayStartHour) * HOUR_HEIGHT}px` }}>
        {Array.from({ length: settings.displayEndHour - settings.displayStartHour + 1 }, (_, index) => { const hour = settings.displayStartHour + index; return <div className="hour-row" key={hour} style={{ top: index * HOUR_HEIGHT }}><span>{hour === 24 ? "24:00" : `${String(hour).padStart(2, "0")}:00`}</span><i /></div>; })}
      </div>
      <div className="events-layer" style={{ height: `${(settings.displayEndHour - settings.displayStartHour) * HOUR_HEIGHT}px` }}>
        {positioned.map(({ event, column, columns }) => {
          const isDragging = dragPreview?.event.id === event.id;
          const shownEvent = isDragging ? dragPreview.preview : event;
          const geometry = (item: CalendarEvent) => {
          const start = new Date(item.startAt), end = new Date(item.endAt);
          const visibleStart = new Date(Math.max(start.getTime(), displayStart.getTime()));
          const visibleEnd = new Date(Math.min(end.getTime(), displayEnd.getTime()));
          const startMinutes = (visibleStart.getTime() - displayStart.getTime()) / 60_000;
          const endMinutes = (visibleEnd.getTime() - displayStart.getTime()) / 60_000;
          const top = startMinutes * HOUR_HEIGHT / 60;
          const height = Math.max(44, (endMinutes - startMinutes) * HOUR_HEIGHT / 60);
          const fraction = column / columns;
          return { top, height, left: `calc(64px + ${fraction * 100}% - ${fraction * 72}px)`, width: `calc(${100 / columns}% - ${72 / columns + 4}px)`, visibleStart, visibleEnd };
          };
          const old = geometry(event), currentGeometry = geometry(shownEvent);
          const { visibleStart, visibleEnd, ...shellStyle } = currentGeometry;
          return <div key={event.id} className={`event-shell${isDragging ? " is-dragging" : ""}${selectedEventId === event.id ? " is-selected" : ""}`} style={{ ...shellStyle, "--event-color": shownEvent.color || DEFAULT_EVENT_COLOR } as CSSProperties} onPointerMove={mode === "edit" ? movePointer : undefined} onPointerUp={mode === "edit" ? (e) => void finishPointer(e) : undefined} onPointerCancel={mode === "edit" ? () => { if (dragSeed.current?.timer) window.clearTimeout(dragSeed.current.timer); dragSeed.current = null; dragRef.current = null; suppressClick.current = false; setDragPreview(null); setSelectedEventId(null); lastTap.current = null; } : undefined}>
            {isDragging && <div className="event-ghost" style={{ top: old.top - currentGeometry.top, height: old.height }} />}
            <button className="event-card" onPointerDown={mode === "edit" ? (e) => startPointer(e, event, "move") : undefined} onClick={() => onEventTap(event)} aria-label={`${event.title} ${formatTime(visibleStart.toISOString())}から${formatTime(visibleEnd.toISOString())}`}>
              <strong>{shownEvent.title}</strong><span>{formatTime(visibleStart.toISOString())}–{formatTime(visibleEnd.toISOString())}</span>{shownEvent.destination && <small>{shownEvent.destination}</small>}
            </button>
          </div>;
        })}
      </div>
      {isToday && settings.showCurrentTime && nowMinutes >= settings.displayStartHour * 60 && nowMinutes <= settings.displayEndHour * 60 && <div className="current-time" style={{ top: (nowMinutes - settings.displayStartHour * 60) * HOUR_HEIGHT / 60 }}><span>{formatTime(now.toISOString())}</span><i /></div>}
      {visibleEvents.length === 0 && <p className="empty-day">{mode === "edit" ? "空き時間をタップするか、右下の＋から予定を追加できます。" : "この日に予定はありません。予定を追加するには編集モードに切り替えてください。"}</p>}
    </main>
    {mode === "edit" && selectedEventId && visibleEvents.some((event) => event.id === selectedEventId) && <div className="time-adjust-controls" aria-label="予定時刻の調整"><button aria-label="15分前へ" title="15分前へ" onClick={() => void adjustSelectedTime(-1)}>↑</button><button aria-label="15分後へ" title="15分後へ" onClick={() => void adjustSelectedTime(1)}>↓</button></div>}
    <button className="now-button" aria-label="現在時刻へ" onClick={() => { if (timelineRef.current) timelineRef.current.scrollTo({ top: Math.max(0, (nowMinutes - settings.displayStartHour * 60) * HOUR_HEIGHT / 60 - 36), behavior: "smooth" }); }}>今</button>
    {mode === "edit" && <button className="add-button" aria-label="予定を追加" onClick={() => setEditing(makeInitialEvent(dateFromKey(selectedDay), new Date(), events))}>＋</button>}
    {undoVisible && <div className="undo-bar" role="status"><span>時間を変更しました</span><button onClick={() => void travelHistory("undo")} disabled={historyIndex.current <= 0}>元に戻す</button><button onClick={() => void travelHistory("redo")} disabled={historyIndex.current >= history.current.length}>やり直す</button></div>}

    {settingsOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) { setSettingsOpen(false); setBackupPreview(null); } }}><section className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="dialog-head"><h2 id="settings-title">設定</h2><button className="icon-button" aria-label="閉じる" onClick={() => { setSettingsOpen(false); setBackupPreview(null); }}>×</button></div>
      
      <label className="setting-row">表示開始時刻<select value={settings.displayStartHour} onChange={(e) => { const start = Number(e.target.value); setSettings({ ...settings, displayStartHour: start, displayEndHour: Math.max(settings.displayEndHour, start + 1) }); }}>{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00</option>)}</select></label>
      <label className="setting-row">表示終了時刻<select value={settings.displayEndHour} onChange={(e) => { const end = Number(e.target.value); setSettings({ ...settings, displayEndHour: end, displayStartHour: Math.min(settings.displayStartHour, end - 1) }); }}>{Array.from({ length: 24 }, (_, index) => { const hour = index + 1; return <option key={hour} value={hour}>{hour === 24 ? "24:00" : `${String(hour).padStart(2, "0")}:00`}</option>; })}</select></label>
      <label className="setting-check"><input type="checkbox" checked={settings.showCurrentTime} onChange={(e) => setSettings({ ...settings, showCurrentTime: e.target.checked })} />現在時刻ラインを表示</label>
      <label className="setting-check"><input type="checkbox" checked={settings.showNextEvent} onChange={(e) => setSettings({ ...settings, showNextEvent: e.target.checked })} />次の予定を表示</label>
      <label className="setting-row">バックアップの注意間隔<select value={settings.backupReminderDays} onChange={(e) => setSettings({ ...settings, backupReminderDays: Number(e.target.value) as CalendarSettings["backupReminderDays"] })}><option value={0}>オフ</option><option value={7}>7日</option><option value={14}>14日</option><option value={30}>30日</option></select></label>
      <div className="backup-section"><h3>バックアップと復元</h3><p>予定と設定をJSONに保存します。ファイルの保存完了ではなく作成日時を記録します。</p><button className="save-button wide-button" onClick={() => void exportBackup()}>バックアップを作成</button><div className="backup-meta">最終作成日時: {settings.lastBackupCreatedAt ? new Date(settings.lastBackupCreatedAt).toLocaleString("ja-JP") : "未作成"}</div><label className="file-picker">バックアップファイルを選択<input type="file" accept="application/json,.json" onChange={(e) => void readBackup(e.target.files?.[0])} /></label></div>
      <div className="backup-section"><h3>外部カレンダー</h3><p>{selectedDay}の予定{todaysEvents.length}件をiCalendar形式で保存します。Google Calendar、Outlook、Apple Calendarなどにインポートできます。</p><button className="secondary-button wide-button" onClick={exportICalendar}>この日の予定をICS出力</button></div>
      {backupPreview && <div className="restore-preview"><h3>復元内容の確認</h3><p>{backupPreview.events.length}件の予定 · {new Date(backupPreview.exportedAt).toLocaleString("ja-JP")}作成 · {backupPreview.timezone}</p><label className="setting-check"><input type="radio" checked={restoreMode === "merge"} onChange={() => setRestoreMode("merge")} />既存を残して追加・統合</label><label className="setting-check"><input type="radio" checked={restoreMode === "replace"} onChange={() => setRestoreMode("replace")} />全件置き換え</label>{restoreMode === "merge" && <fieldset><legend>同じIDで内容が異なる予定</legend><label><input type="radio" checked={conflictPolicy === "keep-local"} onChange={() => setConflictPolicy("keep-local")} />端末の予定を残す</label><label><input type="radio" checked={conflictPolicy === "use-backup"} onChange={() => setConflictPolicy("use-backup")} />バックアップで更新</label></fieldset>}{restoreMode === "replace" && <label className="setting-check replace-warning"><input type="checkbox" checked={replaceConfirmed} onChange={(e) => setReplaceConfirmed(e.target.checked)} />現在の予定と設定を置き換えることを確認しました</label>}<button className="save-button wide-button" disabled={restoreMode === "replace" && !replaceConfirmed} onClick={() => void restoreBackup()}>復元を実行</button></div>}
      {settingsMessage && <p className="settings-message" role="status">{settingsMessage}</p>}
      <button className="secondary-button settings-done" onClick={() => { setSettingsOpen(false); setBackupPreview(null); }}>閉じる</button>
    </section></div>}

    {viewingEvent && <div className="dialog-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setViewingEvent(null); }}><section className="event-dialog" role="dialog" aria-modal="true" aria-labelledby="view-event-title"><div className="dialog-head"><h2 id="view-event-title">予定の詳細</h2><button className="icon-button" onClick={() => setViewingEvent(null)} aria-label="閉じる">×</button></div><div className="event-details"><strong>{viewingEvent.title}</strong><p>{new Date(viewingEvent.startAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" })}–{formatTime(viewingEvent.endAt)}</p>{viewingEvent.destination && <p>行先: {viewingEvent.destination}</p>}{viewingEvent.memo && <p className="event-detail-memo">{viewingEvent.memo}</p>}<button className="secondary-button settings-done" onClick={() => setViewingEvent(null)}>閉じる</button></div></section></div>}

    {editing && <div className="dialog-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setEditing(null); }}><section className="event-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div className="dialog-head"><h2 id="dialog-title">{events.some((e) => e.id === editing.id) ? "予定を編集" : "予定を追加"}</h2><button className="icon-button" onClick={() => setEditing(null)} aria-label="閉じる">×</button></div>
      <form onSubmit={submitForm} className="event-form"><label>予定内容<input name="title" required maxLength={120} autoFocus defaultValue={editing.title} /></label><label>行先（任意）<input name="destination" maxLength={120} defaultValue={editing.destination} /></label><div className="time-fields">{(["start", "end"] as const).map((prefix) => { const value = new Date(prefix === "start" ? editing.startAt : editing.endAt); const existing = events.some((item) => item.id === editing.id); const label = prefix === "start" ? "開始" : "終了"; return <fieldset className="time-field" key={prefix}><legend>{label}</legend><input aria-label={`${label}日付`} name={`${prefix}Date`} type="date" required defaultValue={`${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`} /><div className="numeric-time"><label>時<input aria-label={`${label}時`} name={`${prefix}Hour`} type="number" inputMode="numeric" min="0" max="23" required defaultValue={String(value.getHours()).padStart(2, "0")} /></label><span>:</span><label>分<input aria-label={`${label}分`} name={`${prefix}Minute`} type="number" inputMode="numeric" min="0" max="59" step={existing ? 1 : 15} required defaultValue={String(value.getMinutes()).padStart(2, "0")} /></label></div></fieldset>; })}</div><p className="time-entry-hint">ドラッグ操作では他の予定との重なりを避けます。重複させる場合は開始・終了時刻を直接指定してください。</p><fieldset className="color-palette"><legend>予定の色</legend><div className="color-swatch-grid">{colorOptions.map((color) => <label className="color-swatch" key={color.value}><input type="radio" name="color" value={color.value} defaultChecked={color.value.toLowerCase() === (editing.color ?? DEFAULT_EVENT_COLOR).toLowerCase()} /><span className="color-swatch-chip" style={{ "--swatch-color": color.value } as CSSProperties} /><small>{color.name}</small></label>)}</div></fieldset><label>メモ（任意）<textarea name="memo" rows={3} maxLength={2000} defaultValue={editing.memo} /></label><div className="form-actions">{events.some((e) => e.id === editing.id) && <button type="button" className="delete-button" onClick={() => void remove(editing.id)}>削除</button>}<button type="button" className="secondary-button" onClick={() => setEditing(null)}>キャンセル</button><button type="submit" className="save-button">保存</button></div></form>
    </section></div>}
  </div>;
}
