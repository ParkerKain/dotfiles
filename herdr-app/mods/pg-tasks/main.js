// Playground prototype: the kit's Tasks panel where tasks point at their agents. Agents
// live only in the left sidebar. Each task row with a live agent (the ops-task=<key>
// label, or the Play prompt) gets a tag under its title per agent: the state dot, the
// session (tab) name and a plain state ("asks you" breathing red, "ready to check ✓",
// "working Nm"). Clicking a tag jumps to that session, as ↗ does, and a tag flashes once
// when its state changes. Everything else (Active group, letters, keys, redate, drafts)
// is the kit's ops-tasks mod. Another mod can reveal a task here by setting shared
// "pg-tasks.reveal" to {key, at}: the row scrolls into view and flashes. props().sample
// (or SAMPLE below) shows made-up tasks and agents that change state, and never writes.
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, Input, InputState, ScrollHandle } from "gpui-base";
import { exec, home, appHome, readTextFile, writeTextFile, props, theme, run, openOverlay, closeOverlay, shared, setShared, nextCommand, focused, terminals, agents, spaces, layout, checking, window as appWindow } from "herdr";

// Forces sample data in a scratch copy (herdr-app check has no props).
const SAMPLE = false;
const MOD = "pg-tasks";

// Scales a color's alpha, keeping any alpha it already has (layouts often set #rrggbbaa).
const alpha = (hex, a) => {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex ?? "");
  return m ? "#" + m[1] + Math.round(a * (m[2] ? parseInt(m[2], 16) / 255 : 1) * 255).toString(16).padStart(2, "0") : hex;
};

// Panel motion: pg-tabs and pg-glances set shared "pg-panel.motion" to {id, phase, at} when
// they open or close a side panel. On "in" this panel starts transparent and 24px right,
// then fades and slides into place; on "out" it fades and slides away before the column
// hides. Herdr shows and hides panels instantly, so the content moves instead of the column.
const MOTION = "pg-panel.motion";
function trackMotion(view, id, cx) {
  const m = shared(MOTION);
  if (!m?.at || m.at === view.motionAt) return;
  view.motionAt = m.at;
  // Another panel's event, or one from before this copy started, leaves this one as it is.
  if (m.id !== id || Date.now() - m.at > 1000) return;
  if (m.phase === "in") {
    // Mount at the start position, then flip a frame later so the transition runs.
    view.motion = "pre";
    cx.timer.after(30, cx => { if (view.motionAt === m.at) { view.motion = "in"; cx.notify(); } });
  } else if (m.phase === "out") {
    view.motion = "out";
    // Back at rest once hidden, so a panel shown some other way is not left invisible.
    cx.timer.after(400, cx => { if (view.motionAt === m.at) { view.motion = null; cx.notify(); } });
  }
}
function withMotion(view, el) {
  const away = view.motion === "pre" || view.motion === "out";
  el = el.relative().left(away ? 24 : 0).opacity(away ? 0 : 1);
  if (view.motion === "in") return el.transition("opacity", { duration: 220, easing: "ease-out" }).transition("left", { duration: 220, easing: "ease-out" });
  if (view.motion === "out") return el.transition("opacity", { duration: 160, easing: "ease-in" }).transition("left", { duration: 160, easing: "ease-in" });
  return el;
}

// Matches the terminal panes' backing over a wallpaper. A terminal paints its
// background at terminal_opacity twice (surface, then cells), so it shows
// 1 - (1 - o)^2. Without terminal_opacity the layout's own color stands.
function paneBacking(t, fallback) {
  const o = Number(layout()?.terminal_opacity);
  if (!(o >= 0 && o < 1) || !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(t.background ?? "")) return fallback;
  return t.background.slice(0, 7) + Math.round((1 - (1 - o) ** 2) * 255).toString(16).padStart(2, "0");
}

const REFRESH = "ops-tasks.refresh";
const HINTS = "ops-tasks.hints";
const REVEAL = "pg-tasks.reveal";
const cli = () => `${home()}/go/bin/ops-tasks`;
const contextCli = () => `${home()}/.local/bin/session-context`;
const draftFile = () => `${home()}/.local/share/parker-prep/drafts.json`;
function draftMarker(entry, details) {
  if (!entry || entry.state === "done") return null;
  if (entry.publication_uncertain || entry.publication_error || details?.publication_pending || details?.review_paused)
    return ["Needs a look", "blocked"];
  if (entry.finalAvailable) return ["Final", "muted"];
  if (!entry.available) return entry.state === "drafting" ? ["Drafting", "muted"] : null;
  if (entry.state === "stale") return ["Stale", "blocked"];
  return entry.readiness === "partial" || entry.state === "partial" || entry.partial
    ? ["Partial", "working"] : ["Draft", "accent"];
}

function checkPhrase(label) {
  if (label === "The prior leadership call agreed a topic for this workshop") return "topic decision";
  if (label === "The linked session has a completed transcript") return "linked session transcript";
  return label.replace(/^the\s+/i, "").replace(/\s+is complete[.!]?$/i, "")
    .replace(/directed effort/gi, "DE").replace(/^[A-Z](?=[a-z])/, c => c.toLowerCase());
}

function waitingLabel(entry, details, now) {
  if (!["blocked", "unknown"].includes(entry?.readiness || entry?.state) || entry?.state === "done") return "";
  const required = (details?.checks ?? []).filter(check => check.required);
  const external = required.find(check => !check.own_session);
  if (external) {
    const day = external.session_start ? ` (${shortDay(external.session_start.slice(0, 10))})` : "";
    return `Waits on ${checkPhrase(external.label)}${day}`;
  }
  const end = Date.parse(details?.session_end);
  if (!Number.isFinite(end) || now - end <= 2 * 60 * 60 * 1000) return "";
  if (required.some(check => check.type === "transcript")) return "No transcript yet";
  return required.length ? `Waits on ${checkPhrase(required[0].label)}` : "";
}
function unreadNotes(entry) {
  const resolved = new Set((entry?.resolved_impact_notes || []).map(String));
  const impact = (entry?.impact_notes || []).filter(n => !resolved.has(String(n.tm_id)));
  return [...impact, ...(entry?.private_impact_suggestions || [])].filter(n => !n.resolved && !n.read_at).length;
}

