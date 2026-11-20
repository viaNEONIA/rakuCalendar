import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { CalendarEvent } from "./domain/event";
import { dayEvents, dateFromKey, dayKey, getNextEvent, layoutOverlaps, localDateTime } from "./domain/time";
import { deleteEvent, listEvents, saveEvent } from "./storage/database";

const HOUR_HEIGHT = 72;

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
  const timelineRef = useRef<HTMLDivElement>(null);
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
          const start = new Date(event.startAt), end = new Date(event.endAt);
          const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
          const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
          const visibleStart = new Date(Math.max(start.getTime(), dayStart.getTime()));
          const visibleEnd = new Date(Math.min(end.getTime(), dayEnd.getTime()));
          const startMinutes = (visibleStart.getTime() - dayStart.getTime()) / 60_000;
          const endMinutes = (visibleEnd.getTime() - dayStart.getTime()) / 60_000;
          const top = startMinutes * HOUR_HEIGHT / 60;
          const height = Math.max(44, (endMinutes - startMinutes) * HOUR_HEIGHT / 60);
          const fraction = column / columns;
          return <button key={event.id} className="event-card" onClick={() => setEditing(event)} style={{ top, height, left: `calc(64px + ${fraction * 100}% - ${fraction * 72}px)`, width: `calc(${100 / columns}% - ${72 / columns + 4}px)`, background: event.color || undefined }}>
            <strong>{event.title}</strong><span>{formatTime(visibleStart.toISOString())}–{formatTime(visibleEnd.toISOString())}</span>{event.destination && <small>{event.destination}</small>}
          </button>;
        })}
      </div>
      {isToday && <div className="current-time" style={{ top: nowMinutes * HOUR_HEIGHT / 60 }}><span>{formatTime(now.toISOString())}</span><i /></div>}
      {todaysEvents.length === 0 && <p className="empty-day">空き時間をタップせず、右下の＋から予定を追加できます。</p>}
    </main>
    <button className="now-button" aria-label="現在時刻へ" onClick={() => { if (timelineRef.current) timelineRef.current.scrollTo({ top: Math.max(0, nowMinutes * HOUR_HEIGHT / 60 - 36), behavior: "smooth" }); }}>今</button>
    <button className="add-button" aria-label="予定を追加" onClick={() => setEditing(makeInitialEvent(dateFromKey(selectedDay), new Date()))}>＋</button>

    {editing && <div className="dialog-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setEditing(null); }}><section className="event-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div className="dialog-head"><h2 id="dialog-title">{events.some((e) => e.id === editing.id) ? "予定を編集" : "予定を追加"}</h2><button className="icon-button" onClick={() => setEditing(null)} aria-label="閉じる">×</button></div>
      <form onSubmit={submitForm} className="event-form"><label>予定内容<input name="title" required maxLength={120} autoFocus defaultValue={editing.title} /></label><label>行先（任意）<input name="destination" maxLength={120} defaultValue={editing.destination} /></label><div className="form-row"><label>開始<input name="startAt" type="datetime-local" required defaultValue={localDateTime(new Date(editing.startAt))} /></label><label>終了<input name="endAt" type="datetime-local" required defaultValue={localDateTime(new Date(editing.endAt))} /></label></div><label>メモ（任意）<textarea name="memo" rows={3} maxLength={2000} defaultValue={editing.memo} /></label><div className="form-actions">{events.some((e) => e.id === editing.id) && <button type="button" className="delete-button" onClick={() => void remove(editing.id)}>削除</button>}<button type="button" className="secondary-button" onClick={() => setEditing(null)}>キャンセル</button><button type="submit" className="save-button">保存</button></div></form>
    </section></div>}
  </div>;
}
