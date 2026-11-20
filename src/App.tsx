import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, PointerEvent as ReactPointerEvent } from "react";
import type { CalendarEvent } from "./domain/event";
import { changeEventTime, dayEvents, dateFromKey, dayKey, getNextEvent, layoutOverlaps, localDateTime, pointerScrollDelta, snapMinutes } from "./domain/time";
import type { DragMode } from "./domain/time";
import { deleteEvent, listEvents, saveEvent } from "./storage/database";

const HOUR_HEIGHT = 72;
const DRAG_SLOT_MINUTES = 10;

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

function makeInitialEvent(day: Date, now: Date): CalendarEvent {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), now.getHours(), now.getMinutes());
  const end = new Date(start.getTime() + 30 * 60_000);
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
  const [loaded, setLoaded] = useState(false);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const [undoVisible, setUndoVisible] = useState(false);
  const timelineRef = useRef<HTMLDivElement>(null);
  const dragSeed = useRef<DragSeed | null>(null);
  const dragRef = useRef<DragPreview | null>(null);
  const suppressClick = useRef(false);
  const history = useRef<Array<{ before: CalendarEvent; after: CalendarEvent }>>([]);
  const historyIndex = useRef(0);
  const current = new Date();
  const day = dateFromKey(selectedDay);
  const todaysEvents = useMemo(() => dayEvents(events, day), [events, selectedDay]);
  const positioned = useMemo(() => layoutOverlaps(todaysEvents), [todaysEvents]);
  const nextEvent = useMemo(() => getNextEvent(dayEvents(events, current), now), [events, now, selectedDay]);
  const isToday = selectedDay === dayKey(now);

  useEffect(() => {
    void listEvents().then(setEvents).finally(() => setLoaded(true));
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!loaded || !isToday || !timelineRef.current) return;
    const minute = now.getHours() * 60 + now.getMinutes();
    timelineRef.current.scrollTop = Math.max(0, minute * HOUR_HEIGHT / 60 - 30 * HOUR_HEIGHT / 60);
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
    e.preventDefault();
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
    else seed.timer = window.setTimeout(activate, 320);
  }

  function movePointer(e: ReactPointerEvent<HTMLElement>) {
    const seed = dragSeed.current;
    const current = dragRef.current;
    if (!current && seed) {
      const movement = e.clientY - seed.clientY;
      if (seed.scrolling || Math.abs(movement) > 8) {
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
    const delta = snapMinutes(e.clientY - current.clientY + timeline.scrollTop - current.scrollTop, HOUR_HEIGHT, DRAG_SLOT_MINUTES);
    const updated = { ...current, preview: changeEventTime(current.event, current.mode, delta, DRAG_SLOT_MINUTES) };
    dragRef.current = updated;
    setDragPreview(updated);
  }

  async function finishPointer(e: ReactPointerEvent<HTMLElement>) {
    const seed = dragSeed.current;
    if (seed?.timer) window.clearTimeout(seed.timer);
    const current = dragRef.current;
    dragSeed.current = null;
    dragRef.current = null;
    setDragPreview(null);
    if (!current || e.pointerId !== current.pointerId) {
      if (seed?.scrolling) window.setTimeout(() => { suppressClick.current = false; }, 0);
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
    setUndoVisible(false);
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return;
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
    const start = new Date(String(form.get("startAt")));
    const end = new Date(String(form.get("endAt")));
    if (end <= start) {
      window.alert("終了時刻は開始時刻より後にしてください。");
      return;
    }
    void persist({ ...editing, title: String(form.get("title")).trim(), destination: String(form.get("destination")).trim(), startAt: start.toISOString(), endAt: end.toISOString(), memo: String(form.get("memo")).trim(), updatedAt: new Date().toISOString() });
  }

  function jumpToNext() {
    if (!nextEvent || !timelineRef.current) return;
    const start = new Date(nextEvent.startAt);
    timelineRef.current.scrollTo({ top: Math.max(0, (start.getHours() * 60 + start.getMinutes()) * HOUR_HEIGHT / 60 - 80), behavior: "smooth" });
  }

  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand-line"><span className="mini-mark">r</span><strong>rakuCalendar</strong><button className="icon-button settings-button" aria-label="設定" onClick={() => window.alert("設定は後続Phaseで追加します")}>⚙</button></div>
      <div className="date-controls">
        <button className="icon-button" aria-label="前日" onClick={() => changeDay(-1)}>‹</button>
        <label className="date-label"><span>{day.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "short" })}</span><input aria-label="表示日" type="date" value={selectedDay} onChange={(e) => setSelectedDay(e.target.value)} /></label>
        <button className="icon-button" aria-label="翌日" onClick={() => changeDay(1)}>›</button>
        <button className="today-button" onClick={() => setSelectedDay(dayKey(new Date()))}>今日</button>
      </div>
    </header>

    <section className="next-card" onClick={jumpToNext} role="button" tabIndex={0} aria-label="次の予定へ移動">
      <span className="next-label">{nextEvent ? (Date.parse(nextEvent.startAt) <= now.getTime() ? "進行中の予定" : "次の予定") : "これからの予定"}</span>
      {nextEvent ? <><strong>{nextEvent.title}</strong><span className="next-time">{formatTime(nextEvent.startAt)}{nextEvent.destination && ` · ${nextEvent.destination}`}</span></> : <span className="next-empty">予定はありません</span>}
    </section>

    <main className="timeline" ref={timelineRef} aria-label="1日の予定" onClick={(e) => {
      if ((e.target as HTMLElement).closest("button, input, label")) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const minute = Math.max(0, Math.min(1439, Math.floor(((e.clientY - rect.top + e.currentTarget.scrollTop) / HOUR_HEIGHT) * 60)));
      const start = dateFromKey(selectedDay);
      start.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
      const end = new Date(start.getTime() + 30 * 60_000);
      const created = makeInitialEvent(dateFromKey(selectedDay), start);
      created.startAt = localDateTime(start);
      created.endAt = localDateTime(end);
      setEditing(created);
    }}>
      <div className="time-grid">
        {Array.from({ length: 25 }, (_, hour) => <div className="hour-row" key={hour} style={{ top: hour * HOUR_HEIGHT }}><span>{String(hour % 24).padStart(2, "0")}:00</span><i /></div>)}
      </div>
      <div className="events-layer">
        {positioned.map(({ event, column, columns }) => {
          const isDragging = dragPreview?.event.id === event.id;
          const shownEvent = isDragging ? dragPreview.preview : event;
          const geometry = (item: CalendarEvent) => {
          const start = new Date(item.startAt), end = new Date(item.endAt);
          const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
          const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
          const visibleStart = new Date(Math.max(start.getTime(), dayStart.getTime()));
          const visibleEnd = new Date(Math.min(end.getTime(), dayEnd.getTime()));
          const startMinutes = (visibleStart.getTime() - dayStart.getTime()) / 60_000;
          const endMinutes = (visibleEnd.getTime() - dayStart.getTime()) / 60_000;
          const top = startMinutes * HOUR_HEIGHT / 60;
          const height = Math.max(44, (endMinutes - startMinutes) * HOUR_HEIGHT / 60);
          const fraction = column / columns;
          return { top, height, left: `calc(64px + ${fraction * 100}% - ${fraction * 72}px)`, width: `calc(${100 / columns}% - ${72 / columns + 4}px)`, visibleStart, visibleEnd };
          };
          const old = geometry(event), currentGeometry = geometry(shownEvent);
          const { visibleStart, visibleEnd, ...shellStyle } = currentGeometry;
          return <div key={event.id} className={`event-shell${isDragging ? " is-dragging" : ""}`} style={{ ...shellStyle, background: shownEvent.color || undefined }} onPointerMove={movePointer} onPointerUp={(e) => void finishPointer(e)} onPointerCancel={() => { if (dragSeed.current?.timer) window.clearTimeout(dragSeed.current.timer); dragSeed.current = null; dragRef.current = null; setDragPreview(null); }}>
            {isDragging && <div className="event-ghost" style={{ top: old.top - currentGeometry.top, height: old.height }} />}
            <button className="event-card" onPointerDown={(e) => startPointer(e, event, "move")} onClick={() => { if (!suppressClick.current) setEditing(event); }} aria-label={`${event.title} ${formatTime(visibleStart.toISOString())}から${formatTime(visibleEnd.toISOString())}`}>
              <strong>{shownEvent.title}</strong><span>{formatTime(visibleStart.toISOString())}–{formatTime(visibleEnd.toISOString())}</span>{shownEvent.destination && <small>{shownEvent.destination}</small>}
            </button>
            <button className="resize-handle resize-start" aria-label="開始時刻を変更" onPointerDown={(e) => startPointer(e, event, "resize-start")} />
            <button className="resize-handle resize-end" aria-label="終了時刻を変更" onPointerDown={(e) => startPointer(e, event, "resize-end")} />
          </div>;
        })}
      </div>
      {isToday && <div className="current-time" style={{ top: nowMinutes * HOUR_HEIGHT / 60 }}><span>{formatTime(now.toISOString())}</span><i /></div>}
      {todaysEvents.length === 0 && <p className="empty-day">空き時間をタップするか、右下の＋から予定を追加できます。</p>}
    </main>
    <button className="now-button" aria-label="現在時刻へ" onClick={() => { if (timelineRef.current) timelineRef.current.scrollTo({ top: Math.max(0, nowMinutes * HOUR_HEIGHT / 60 - 36), behavior: "smooth" }); }}>今</button>
    <button className="add-button" aria-label="予定を追加" onClick={() => setEditing(makeInitialEvent(dateFromKey(selectedDay), new Date()))}>＋</button>
    {undoVisible && <div className="undo-bar" role="status"><span>時間を変更しました</span><button onClick={() => void travelHistory("undo")}>元に戻す</button><button aria-label="やり直す" onClick={() => void travelHistory("redo")} disabled={historyIndex.current >= history.current.length}>↶</button></div>}

    {editing && <div className="dialog-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setEditing(null); }}><section className="event-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div className="dialog-head"><h2 id="dialog-title">{events.some((e) => e.id === editing.id) ? "予定を編集" : "予定を追加"}</h2><button className="icon-button" onClick={() => setEditing(null)} aria-label="閉じる">×</button></div>
      <form onSubmit={submitForm} className="event-form"><label>予定内容<input name="title" required maxLength={120} autoFocus defaultValue={editing.title} /></label><label>行先（任意）<input name="destination" maxLength={120} defaultValue={editing.destination} /></label><div className="form-row"><label>開始<input name="startAt" type="datetime-local" required defaultValue={localDateTime(new Date(editing.startAt))} /></label><label>終了<input name="endAt" type="datetime-local" required defaultValue={localDateTime(new Date(editing.endAt))} /></label></div><label>メモ（任意）<textarea name="memo" rows={3} maxLength={2000} defaultValue={editing.memo} /></label><div className="form-actions">{events.some((e) => e.id === editing.id) && <button type="button" className="delete-button" onClick={() => void remove(editing.id)}>削除</button>}<button type="button" className="secondary-button" onClick={() => setEditing(null)}>キャンセル</button><button type="submit" className="save-button">保存</button></div></form>
    </section></div>}
  </div>;
}