// Hand-dragged order, kept per task across refreshes and restarts.
const orderFile = () => `${appHome()}/ops-tasks-order.json`;
const keyOf = (task) => `${task.source}:${task.kind}:${task.id}`;
const CLEAR = "#00000000";
const refArgs = (task) => ["--source", task.source, "--kind", task.kind, "--id", String(task.id)];
const localDay = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const searchWords = (text) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

function decode(result) {
  let value;
  try { value = JSON.parse(result.stdout); } catch { throw new Error(result.stderr.trim() || result.stdout.trim() || `ops-tasks exited ${result.code}`); }
  if (!value.ok || result.code !== 0) throw new Error(value.error?.message || result.stderr.trim() || `ops-tasks exited ${result.code}`);
  return value;
}

async function draftRegistry() {
  const text = await readTextFile(draftFile());
  const entries = text?.trim() ? JSON.parse(text) : {};
  await Promise.all(Object.values(entries).filter(e => e.draft_path).map(async e => {
    try { e.available = Boolean(await readTextFile(e.draft_path)); } catch { e.available = false; }
    const final = e.observed_promotion;
    if (final?.generation_id && final.generation_id === e.generation?.id &&
        final.path === e.draft_path.replace(/\.draft\.md$/, ".md")) {
      try { e.finalAvailable = typeof (await readTextFile(final.path)) === "string"; } catch { e.finalAvailable = false; }
    }
  }));
  return entries;
}

const isOpsProject = task => task.source === "ops" && task.kind === "project";
// The row's gray line: what the task belongs to (its session, or its DE when it has
// no session), then its project. A session's "[RAYA] " code repeats the project
// that follows it, so it is dropped to keep the project on screen.
const CONTEXT_CODE = /^\[[A-Z0-9][A-Z0-9-]{0,7}\]\s+/;
function rowMeta(task) {
  const project = task.project_name || task.origin;
  const context = project ? task.context?.replace(CONTEXT_CODE, "") : task.context;
  return [context, project].filter(Boolean).join(" · ");
}

async function taskDates(tasks) {
  const ids = tasks.filter(isOpsProject).map(task => String(task.id));
  if (!ids.length) return {};
  const result = await exec(contextCli(), ["task-dates", "--panel", ...ids]);
  if (result.code !== 0) throw new Error(result.stderr.trim());
  return JSON.parse(result.stdout);
}

function shortDay(iso) {
  const day = parseDay(iso);
  return `${WEEKDAYS[day.getDay()].slice(0, 3)} ${day.getMonth() + 1}/${day.getDate()}`;
}

function rowDates(task, details) {
  const start = details?.session_start;
  const day = start?.slice(0, 10);
  const session = start ? `${shortDay(day)} ${start.slice(11, 16).replace(/^0/, "")}` : "";
  const due = task.due_date && task.due_date !== day ? `due ${shortDay(task.due_date)}` : "";
  return [session, due].filter(Boolean).join(" · ");
}

function rowDetails(task, entry, details) {
  const start = details?.session_start;
  const session = start ? `Session ${shortDay(start.slice(0, 10))} ${start.slice(11, 16)} ET`
    : details?.session_id || (isOpsProject(task) && !details) ? "Session date unavailable" : "No linked session";
  const dates = [session, task.due_date ? `Due ${task.due_date}` : "No due date"].join(" · ");
  const missing = [...new Set([...(details?.checks ?? []).map(check => check.label), ...(entry?.next_actions ?? [])])];
  const inputNote = missing.length ? `Missing: ${missing.join(" · ")}` : "";
  const attention = entry?.publication_uncertain || entry?.publication_error || details?.publication_pending
    ? "Check draft publication" : details?.review_paused ? "Review paused" : "";
  const note = [attention, inputNote].filter(Boolean).join(" · ");
  const path = entry?.finalAvailable ? `Final: ${entry.observed_promotion.path}` : entry?.draft_path ? `Draft: ${entry.draft_path}` : "";
  // The gray line truncates on a narrow panel, so the details carry it untruncated.
  return [rowMeta(task), dates, note, path].filter(Boolean).map(line => line.replace(/[\r\n]+/g, " "));
}

