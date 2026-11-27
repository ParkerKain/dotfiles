// Panel sources for the status-bar glances: how to read each kit CLI, and how to turn
// what it read into a one-line glance. Copied from the Command Deck prototype (pg-deck).
import { exec, home } from "herdr";

export const POLL_MS = 5 * 60 * 1000;
const bin = (name) => `${home()}/.local/bin/${name}`;
export const nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
export const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
// Scales a color's alpha, keeping any alpha it already has (layouts often set #rrggbbaa).
export const alpha = (hex, a) => {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex ?? "");
  return m ? "#" + m[1] + Math.round(a * (m[2] ? parseInt(m[2], 16) / 255 : 1) * 255).toString(16).padStart(2, "0") : hex;
};
export const clock = (min) => { const h = Math.floor(min / 60); return `${h % 12 || 12}:${String(min % 60).padStart(2, "0")}`; };

async function json(cmd, args, timeout = 45000) {
  const r = await exec(cmd, args, { timeout }).catch(e => ({ code: 1, stdout: "", stderr: String(e?.message ?? e) }));
  let v = null;
  try { v = JSON.parse(r.stdout); } catch { /* below */ }
  if (!v || v.ok === false) throw new Error(v?.error?.message ?? (r.stderr.trim().split("\n").pop() || `${cmd} exited ${r.code}`));
  return v;
}

export function find(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.id === id) return node;
  for (const child of node.children ?? []) { const hit = find(child, id); if (hit) return hit; }
  return null;
}

// Each source: how to read it, and how to turn what it read into a glance.
// A glance is { title, sub, badge?: { text, tone }, ring?: 0..1, pulse?: bool, tone? }.
export const SOURCES = [
  {
    id: "ops-tasks", icon: "mods/workspace-chrome/check.svg", name: "Tasks",
    async read() {
      const v = await json(`${home()}/go/bin/ops-tasks`, ["list", "--json"]);
      return v.data?.tasks ?? [];
    },
    glance(tasks) {
      const today = isoToday();
      // The CLI lists open tasks only.
      const open = tasks.filter(x => x.due_date && x.due_date <= today);
      const overdue = open.filter(x => x.due_date < today), late = overdue.length;
      return {
        title: open.length ? `${open.length} due today` : "Nothing due today",
        sub: late ? `${late} overdue · ${overdue[0].title}` : open[0]?.title ?? `${tasks.length} open in all`,
        badge: open.length ? { text: String(open.length), tone: late ? "blocked" : "working" } : null,
      };
    },
  },
  {
    id: "day-view", icon: "mods/day-view/calendar.svg", name: "Calendar",
    async read() { return (await json(bin("day-view"), ["day", isoToday()])).events ?? []; },
    glance(events) {
      const now = nowMinutes();
      const timed = events.filter(e => !e.all_day && !e.starts_before && !e.ends_after && e.kind !== "free" && e.kind !== "ooo" && e.end_min > now).sort((a, b) => a.start_min - b.start_min);
      const live = timed.find(e => e.start_min <= now);
      if (live) return { title: `On now · ${live.end_min - now}m left`, sub: live.title, ring: 1, tone: "blocked", pulse: true };
      const next = timed[0];
      if (!next) return { title: "Calendar clear", sub: "Nothing else today", ring: 0 };
      const mins = next.start_min - now;
      return {
        title: mins < 60 ? `${next.title.replace(/^\[[^\]]+\]\s*/, "").split(/\s+/).slice(0, 3).join(" ")} in ${mins}m` : `Next at ${clock(next.start_min)}`,
        sub: next.title,
        // The ring closes over the last hour before the meeting.
        ring: Math.max(0, Math.min(1, 1 - mins / 60)), tone: mins <= 15 ? "working" : "accent", pulse: mins <= 5,
      };
    },
  },
  {
    id: "lock-in", glyph: "✈", name: "Lock-in",
    async read() { return (await json(bin("lock-in"), ["flags"])).data ?? {}; },
    glance(r) {
      const flags = r.flags ?? [], red = flags.filter(f => f.urgency === "red");
      if (!flags.length) return { title: "All locked in", sub: "Every session is confirmed" };
      return {
        title: red.length ? `${red.length} red, ${flags.length - red.length} amber` : `${flags.length} not locked in`,
        sub: `${(red[0] ?? flags[0]).name} · ${(red[0] ?? flags[0]).relative_label ?? ""}`,
        badge: { text: String(red.length || flags.length), tone: red.length ? "blocked" : "working" }, pulse: red.length > 0,
      };
    },
  },
  {
    id: "factory", icon: "mods/factory/factory.svg", name: "Factory",
    async read() { return (await json(bin("factory"), ["status"])).data ?? {}; },
    glance(d) {
      const waiting = (d.waiting ?? []).length + (d.more ?? 0), mine = (d.mine ?? []).filter(m => !m.landed).length;
      if (waiting) return { title: `${waiting} waiting on you`, sub: d.waiting[0]?.title ?? "", badge: { text: String(waiting), tone: "blocked" }, pulse: true };
      return { title: "Factory quiet", sub: mine ? `${mine} of your tickets in flight` : "Nothing waits on you" };
    },
  },
  {
    id: "claude-usage", icon: "mods/claude-usage/gauge.svg", name: "Usage",
    async read() { return (await json(bin("claude-usage"), ["report"])).data ?? {}; },
    glance(d) {
      const me = (d.entries ?? []).find(e => e.is_me);
      if (!me) return { title: "Usage", sub: "No reading yet" };
      const over = me.percent > me.pace_percent;
      return {
        title: `${Math.round(me.percent)}% of the week`,
        sub: `pace ${Math.round(me.pace_percent)}% · resets ${me.resets_label}`,
        meter: { used: me.percent / 100, pace: me.pace_percent / 100 }, tone: over ? "blocked" : "done",
      };
    },
  },
  {
    id: "artifacts", icon: "mods/artifacts/layers.svg", name: "Artifacts",
    async read() {
      const r = await exec(bin("artifacts"), ["list"], { timeout: 30000 });
      if (r.code !== 0) throw new Error(r.stderr.trim().split("\n").pop() || `artifacts exited ${r.code}`);
      return r.stdout.split("\n").filter(Boolean).map(l => l.split(/\s{2,}/));
    },
    glance(rows) {
      const today = isoToday(), fresh = rows.filter(r => r[0] === today);
      return { title: fresh.length ? `${fresh.length} published today` : `${rows.length} artifacts`, sub: rows[0]?.[2] ?? "", badge: fresh.length ? { text: String(fresh.length), tone: "accent" } : null };
    },
  },
];

