// Pure helpers for the day strip prototype: which day to show, the time window, and the
// countdown chip. No herdr imports, so `node --test` can run them.

export const SOON_MIN = 15;   // the next meeting glows from this many minutes out

export function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return iso(new Date(y, m - 1, d + n));
}
export function dayLabel(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(y, m - 1, d).getDay()];
  return `${wd} ${m}/${d}`;
}

// Timed events only. All-day ones (OOO, holidays) and ones running in from yesterday or on
// past midnight go in the label instead, so they don't stretch the strip to 24 hours.
export const timed = (events) => (events ?? []).filter(e => !e.all_day && !e.starts_before && !e.ends_after && e.end_min > e.start_min);
export const allDay = (events) => (events ?? []).filter(e => e.all_day || e.starts_before || e.ends_after);

// Events that block the calendar: not free time and not an out-of-office block.
export const busy = (e) => e.kind !== "free" && e.kind !== "ooo";

// The strip's hours: 7am to 6pm, stretched to fit anything earlier or later.
export function windowOf(events) {
  const t = timed(events);
  const first = Math.min(7 * 60, ...t.map(e => e.start_min));
  const last = Math.max(18 * 60, ...t.map(e => e.end_min));
  return { start: Math.floor(first / 60) * 60, end: Math.ceil(last / 60) * 60 };
}

// Whether today still has something on it: an event that hasn't ended.
export const hasRest = (events, nowMin) => timed(events).some(e => e.end_min > nowMin);

// What the chip at the right says, for today. { tone, big, title, sub, event }
export function countdown(events, nowMin) {
  const t = timed(events).sort((a, b) => a.start_min - b.start_min);
  const live = t.find(e => e.start_min <= nowMin && nowMin < e.end_min && busy(e));
  if (live) return { tone: "live", big: `${live.end_min - nowMin}m left`, title: live.title, sub: "on now", event: live };
  const next = t.find(e => e.start_min > nowMin && busy(e));
  if (!next) return { tone: "clear", big: "Clear", title: "Nothing else today", sub: "", event: null };
  const mins = next.start_min - nowMin;
  const big = mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
  return { tone: mins <= SOON_MIN ? "soon" : "later", big, title: next.title, sub: clockOf(next.start_min), event: next };
}

export function clockOf(min) {
  const h = Math.floor(min / 60) % 24, m = min % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export function hourLabel(min) {
  const h = Math.floor(min / 60) % 24;
  return `${h % 12 || 12}${h < 12 ? "a" : "p"}`;
}

// A Zoom (or Teams or Meet) link in the event's location, if any.
export function joinUrl(event) {
  const m = String(event?.location ?? "").match(/https?:\/\/[^\s;,)>"']*(zoom\.us|teams\.microsoft|meet\.google)[^\s;,)>"']*/i);
  return m ? m[0] : null;
}

// Overlapping events share the row: each gets a lane (0 or 1) so the later one draws in the
// lower half instead of hiding the earlier one. Returns [{ event, lane, lanes }].
export function stack(events) {
  const sorted = [...events].sort((a, b) => a.start_min - b.start_min || b.end_min - a.end_min);
  const out = [];
  for (const e of sorted) {
    const clash = out.filter(o => o.event.end_min > e.start_min && o.event.start_min < e.end_min);
    const lane = clash.some(o => o.lane === 0) ? 1 : 0;
    out.push({ event: e, lane, lanes: clash.length ? 2 : 1 });
    for (const o of clash) o.lanes = 2;
  }
  return out;
}