function group(task, today, tomorrow, end) {
  const date = task.due_date;
  if (!date) return "No date";
  if (date < today) return "Overdue";
  if (date === today) return "Today";
  if (date === tomorrow) return "Tomorrow";
  return date <= end ? "Upcoming" : "Later";
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const parseDay = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
const ordinal = (n) => n + ((n % 100 >= 11 && n % 100 <= 13) ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th");
// "Monday, July 26th", plus the year when it isn't this year.
function longDate(date) {
  const year = date.getFullYear() === new Date().getFullYear() ? "" : ` ${date.getFullYear()}`;
  return `${WEEKDAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${ordinal(date.getDate())}${year}`;
}
function relative(date) {
  const now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((date - today) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return days > 0 ? `In ${days} days` : `${-days} days ago`;
}

// Jump labels, easiest keys first. Rows past what single letters cover get two-letter
// labels behind reserved prefix letters, so no label is a prefix of another.
const KEYS = "asdfghjklqwertyuiopzxcvbnm";
function labels(n) {
  let p = 0;
  while (KEYS.length - p + p * KEYS.length < n && p < KEYS.length) p++;
  const singles = KEYS.slice(0, KEYS.length - p).split(""), out = singles.slice(0, n);
  for (const prefix of KEYS.slice(KEYS.length - p)) for (const k of KEYS) if (out.length < n) out.push(prefix + k);
  return out;
}

// Section colors (theme tokens): the nearer the due date, the louder the heading.
// A Play launch labels its agent terminal ops-task=<key>; a live one marks the task Active.
const TASK_LABEL = "ops-task";
const URGENCY = { blocked: 0, working: 1, done: 2, idle: 3 };
// Sessions launched without a label (older launches, a missed tag) are matched by the
// task prompt Play started them with: its "Task:" line, plus "Project:" when there is one.
function promptKey(argv, tasks) {
  const prompt = argv?.[argv.length - 1];
  if (typeof prompt !== "string" || !prompt.startsWith("You are helping me work a DevClarity task.")) return null;
  const task = tasks.find(task => prompt.includes(`\nTask: ${task.title}\n`) && (!task.project_name || prompt.includes(`\nProject: ${task.project_name}\n`)));
  return task ? keyOf(task) : null;
}
function sessions(tasks, terms) {
  const out = new Map();
  for (const t of terms) {
    if (t.state && t.state !== "live") continue;
    const key = t.labels?.[TASK_LABEL] || promptKey(t.argv, tasks);
    if (!key) continue;
    const status = typeof t.status === "string" ? t.status : t.status?.state ?? null, prev = out.get(key);
    if (!prev || (URGENCY[status] ?? 9) < (URGENCY[prev.status] ?? 9)) out.set(key, { address: t.address, status });
  }
  return out;
}

// Task tags: one per live agent launched for a task, in three plain states, keyed by task.
const TAG_RANK = { ask: 0, ready: 1, working: 2 };
const tagState = status => status === "blocked" ? "ask" : status === "done" || status === "idle" ? "ready" : "working";
function taskTags(tasks, terms, agentList, tabWorking) {
  const agentOf = new Map(agentList.map(a => [a.address, a]));
  const out = new Map();
  for (const t of terms) {
    if (t.state && t.state !== "live") continue;
    const key = t.labels?.[TASK_LABEL] || promptKey(t.argv, tasks);
    if (!key) continue;
    const status = typeof t.status === "string" ? t.status : t.status?.state ?? null, a = agentOf.get(t.address);
    // An unnamed tab is called by its number, so the space name carries it then.
    const tabName = a?.tab_name && !/^\d+$/.test(a.tab_name) ? a.tab_name : [a?.space_name, a?.tab_name].filter(Boolean).join(" ");
    const tag = { address: t.address, key, status, state: tagState(status),
      tab: tabName || a?.pane_name || t.name || t.address, started: tabWorking.get(a?.tab) ?? t.started ?? null };
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(tag);
  }
  for (const list of out.values()) list.sort((a, b) => TAG_RANK[a.state] - TAG_RANK[b.state] || a.tab.localeCompare(b.tab));
  return out;
}
function elapsed(ms) {
  const m = Math.max(1, Math.round(ms / 60000));
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

// Sample mode: made-up tasks and agents. The agents step through working, asks, ready.
function sampleTasks() {
  const now = new Date(), d = n => localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));
  const task = (id, title, due, extra = {}) => ({ source: "personal", kind: "task", id, title, due_date: due, status: "Not started", ...extra });
  return [
    task(1, "Draft the day one recap email", d(0), { project_name: "Acme Level Up", context: "Day one workshop" }),
    task(2, "Review the sidebar icons pull request", d(-1)),
    task(3, "Send the self-report metrics form to the POC", d(1), { project_name: "Globex Jumpstart" }),
    task(4, "Prep the office hours one-pager", d(0), { project_name: "Initech Sustain" }),
    task(5, "Update the capacity sheet for December", d(-2)),
    task(6, "Book the Q1 planning room", d(3)),
    task(7, "Read the workshop feedback", null),
  ];
}
const SAMPLE_CYCLE = ["working", "working", "blocked", "blocked", "done", "idle"];
function sampleCrew(tick) {
  const at = off => SAMPLE_CYCLE[(tick + off) % SAMPLE_CYCLE.length], now = Date.now();
  const term = (address, id, status, minutes) => ({ address, labels: { [TASK_LABEL]: `personal:task:${id}` }, status, state: "live", started: now - minutes * 60000 });
  return {
    terms: [term("s1", 1, at(0), 12), term("s2", 2, at(2), 4), term("s3", 3, at(4), 31), term("s4", 1, "working", 7)],
    agents: [
      { address: "s1", tab_name: "recap email", space_name: "vault" },
      { address: "s2", tab_name: "sidebar icons", space_name: "ai-coding-platform" },
      { address: "s3", tab_name: "2", space_name: "vault" },
      { address: "s4", tab_name: "recap facts check", space_name: "vault" },
    ],
  };
}

const TONE = { Active: "working", Overdue: "blocked", Today: "accent", Tomorrow: "working", Upcoming: "muted", Later: "dim", "No date": "dim" };

export default class OpsTasks extends View {
  init(_props, cx) {
    this.confirm = props()?.complete ?? null;
    this.redate = props()?.reschedule ?? null;
    this.taskNotes = props()?.taskNotes ?? null;
    this.handle = cx.focus_handle();
    if (this.confirm || this.taskNotes) { this.handle.focus(); return; }
    if (this.redate) {
      // A task with no due date starts from today.
      const now = new Date();
      this.original = this.redate.due_date || null;
      this.day = this.original ? parseDay(this.original) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
      this.handle.focus();
      return;
    }
    this.sample = Boolean(props()?.sample ?? SAMPLE);
    this.tasks = []; this.drafts = {}; this.error = null; this.loading = false; this.workDir = null;
    // Tag bookkeeping: each agent's last state and since when, and tags or rows flashing now.
    this.tagSeen = new Map(); this.tagsReady = false; this.flash = {}; this.sampleTick = 0;
    // A reveal stamped just before this copy started (the click that opened the panel) still counts.
    const reveal = shared(REVEAL);
    this.seenReveal = reveal?.at ?? null;
    this.pendingReveal = reveal?.key && Date.now() - reveal.at < 3000 ? { key: reveal.key, at: Date.now() } : null;
    this.searching = false; this.query = []; this.noteSearch = null;
    this.scroll = ScrollHandle.new();
    this.searchInput = InputState.new({ placeholder: "Search tasks…" });
    this.searchInput.on("change", (_e, cx) => {
      this.query = searchWords(this.searchInput.value());
      this.scroll.scroll_to_item(0);
      this.loadSearchNotes(cx);
      cx.notify();
    });
    this.seenRefresh = shared(REFRESH);
    // keys.json: ops-tasks.hints labels every row; a letter picks one, then 1/2/3 act on it.
    this.hinting = false; this.typed = ""; this.picked = null;
    // my-tabs.hints (Cmd+J) stamps this for whichever panel shows; a fresh stamp at
    // start means the key itself opened the panel.
    this.seenHints = shared(HINTS);
    if (this.seenHints && Date.now() - this.seenHints < 2000) cx.timer.after(0, cx => { this.startHints(); cx.notify(); });
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === "hints") this.startHints();
        if (command === "focus") this.handle.focus();
        cx.notify();
      }
    });
    // Drag within a section. In Upcoming, tasks can be reordered within the same due date.
    this.order = []; this.orderText = null; this.drag = null; this.dropAt = null;
    cx.spawn(async cx => {
      this.orderText = await readTextFile(orderFile()).catch(() => null);
      try { this.order = JSON.parse(this.orderText ?? "[]"); } catch { this.order = []; }
      cx.notify();
    });
    // Redraw "working Nm" once a minute while someone is working.
    if (!checking()) cx.timer.every(30000, cx => { if (this.anyWorking && appWindow()?.visible !== false) cx.notify(); });
    if (this.sample) {
      this.tasks = sampleTasks();
      this.drafts = { "personal:task:4": { state: "ready", available: true, draft_path: "/tmp/sample.draft.md" } };
      if (!checking()) cx.timer.every(6000, cx => { this.sampleTick++; cx.notify(); });
      return;
    }
    if (checking()) return;
    this.load(cx);
    cx.timer.every(120000, cx => this.load(cx));
  }

  load(cx) {
    // A load that never returns must not block every later refresh: after 60s, start a new one.
    if (this.sample || (this.loading && Date.now() - this.loadStarted < 60000)) return;
    this.loading = true;
    this.loadStarted = Date.now();
    // Show the spinner for at least 600ms; notify on the next tick since load can run from render.
    this.spinUntil = Date.now() + 600; cx.timer.after(0, cx => cx.notify());
    const id = this.loadId = (this.loadId ?? 0) + 1;
    cx.spawn(async cx => {
      try {
        const [result, drafts] = await Promise.all([exec(cli(), ["list", "--json"]), draftRegistry().catch(() => null)]);
        const { data } = decode(result);
        if (id !== this.loadId) return;
        this.tasks = data.tasks ?? [];
        this.loadedOnce = true;
        this.drafts = drafts ?? {};
        this.error = drafts ? null : "Could not read draft status.";
        this.publishBadge();
        this.loadSearchNotes(cx);
      } catch (e) { if (id !== this.loadId) return; this.error = String(e?.message ?? e); }
      this.loading = false;
      cx.notify();
      cx.timer.after(Math.max(0, this.spinUntil - Date.now()), cx => cx.notify());
      if (this.tasks) {
        const dates = await taskDates(this.tasks).catch(() => null);
        if (id !== this.loadId) return;
        this.taskDates = dates;
        cx.notify();
      }
    });
  }

  loadSearchNotes(cx) {
    if (!this.searching || !this.query.length || !this.tasks.some(task => task.kind === "project")) return;
    if (this.noteSearch?.tasks === this.tasks) return;
    const search = this.noteSearch = { tasks: this.tasks, notes: new Map(), loading: true, incomplete: false };
    cx.spawn(async cx => {
      try {
        const { data, warnings } = decode(await exec(cli(), ["list", "--json", "--with-notes"]));
        search.notes = new Map(data.tasks.filter(task => task.notes).map(task => [keyOf(task), task.notes]));
        search.incomplete = !!warnings?.length;
      } catch { search.incomplete = true; }
      search.loading = false;
      cx.notify();
    });
  }

  key(e, cx) {
    if (this.hinting) {
      this.hintKey(e.key, cx);
    } else if (e.key === "escape" && this.searching) {
      this.searching = false;
      this.query = [];
      this.searchInput.set_value("");
      this.handle.focus();
    } else if ((e.keystroke === "/" || e.key_char === "/") && !e.modifiers.platform && !e.modifiers.control && this.handle.is_focused()) {
      this.openSearch();
    } else return;
    cx.stop_propagation();
    cx.notify();
  }

  openSearch() {
    this.searching = true;
    this.searchInput.focus();
  }

  // The my-tabs top bar draws "ops-tasks.badge" on the Tasks button: overdue plus due today,
  // red when anything is overdue.
  publishBadge() {
    if (this.sample) return;
    const now = new Date(), today = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
    const due = this.tasks.filter(task => task.due_date && task.due_date <= today);
    const badge = { count: due.length, tone: due.some(task => task.due_date < today) ? "blocked" : "accent" };
    const old = shared("ops-tasks.badge");
    if (old?.count !== badge.count || old?.tone !== badge.tone) setShared("ops-tasks.badge", badge);
  }

  async directory() {
    if (this.workDir) return this.workDir;
    const config = await readTextFile(`${home()}/.config/ops-tasks/config.toml`);
    const line = config?.split("\n").find(s => /^\s*work_dir\s*=/.test(s));
    const configured = line?.match(/^\s*work_dir\s*=\s*["']([^"']+)["']/)?.[1];
    const env = configured ? null : await exec("printenv", ["OPS_TASKS_WORK_DIR"]).catch(() => null);
    const value = configured || (env?.code === 0 ? env.stdout.trim() : null);
    this.workDir = value ? value.replace(/^~(?=\/|$)/, home()).replace(/^\$HOME(?=\/|$)/, home()) : `${home()}/Documents/internal/repos/devclarity-vault`;
    return this.workDir;
  }

  // From a tag, `address` is that tag's agent; elsewhere the task's most urgent one.
  start(task, cx, address = null) {
    if (this.sample) return;
    const ref = keyOf(task);
    const live = address ? { address } : sessions(this.tasks ?? [], terminals()).get(ref);
    if (live) run("agent.focus", { terminal: live.address });
    cx.spawn(async cx => {
      try {
        const drafts = await draftRegistry().catch(() => this.drafts);
        if (live) {
          const draft = await this.draftStatus(ref);
          const pending = draft?.pending_notes || [];
          const lines = [...(draft?.handoff_alerts || []), ...pending.map(note => note.text)];
          if (!lines.length) return;
          openOverlay({ mod: MOD, kind: "dialog", width: 560, height: 340,
            props: { taskNotes: { title: task.title, lines } } });
          const seen = await this.draftStatus(ref, ["--remember", "--ack-notes", ...pending.map(note => note.id)]);
          if (drafts?.[ref]) this.drafts = { ...drafts, [ref]: { ...drafts[ref], ...seen } };
        } else {
          const { data } = decode(await exec(cli(), ["prompt", ...refArgs(task), "--json"]));
          const folder = await this.directory();
          const prompt = [
            `Task: ${ref}`, `Title: ${task.title}`, `Folder: ${folder}`,
            ...(drafts?.[ref]?.draft_path ? [`Draft: ${drafts[ref].draft_path}`] : []),
            `Run \`session-context draft-status ${ref}\` first and read its notes.`
          ].join("\n");
          openOverlay({ mod: "session-launcher", kind: "dialog", width: 560, height: 300,
            props: { task: { title: task.title, prompt, slug: data.slug, ref, folder } } });
        }
        this.error = null;
      } catch (e) { this.error = String(e?.message ?? e); }
      cx.notify();
    });
  }

  async draftStatus(ref, args = []) {
    const status = await exec(contextCli(), ["draft-status", ref, "--json", ...args]);
    if (status.code !== 0) throw new Error(status.stderr.trim() || "Could not load draft status.");
    return JSON.parse(status.stdout);
  }

  complete(cx) {
    const task = this.confirm;
    if (this.saving || this.completed) return;
    if (props()?.sample) { closeOverlay(props().overlay); return; }
    this.saving = true;
    cx.spawn(async cx => {
      try {
        decode(await exec(cli(), ["complete", ...refArgs(task), "--yes", "--json"]));
        setShared(REFRESH, Date.now());
        if (!props().hasDraft) { closeOverlay(props().overlay); return; }
        this.completed = true;
        this.error = null;
        // Preselect the verdict measured from the final file. Parker clicks only to disagree.
        const measured = await exec(contextCli(), ["autonomy", keyOf(task), "--suggest"]).catch(() => null);
        try { this.suggested = measured?.code === 0 ? JSON.parse(measured.stdout) : null; } catch { this.suggested = null; }
      } catch (e) { this.error = String(e?.message ?? e); }
      this.saving = false;
      cx.notify();
    });
  }

  recordVerdict(verdict, cx) {
    if (this.saving) return;
    this.saving = true;
    cx.spawn(async cx => {
      try {
        const result = await exec(contextCli(), ["autonomy", keyOf(this.confirm), "--verdict", verdict]);
        if (result.code !== 0) throw new Error(result.stderr.trim() || "Could not record the verdict.");
        closeOverlay(props().overlay);
      } catch (e) { this.error = String(e?.message ?? e); this.saving = false; cx.notify(); }
    });
  }

  startHints() {
    if (this.hinting) { this.endHints(); return; }
    this.returnPane = focused()?.pane ?? null;
    this.hinting = true; this.typed = ""; this.picked = null;
    this.handle.focus();
  }

  // Leave hint mode and hand the keyboard back to the pane that had it.
  endHints() {
    this.hinting = false; this.typed = ""; this.picked = null;
    if (this.returnPane) run("pane.focus", { pane: this.returnPane });
  }

  hintKey(key, cx) {
    if (key === "escape") { this.endHints(); return; }
    if (this.picked) {
      const task = this.picked;
      if (key === "1") { this.endHints(); this.start(task, cx); }
      else if (key === "2") { this.endHints(); this.openRedate(task); }
      else if (key === "3") { this.endHints(); this.openComplete(task); }
      return;
    }
    if (key === "backspace") { this.typed = this.typed.slice(0, -1); return; }
    if (!/^[a-z]$/.test(key)) return;
    const typed = this.typed + key, matches = this.hintMap.filter(([label]) => label.startsWith(typed));
    if (!matches.length) return;
    const exact = matches.find(([label]) => label === typed);
    if (exact) { this.picked = exact[1]; this.typed = ""; } else this.typed = typed;
  }

  saveOrder(keys) {
    this.order = keys;
    const text = JSON.stringify(keys);
    const write = async (retry) => {
      try { await writeTextFile(orderFile(), text, this.orderText); this.orderText = text; }
      catch (e) {
        // Another panel saved first: take its snapshot and write ours over it once.
        if (!retry) { this.orderText = await readTextFile(orderFile()).catch(() => null); return write(true); }
        this.error = `Could not save task order: ${e?.message ?? e}`;
      }
    };
    return write(false);
  }

  dragOver(task, g, e, cx) {
    const drag = this.drag;
    if (!drag) return;
    if (!drag.active) { if (Math.abs(e.position.y - drag.y) < 4) return; drag.active = true; }
    const key = keyOf(task), after = e.local_position.y > e.bounds.height / 2;
    const canDrop = drag.group === g && key !== drag.key && (g !== "Upcoming" || drag.due === task.due_date);
    const next = canDrop ? { key, after } : null;
    if (next?.key !== this.dropAt?.key || next?.after !== this.dropAt?.after) { this.dropAt = next; cx.notify(); }
  }

  endDrag(cx) {
    const drag = this.drag, drop = this.dropAt;
    this.drag = null; this.dropAt = null;
    if (drag?.active && drop) {
      const keys = this.ordered.map(keyOf).filter(k => k !== drag.key);
      const at = keys.indexOf(drop.key);
      if (at >= 0) { keys.splice(drop.after ? at + 1 : at, 0, drag.key); cx.spawn(async cx => { await this.saveOrder(keys); cx.notify(); }); }
    }
    cx.notify();
  }

  openRedate(task) { openOverlay({ mod: MOD, kind: "dialog", width: 390, height: task.kind === "project" ? 210 : 190, props: { reschedule: task, sample: this.sample } }); }
  // Grow with the title (about 44 characters a line) so long titles keep the buttons in view, up to a cap where the title scrolls.
  openComplete(task) {
    const lines = Math.max(1, Math.ceil((task.title ?? "").length / 44));
    const hasDraft = Boolean(this.drafts[keyOf(task)]?.draft_path);
    openOverlay({ mod: MOD, kind: "dialog", width: 390, height: Math.min(420, (hasDraft ? 225 : 140) + lines * 22), props: { complete: task, hasDraft, sample: this.sample } });
  }

  shift(days, cx) {
    this.day = new Date(this.day.getFullYear(), this.day.getMonth(), this.day.getDate() + days);
    cx.notify();
  }

  reschedule(cx) {
    const task = this.redate, due = localDay(this.day);
    if (this.saving) return;
    if (due === this.original || props()?.sample) { closeOverlay(props().overlay); return; }
    this.saving = true; cx.notify();
    // A project task's date gets manually pinned; the dialog shows that warning before Enter.
    const pin = task.kind === "project" ? ["--allow-manual-pin"] : [];
    cx.spawn(async cx => {
      try {
        decode(await exec(cli(), ["reschedule", ...refArgs(task), "--due", due, "--yes", ...pin, "--json"]));
        setShared(REFRESH, Date.now());
        closeOverlay(props().overlay);
      } catch (e) { this.saving = false; this.error = String(e?.message ?? e); cx.notify(); }
    });
  }

  renderRedate(t) {
    const changed = localDay(this.day) !== this.original;
    const arrow = (label, days) => div().id(`shift-${days}`).cursor_pointer().px(8).rounded(4).text_color(t.muted).hover(s => s.bg(t.hover)).child(label).on_click((_e, cx) => this.shift(days, cx));
    return v_flex().id("ops-redate").track_focus(this.handle).size_full().p(16).gap(10).bg(t.popover)
      .on_key_down((e, cx) => {
        if (e.key === "escape") closeOverlay(props().overlay);
        else if (e.key === "up") this.shift(1, cx);
        else if (e.key === "down") this.shift(-1, cx);
        else if (e.key === "enter") this.reschedule(cx);
        else return;
        cx.stop_propagation();
      })
      .child(div().truncate().text_color(t.muted).child(this.redate.title))
      .child(h_flex().items_center().gap(8)
        .child(v_flex().items_center().child(arrow("▲", 1)).child(arrow("▼", -1)))
        .child(v_flex().gap(2)
          .child(div().text_size(16).text_color(changed ? t.accent : t.foreground).child(longDate(this.day)))
          .child(div().text_color(t.dim).child(`${relative(this.day)}${this.original ? ` · was ${longDate(parseDay(this.original))}` : " · no date set"}`))))
      .when(this.redate.kind === "project", el => el.child(div().text_color(t.working).child("Pins the date: it stops following its session.")))
      .when(this.error, el => el.child(div().text_color(t.blocked).child(this.error)))
      .child(div().flex_1())
      .child(h_flex().justify_end().gap(12).items_center()
        .child(div().flex_1().text_color(t.dim).child("↑↓ day · Enter save · Esc cancel"))
        .child(div().cursor_pointer().child("Cancel").on_click(() => closeOverlay(props().overlay)))
        .child(div().cursor_pointer().text_color(t.accent).child(this.saving ? "Saving…" : "Save").on_click((_e, cx) => this.reschedule(cx))));
  }

  // Notes each agent's state and since when. A tag flashes when its state changes or its
  // agent starts, never on the panel's first read.
  trackTags(tags, cx) {
    const now = Date.now(), quiet = !this.tagsReady;
    for (const m of tags) {
      const prev = this.tagSeen.get(m.address);
      if (!prev || prev.state !== m.state) {
        this.tagSeen.set(m.address, { state: m.state, since: prev ? now : (m.started ?? now) });
        if (!quiet) this.flashOnce(m.address, cx);
      }
      // A working tab's own working_since wins over when this panel noticed it.
      m.since = m.state === "working" && m.started ? m.started : this.tagSeen.get(m.address).since;
    }
    const live = new Set(tags.map(m => m.address));
    for (const address of [...this.tagSeen.keys()]) if (!live.has(address)) this.tagSeen.delete(address);
    if (this.loadedOnce || this.sample) this.tagsReady = true;
  }

  // Drawn at full strength for one frame, then faded out by the opacity transition.
  flashOnce(id, cx) {
    this.flash[id] = true;
    cx.timer.after(60, cx => { this.flash[id] = false; cx.notify(); });
  }

  // One agent on a task: state dot, session (tab) name and plain state. Clicking jumps there.
  tag(t, task, m, now) {
    const color = { ask: t.blocked, ready: t.done, working: t.working }[m.state] ?? t.working, ask = m.state === "ask";
    const text = ask ? "asks you" : m.state === "ready" ? "ready to check ✓" : `working ${elapsed(now - m.since)}`;
    const dot = div().flex_none().size(6).rounded(3).bg(color);
    return h_flex().id(`tag-${m.address}`).relative().flex_none().max_w_full().min_w(0).gap(5).items_center()
      .px(7).h(18).rounded(9).border_1().cursor_pointer()
      .border_color(ask ? t.blocked : alpha(color, 0.45)).bg(alpha(color, ask ? 0.14 : 0.08))
      .hover(s => s.bg(alpha(color, 0.2)))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); this.start(task, cx, m.address); })
      .child(ask ? dot.loop("opacity", { from: 0.3, to: 1, period: 1200 }) : dot)
      .child(div().flex_shrink_1().min_w(0).truncate().text_size(11).text_color(t.muted).child(m.tab))
      .child(div().flex_none().whitespace_nowrap().text_size(11).text_color(color).child(text))
      .child(div().id(`tag-flash-${m.address}`).absolute().inset_0().rounded(9).bg(alpha(color, 0.45))
        .opacity(this.flash[m.address] ? 1 : 0).transition("opacity", { duration: 1100, easing: "ease-out" }));
  }

  render(cx) {
    const t = theme();
    if (this.taskNotes) {
      const dismiss = () => closeOverlay(props().overlay);
      return v_flex().id("ops-task-notes").track_focus(this.handle).size_full().p(16).gap(12).bg(t.popover)
        .on_key_down((e, cx) => { if (e.key === "escape" || e.key === "enter") { dismiss(); cx.stop_propagation(); } })
        .child(div().text_size(16).text_color(t.foreground).child(this.taskNotes.title))
        .child(v_flex().id("pending-notes").flex_1().min_h(0).overflow_y_scrollbar().gap(8)
          .children(this.taskNotes.lines.map(line => div().text_color(t.foreground).child(line))))
        .child(div().cursor_pointer().text_color(t.accent).child("Return to session").on_click(dismiss));
    }
    if (this.redate) return this.renderRedate(t);
    if (this.completed) {
      const verdicts = [["Review only", "review"], ["Reshaped", "reshaped"], ["Redid", "redid"]];
      const pick = this.suggested?.verdict ?? null, ratio = this.suggested?.edit_ratio;
      const measuredLine = pick && ratio != null
        ? `You changed about ${Math.round(ratio * 100)}% of the draft.`
        : "How much did you change the draft?";
      return v_flex().id("ops-verdict").track_focus(this.handle).size_full().p(16).gap(12).bg(t.popover)
        .on_key_down((e, cx) => {
          if (e.key === "enter" && pick) this.recordVerdict(pick, cx);
          else if (e.key === "escape" || e.key === "enter") closeOverlay(props().overlay);
          else return;
          cx.stop_propagation();
        })
        .child(div().text_size(16).text_color(t.foreground).child("Task completed"))
        .child(div().text_color(t.muted).child(measuredLine))
        .child(h_flex().gap(10).children(verdicts.map(([label, value]) => div().cursor_pointer().px(8).py(4).rounded(4)
          .bg(value === pick ? t.accent : t.raised).text_color(value === pick ? t.popover : t.foreground)
          .child(label).on_click((_e, cx) => this.recordVerdict(value, cx)))))
        .when(pick, el => el.child(div().text_color(t.dim).child("Enter records the highlighted verdict")))
        .when(this.error, el => el.child(div().id("verdict-error").flex_1().min_h(0).overflow_y_scrollbar().text_color(t.blocked).child(this.error)))
        .child(h_flex().justify_end().child(div().cursor_pointer().text_color(t.muted).child("Skip").on_click(() => closeOverlay(props().overlay))));
    }
    if (this.confirm) return v_flex().id("ops-confirm").track_focus(this.handle).size_full().p(16).gap(12).bg(t.popover)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); } else if (e.key === "enter") { this.complete(cx); cx.stop_propagation(); } })
      .child(div().text_size(16).text_color(t.foreground).child("Complete task?"))
      .child(div().id("confirm-title").flex_1().min_h(0).overflow_y_scrollbar().text_color(t.muted).child(this.confirm.title))
      .when(this.error, el => el.child(div().text_color(t.blocked).child(this.error)))
      .child(h_flex().flex_none().justify_end().gap(12)
        .child(div().cursor_pointer().child("Cancel").on_click(() => closeOverlay(props().overlay)))
        .child(div().cursor_pointer().text_color(t.accent).child("Complete").on_click((_e, cx) => this.complete(cx))));

    const latest = shared(REFRESH);
    if (latest !== this.seenRefresh) { this.seenRefresh = latest; this.load(cx); }
    const hints = shared(HINTS);
    if (hints !== this.seenHints) { this.seenHints = hints; cx.timer.after(0, cx => { this.startHints(); cx.notify(); }); }
    const now = new Date(), inDays = n => localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));
    const today = inDays(0), tomorrow = inDays(1), end = inDays(7);
    const groups = ["Active", "Overdue", "Today", "Tomorrow", "Upcoming", "Later", "No date"];
    const rows = Object.fromEntries(groups.map(g => [g, []]));
    const source = this.sample ? sampleCrew(this.sampleTick) : { terms: terminals(), agents: agents() };
    const live = sessions(this.tasks, source.terms);
    const tabWorking = new Map(this.sample ? [] : spaces().flatMap(s => s.tabs ?? []).filter(tab => tab.working_since).map(tab => [tab.id, tab.working_since]));
    const tagsOf = taskTags(this.tasks, source.terms, source.agents, tabWorking);
    const allTags = [...tagsOf.values()].flat();
    this.trackTags(allTags, cx);
    this.anyWorking = allTags.some(m => m.state === "working");
    for (const task of this.tasks) rows[live.has(keyOf(task)) ? "Active" : group(task, today, tomorrow, end)].push(task);
    // Upcoming sorts by due date first. Ties and other sections use saved order, then CLI order.
    const rank = new Map(this.order.map((k, i) => [k, i]));
    const savedRank = task => rank.get(keyOf(task)) ?? this.order.length;
    for (const g of groups) {
      rows[g].sort((a, b) => (g === "Upcoming" ? a.due_date.localeCompare(b.due_date) : 0) || savedRank(a) - savedRank(b));
    }
    const heading = (g, first) => {
      const tone = t[TONE[g]] ?? t.muted;
      return h_flex().id(`heading-${g}`).px(5).gap(7).items_center().when(!first, el => el.mt(10))
        .child(div().w(3).h(13).rounded(2).bg(tone))
        .child(div().font_semibold().text_color(tone).child(g))
        .child(div().text_color(t.dim).child(String(rows[g].length)))
        .child(div().flex_1().h(1).bg(t.border));
    };
    // Clicking elsewhere takes the keyboard away: drop hint mode once focus has left.
    if (this.hinting) {
      const has = this.handle.is_focused();
      if (has) this.hadFocus = true;
      else if (this.hadFocus) { this.hinting = false; this.picked = null; this.typed = ""; }
    } else this.hadFocus = false;
    // Labels follow display order, so the nearest tasks get single letters.
    this.ordered = groups.flatMap(g => rows[g]);
    const noteSearch = this.noteSearch?.tasks === this.tasks ? this.noteSearch : null;
    if (this.query.length) {
      for (const g of groups) rows[g] = rows[g].filter(task => {
        const text = [task.display_title, task.title, task.context, task.project_name, task.customer_name, noteSearch?.notes.get(keyOf(task))].join(" ").toLowerCase();
        return this.query.every(word => text.includes(word));
      });
    }
    const ordered = groups.flatMap(g => rows[g]), names = labels(ordered.length);
    this.hintMap = ordered.map((task, i) => [names[i], task]);
    const labelOf = new Map(this.hintMap.map(([label, task]) => [task, label]));
    const badge = (task) => {
      const label = labelOf.get(task), live = label.startsWith(this.typed);
      return div().flex_none().px(4).rounded(3).font_semibold()
        .bg(live ? t.accent : t.border).text_color(live ? t.background : t.dim).child(label);
    };
    // Another mod asked to show a task (pg-sessions' task line): scroll to its row and flash it.
    const reveal = shared(REVEAL);
    if (reveal?.at && reveal.at !== this.seenReveal) { this.seenReveal = reveal.at; this.pendingReveal = { key: reveal.key, at: Date.now() }; }
    const items = [], itemKeys = [];
    for (const g of groups.filter(g => rows[g].length)) {
      items.push(heading(g, !items.length)); itemKeys.push(null);
      for (const task of rows[g]) { items.push(this.taskRow(t, task, g, live, tagsOf, now, badge)); itemKeys.push(keyOf(task)); }
    }
    if (this.pendingReveal) {
      const at = itemKeys.indexOf(this.pendingReveal.key);
      if (at >= 0) {
        const key = this.pendingReveal.key;
        this.pendingReveal = null;
        this.scroll.scroll_to_item(at);
        cx.timer.after(120, cx => { this.flashOnce(`row:${key}`, cx); cx.notify(); });
      } else if ((this.loadedOnce || this.sample) && Date.now() - this.pendingReveal.at > 10000) this.pendingReveal = null;
    }
    trackMotion(this, "ops-tasks", cx);
    return withMotion(this, v_flex().id("pg-tasks").track_focus(this.handle).size_full().min_h(0).bg(paneBacking(t, props()?.glass ? t.chrome : t.background)).text_size(12)
      .on_key_down((e, cx) => this.key(e, cx))
      .on_mouse_down("left", () => { if (!this.searching) this.handle.focus(); })
      .on_mouse_up("left", (_e, cx) => this.endDrag(cx))
      // A release outside the panel never reaches us, so leaving it cancels the drag.
      .on_hover((hovered, cx) => { if (!hovered && this.drag) { this.drag = null; this.dropAt = null; cx.notify(); } })
      .child(h_flex().h(40).px(12).items_center().border_b(1).border_color(t.border)
        .child(div().flex_1().font_semibold().text_color(t.foreground).child(this.hinting ? (this.picked ? "1 start · 2 move · 3 done · Esc" : `Pick a task${this.typed ? ` · ${this.typed}` : ""} · Esc`) : `Tasks · ${this.query.length ? `${ordered.length} of ` : ""}${this.tasks.length}${this.sample ? " · sample" : ""}`))
        .when(!this.searching && !this.hinting, el => el.child(div().id("search").mr(10).cursor_pointer().text_color(t.muted).child("/ Search")
          .on_click((_e, cx) => { this.openSearch(); cx.notify(); })))
        .child(div().id("refresh").cursor_pointer().text_color(t.muted).child(this.loading || Date.now() < (this.spinUntil ?? 0) ? svg("mods/workspace-chrome/spinner.svg").size(13).text_color(t.muted).spin(900) : "↻").on_click((_e, cx) => this.load(cx))))
      .when(this.searching, el => el.child(h_flex().flex_none().mx(8).mt(8).px(8).h(30).gap(7).items_center().rounded(5).border_1().border_color(t.accent)
        .child(svg("mods/workspace-chrome/search.svg").size(13).text_color(t.dim))
        .child(Input.new(this.searchInput).flex_1().min_w(0).h_full().text_color(t.foreground))
        .child(div().text_color(t.dim).child("Esc"))))
      .when(this.error, el => el.child(div().p(10).text_color(t.blocked).child(this.error)))
      .when(this.query.length && (noteSearch?.loading || noteSearch?.incomplete), el => el.child(div().px(12).pt(6).text_color(t.dim)
        .child(noteSearch.loading ? "Searching project task notes…" : "Some project task notes could not be searched.")))
      .when(this.query.length && !ordered.length && !this.loading && !noteSearch?.loading, el => el.child(div().p(12).text_color(t.dim).child("No matching tasks.")))
      .child(v_flex().id("tasks-list").track_scroll(this.scroll).flex_1().min_h(0).overflow_y_scrollbar().p(8).gap(8).children(items)));
  }

  // One task row, as the kit's, plus a tag per agent working it under the title.
  taskRow(t, task, g, live, tagsOf, now, badge) {
    const ref = keyOf(task), session = live.get(ref), draft = this.drafts[ref], details = this.taskDates?.[ref];
    const marker = draftMarker(draft, details), waiting = waitingLabel(draft, details, now);
    const dates = rowDates(task, details), detailLines = rowDetails(task, draft, details);
    const unread = unreadNotes(draft), notes = unread === 1 ? "1 note" : `${unread} notes`;
    const tags = tagsOf.get(ref) ?? [];
    return v_flex().id(`task-${task.source}-${task.kind}-${task.id}`).relative().p(7).gap(3).rounded(6).hover(s => s.bg(t.hover))
      .when(session, el => el.bg(t.selected ?? t.hover))
      .border_t(2).border_b(2).border_color(CLEAR)
      .when(this.dropAt?.key === ref, el => this.dropAt.after ? el.border_b(2).border_color(t.accent) : el.border_t(2).border_color(t.accent))
      .when(this.drag?.active && this.drag.key === ref, el => el.opacity(0.4))
      .on_mouse_down("left", e => { this.drag = { key: ref, group: g, due: task.due_date, y: e.position.y, active: false }; })
      .on_mouse_move((e, cx) => this.dragOver(task, g, e, cx))
      .when(this.picked === task, el => el.bg(t.hover).border_1().border_color(t.accent))
      .child(h_flex().gap(5).items_center().when(this.hinting && !this.picked, el => el.child(badge(task))).child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(`${task.status === "In progress" ? "▶ " : ""}${task.title}`))
        .child(div().cursor_pointer().text_color(t.accent).child(session ? "↗" : "▶").on_click((_e, cx) => this.start(task, cx)))
        .child(div().id(`redate-${task.source}-${task.kind}-${task.id}`).cursor_pointer().child(svg("mods/workspace-chrome/clock.svg").size(12).text_color(t.muted)).on_click(() => this.openRedate(task)))
        .child(div().cursor_pointer().text_color(t.muted).child("✓").on_click(() => this.openComplete(task))))
      .when(tags.length, el => el.child(h_flex().flex_wrap().gap(4).min_w(0).children(tags.map(m => this.tag(t, task, m, now)))))
      .child(h_flex().gap(8).text_color(t.dim)
        .when(marker, el => el.child(div().flex_none().whitespace_nowrap().text_color(t[marker[1]]).child(marker[0])))
        .when(unread, el => el.child(div().flex_none().whitespace_nowrap().text_color(t.accent).child(notes)))
        // The tags carry each agent's state, so the kit's status dot only shows without them.
        .when(session && !tags.length, el => el.child(h_flex().flex_none().gap(4).items_center()
          .child(div().size(6).rounded(3).bg(t[session.status] ?? t.accent))
          .child(div().whitespace_nowrap().text_color(t[session.status] ?? t.accent).child(session.status || "running"))))
        .child(div().flex_1().min_w(0).truncate().child(rowMeta(task))))
      .when(dates, el => el.child(div().min_w(0).truncate().text_color(t.dim).child(dates)))
      .when(waiting, el => el.child(div().min_w(0).truncate().text_color(t.working).child(waiting)))
      .when(this.picked === task, el => el.child(v_flex().id(`details-${ref}`).min_w(0).overflow_x_scrollbar().text_color(t.muted)
        .children(detailLines.map(line => div().whitespace_nowrap().child(line)))))
      .child(div().id(`row-flash-${ref}`).absolute().inset_0().rounded(6).bg(alpha(t.accent, 0.3))
        .opacity(this.flash[`row:${ref}`] ? 1 : 0).transition("opacity", { duration: 1100, easing: "ease-out" }));
  }
}
