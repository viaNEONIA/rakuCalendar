import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, PointerEvent as ReactPointerEvent } from "react";
import { DEFAULT_SETTINGS } from "./domain/event";
import type { CalendarEvent, CalendarSettings } from "./domain/event";
import { makeBackup, parseBackup } from "./domain/backup";
import type { CalendarBackup } from "./domain/backup";
import { changeEventTime, dayEvents, dateFromKey, dayKey, getNextEvent, layoutOverlaps, localDateTime, snapMinutes } from "./domain/time";
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
  const history = useRef<Array<{ before: CalendarEvent; after: CalendarEvent }>>([]);
  const historyIndex = useRef(0);
  const current = new Date();
  const day = dateFromKey(selectedDay);
  const todaysEvents = useMemo(() => dayEvents(events, day), [events, selectedDay]);
  const positioned = useMemo(() => layoutOverlaps(todaysEvents), [todaysEvents]);
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
    const activate = () => {
      const next: DragPreview = { ...seed, preview: event };
      dragRef.current = next;
      setDragPreview(next);
      try { seed.capture.setPointerCapture(seed.pointerId); } catch { /* pointer may already have ended */ }
    };
    if (mode !== "move") activate();
    else seed.timer = window.setTimeout(activate, 320);
  }

  function movePointer(e: ReactPointerEvent<HTMLElement>) {
    const seed = dragSeed.current;
    const current = dragRef.current;
    if (!current && seed) {
      if (Math.abs(e.clientY - seed.clientY) > 8) {
        if (seed.timer) window.clearTimeout(seed.timer);
        dragSeed.current = null;
      }
      return;
    }
    if (!current || e.pointerId !== current.pointerId) return;
    const timeline = timelineRef.current;
    if (!timeline) return;
    const bounds = timeline.getBoundingClientRect();
    if (e.clientY < bounds.top + 64) timeline.scrollTop -= 10;
    else if (e.clientY > bounds.bottom - 64) timeline.scrollTop += 10;
    const delta = snapMinutes(e.clientY - current.clientY + timeline.scrollTop - current.scrollTop, HOUR_HEIGHT, settings.slotMinutes);
    const updated = { ...current, preview: changeEventTime(current.event, current.mode, delta, settings.slotMinutes) };
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
    if (!current || e.pointerId !== current.pointerId) return;
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
      <div className="brand-line"><span className="mini-mark">r</span><strong>rakuCalendar</strong><button className="icon-button settings-button" aria-label="設定" onClick={() => setSettingsOpen(true)}>⚙</button></div>
      <div className="date-controls">
        <button className="icon-button" aria-label="前日" onClick={() => changeDay(-1)}>‹</button>
        <label className="date-label"><span>{day.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "short" })}</span><input aria-label="表示日" type="date" value={selectedDay} onChange={(e) => setSelectedDay(e.target.value)} /></label>
        <button className="icon-button" aria-label="翌日" onClick={() => changeDay(1)}>›</button>
        <button className="today-button" onClick={() => setSelectedDay(dayKey(new Date()))}>今日</button>
      </div>
    </header>

    {settings.showNextEvent && <section className="next-card" onClick={jumpToNext} role="button" tabIndex={0} aria-label="次の予定へ移動">
      <span className="next-label">{nextEvent ? (Date.parse(nextEvent.startAt) <= now.getTime() ? "進行中の予定" : "次の予定") : "これからの予定"}</span>
      {nextEvent ? <><strong>{nextEvent.title}</strong><span className="next-time">{formatTime(nextEvent.startAt)}{nextEvent.destination && ` · ${nextEvent.destination}`}</span></> : <span className="next-empty">予定はありません</span>}
    </section>}
    {settings.backupReminderDays > 0 && (!settings.lastBackupCreatedAt || Date.now() - Date.parse(settings.lastBackupCreatedAt) >= settings.backupReminderDays * 86_400_000) && <div className="backup-notice">バックアップの作成時期です <button onClick={() => setSettingsOpen(true)}>設定を開く</button></div>}

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
      {isToday && settings.showCurrentTime && <div className="current-time" style={{ top: nowMinutes * HOUR_HEIGHT / 60 }}><span>{formatTime(now.toISOString())}</span><i /></div>}
      {todaysEvents.length === 0 && <p className="empty-day">空き時間をタップするか、右下の＋から予定を追加できます。</p>}
    </main>
    <button className="now-button" aria-label="現在時刻へ" onClick={() => { if (timelineRef.current) timelineRef.current.scrollTo({ top: Math.max(0, nowMinutes * HOUR_HEIGHT / 60 - 36), behavior: "smooth" }); }}>今</button>
    <button className="add-button" aria-label="予定を追加" onClick={() => setEditing(makeInitialEvent(dateFromKey(selectedDay), new Date()))}>＋</button>
    {undoVisible && <div className="undo-bar" role="status"><span>時間を変更しました</span><button onClick={() => void travelHistory("undo")}>元に戻す</button><button aria-label="やり直す" onClick={() => void travelHistory("redo")} disabled={historyIndex.current >= history.current.length}>↶</button></div>}

    {settingsOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) { setSettingsOpen(false); setBackupPreview(null); } }}><section className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="dialog-head"><h2 id="settings-title">設定</h2><button className="icon-button" aria-label="閉じる" onClick={() => { setSettingsOpen(false); setBackupPreview(null); }}>×</button></div>
      <label className="setting-row">ドラッグの時間刻み<select value={settings.slotMinutes} onChange={(e) => setSettings({ ...settings, slotMinutes: Number(e.target.value) as CalendarSettings["slotMinutes"] })}><option value={10}>10分</option><option value={20}>20分</option><option value={30}>30分</option></select></label>
      <label className="setting-check"><input type="checkbox" checked={settings.showCurrentTime} onChange={(e) => setSettings({ ...settings, showCurrentTime: e.target.checked })} />現在時刻ラインを表示</label>
      <label className="setting-check"><input type="checkbox" checked={settings.showNextEvent} onChange={(e) => setSettings({ ...settings, showNextEvent: e.target.checked })} />次の予定を表示</label>
      <label className="setting-row">バックアップの注意間隔<select value={settings.backupReminderDays} onChange={(e) => setSettings({ ...settings, backupReminderDays: Number(e.target.value) as CalendarSettings["backupReminderDays"] })}><option value={0}>オフ</option><option value={7}>7日</option><option value={14}>14日</option><option value={30}>30日</option></select></label>
      <div className="backup-section"><h3>バックアップと復元</h3><p>予定と設定をJSONに保存します。ファイルの保存完了ではなく作成日時を記録します。</p><button className="save-button wide-button" onClick={() => void exportBackup()}>バックアップを作成</button><div className="backup-meta">最終作成日時: {settings.lastBackupCreatedAt ? new Date(settings.lastBackupCreatedAt).toLocaleString("ja-JP") : "未作成"}</div><label className="file-picker">バックアップファイルを選択<input type="file" accept="application/json,.json" onChange={(e) => void readBackup(e.target.files?.[0])} /></label></div>
      {backupPreview && <div className="restore-preview"><h3>復元内容の確認</h3><p>{backupPreview.events.length}件の予定 · {new Date(backupPreview.exportedAt).toLocaleString("ja-JP")}作成 · {backupPreview.timezone}</p><label className="setting-check"><input type="radio" checked={restoreMode === "merge"} onChange={() => setRestoreMode("merge")} />既存を残して追加・統合</label><label className="setting-check"><input type="radio" checked={restoreMode === "replace"} onChange={() => setRestoreMode("replace")} />全件置き換え</label>{restoreMode === "merge" && <fieldset><legend>同じIDで内容が異なる予定</legend><label><input type="radio" checked={conflictPolicy === "keep-local"} onChange={() => setConflictPolicy("keep-local")} />端末の予定を残す</label><label><input type="radio" checked={conflictPolicy === "use-backup"} onChange={() => setConflictPolicy("use-backup")} />バックアップで更新</label></fieldset>}{restoreMode === "replace" && <label className="setting-check replace-warning"><input type="checkbox" checked={replaceConfirmed} onChange={(e) => setReplaceConfirmed(e.target.checked)} />現在の予定と設定を置き換えることを確認しました</label>}<button className="save-button wide-button" disabled={restoreMode === "replace" && !replaceConfirmed} onClick={() => void restoreBackup()}>復元を実行</button></div>}
      {settingsMessage && <p className="settings-message" role="status">{settingsMessage}</p>}
      <button className="secondary-button settings-done" onClick={() => { setSettingsOpen(false); setBackupPreview(null); }}>閉じる</button>
    </section></div>}

    {editing && <div className="dialog-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setEditing(null); }}><section className="event-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div className="dialog-head"><h2 id="dialog-title">{events.some((e) => e.id === editing.id) ? "予定を編集" : "予定を追加"}</h2><button className="icon-button" onClick={() => setEditing(null)} aria-label="閉じる">×</button></div>
      <form onSubmit={submitForm} className="event-form"><label>予定内容<input name="title" required maxLength={120} autoFocus defaultValue={editing.title} /></label><label>行先（任意）<input name="destination" maxLength={120} defaultValue={editing.destination} /></label><div className="form-row"><label>開始<input name="startAt" type="datetime-local" required defaultValue={localDateTime(new Date(editing.startAt))} /></label><label>終了<input name="endAt" type="datetime-local" required defaultValue={localDateTime(new Date(editing.endAt))} /></label></div><label>メモ（任意）<textarea name="memo" rows={3} maxLength={2000} defaultValue={editing.memo} /></label><div className="form-actions">{events.some((e) => e.id === editing.id) && <button type="button" className="delete-button" onClick={() => void remove(editing.id)}>削除</button>}<button type="button" className="secondary-button" onClick={() => setEditing(null)}>キャンセル</button><button type="submit" className="save-button">保存</button></div></form>
    </section></div>}
  </div>;
}
