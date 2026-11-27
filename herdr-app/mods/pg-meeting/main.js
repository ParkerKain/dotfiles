// Playground prototype: Meeting mode, meant to replace the Call Sheet panel. One full view
// with three areas visible together: Agenda (the session's prep scratchpad as read-only
// notes), Points of performance (the checklist, ticked by click or keys, with a short note
// per point) and Notes (a large text box for running notes). A slim header shows the
// session, the time since the call started and Done / Leave. No time boxes or timers.
//
// Flipping in and out: this mod is a block in its own layout, Meeting. The palette entry
// "Meeting mode (playground)" opens this mod as a tiny overlay, which remembers the shown
// layout in shared("pg-meeting.prev") and switches to Meeting. Run again from Meeting (or
// `pg-meeting.toggle`, q, or Leave), it asks to rate and submit, with Skip to leave
// without submitting, then switches back to the remembered layout.
//
// Data goes through `ops-tasks callsheet`, the same calls the kit's Call Sheet makes:
// sessions, show, mark, point-note and submit. Marks and point notes save to Ops at once.
// The Notes box is the call sheet's "Instructions for the follow-up" field
// (follow_up_instructions). Like the Call Sheet's text fields it saves locally per session
// as you type and goes to Ops with the submit. Call feedback is asked for in the leave box.
import { View, div } from "gpui-kit";
import { h_flex, v_flex, ScrollHandle, TextareaState, Textarea, InputState, Input, TextView } from "gpui-base";
import { checking, exec, home, theme, layout, layouts, run, props, shared, setShared, nextCommand, closeOverlay, notify, settings } from "herdr";
import { SAMPLE_SESSIONS, sampleSheet } from "./lib/sample.js";

// Scratch checks flip these to render sample data and a given state.
const FORCE_SAMPLE = false;
const FORCE_MODE = null; // "pick" | "points" | "agenda" | "notes" | "note" | "confirm" | "feedback"

const LAYOUT = "Meeting";
const PREV_KEY = "pg-meeting.prev";
const SESSION_KEY = "pg-meeting.session";
const FALLBACK_LAYOUT = "Playground";
const NOTE_LIMIT = 280;
const RESULT = { done: "✓", missed: "✗", na: "–" };
const RATINGS = [["g", "green", "Green"], ["y", "yellow", "Yellow"], ["r", "red", "Red"], ["x", "no_show", "No show"]];
// Notes → follow-up; feedback is filled in the leave box. Same flags and keys as the Call Sheet.
const FIELDS = {
  notes: { flag: "follow-up", key: "follow_up_instructions", label: "Notes" },
  feedback: { flag: "feedback", key: "call_feedback", label: "Call feedback" },
};
const AREAS = ["agenda", "points", "notes"];
const draftKey = (id) => `pg-meeting.draft.${id}`;

const cli = () => `${home()}/go/bin/ops-tasks`;

// Scales a color's alpha, keeping any alpha it already has (layouts often set #rrggbbaa).
const alpha = (hex, a) => {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex ?? "");
  return m ? "#" + m[1] + Math.round(a * (m[2] ? parseInt(m[2], 16) / 255 : 1) * 255).toString(16).padStart(2, "0") : hex;
};
// Matches the terminal panes' backing over a wallpaper: 1 - (1 - o)^2 (see pg-artifacts).
function paneBacking(t) {
  const o = Number(layout()?.terminal_opacity);
  if (!(o >= 0 && o < 1) || !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(t.background ?? "")) return t.background;
  return t.background.slice(0, 7) + Math.round((1 - (1 - o) ** 2) * 255).toString(16).padStart(2, "0");
}

function readDraft(id) {
  try { return JSON.parse(localStorage.getItem(draftKey(id)) ?? "{}") ?? {}; } catch { return {}; }
}
function writeDraft(id, draft) {
  try {
    if (Object.keys(draft).length) localStorage.setItem(draftKey(id), JSON.stringify(draft));
    else localStorage.removeItem(draftKey(id));
  } catch { /* the textarea still holds it */ }
}

// The Call Sheet's prep sections: paragraphs, so a long agenda scrolls a section at a time.
function splitBlocks(text) {
  const parts = (text ?? "").split(/(\n[ \t]*\n+)/), blocks = [];
  for (let i = 0; i < parts.length; i += 2) blocks.push({ text: parts[i], sep: parts[i + 1] ?? "" });
  return blocks.filter(b => b.text.trim());
}
const shownMd = (s) => s.replace(/([^\n])\n(?=[^\n])/g, "$1  \n");

// Runs ops-tasks and returns { data } or { error, code } from its JSON envelope.
async function callsheet(args) {
  let result;
  try { result = await exec(cli(), ["callsheet", ...args, "--json"]); }
  catch (e) { return { error: `ops-tasks did not start: ${e?.message ?? e}`, code: "unavailable" }; }
  let value;
  try { value = JSON.parse(result.stdout); } catch { return { error: result.stderr.trim() || `ops-tasks exited ${result.code}`, code: "unavailable" }; }
  if (!value.ok) return { error: value.error?.message || `ops-tasks exited ${result.code}`, code: value.error?.code };
  return { data: value.data };
}

const pad = (n) => String(n).padStart(2, "0");
const localDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function clock(iso) {
  const d = new Date(iso), h = d.getHours();
  return `${h % 12 || 12}:${pad(d.getMinutes())}${h < 12 ? "am" : "pm"}`;
}
// A plain elapsed clock since the session's start, h:mm. No target, no length.
function elapsed(session, now) {
  if (!session?.starts_at) return "";
  const mins = Math.floor((now - new Date(session.starts_at)) / 60000);
  if (mins < 0) return `starts ${clock(session.starts_at)}`;
  return `${Math.floor(mins / 60)}:${pad(mins % 60)}`;
}
const pointKey = (p) => p.id != null ? `p${p.id}` : `t${p.meeting_type_point_id}`;

export default class Meeting extends View {
  init(_props, cx) {
    // Opened from the palette (mod.open): a launcher, not the meeting view.
    this.launcher = Boolean(props()?.overlay);
    if (this.launcher) {
      if (!checking()) cx.timer.after(30, () => this.launch());
      return;
    }
    this.handle = cx.focus_handle();
    this.pointsScroll = ScrollHandle.new();
    this.agendaScroll = ScrollHandle.new();
    this.sessions = []; this.pickCursor = 0; this.sessionId = null;
    this.sheet = null; this.version = null; this.blocks = []; this.blockSel = 0;
    this.cursor = 0; this.area = "points"; this.mode = "pick"; // pick | main | note | confirm
    this.rating = null; this.submitting = false; this.saving = 0; this.loading = false;
    this.error = null; this.notice = null; this.flash = {}; this.size = null;
    this.chain = Promise.resolve();
    this.fields = {};
    for (const [name, field] of Object.entries(FIELDS)) {
      const state = TextareaState.new({ placeholder: name === "notes" ? "Running notes. They save here as you type and go to Ops as the follow-up instructions when you submit." : "How the call went (posts to #engagement-feedback)", rows: name === "notes" ? 14 : 3 });
      state.set_auto_grow(name === "notes" ? 14 : 3, name === "notes" ? 2000 : 8);
      this.fields[name] = { state, saved: "" };
      state.on("change", (_e, cx) => { this.keepLocal(); cx.notify(); });
      state.on("submit", (e, cx) => { if (e?.secondary) { if (name === "feedback") this.submit(cx); else this.askLeave(); cx.notify(); } });
      state.on("focus", (_e, cx) => {
        if (name === "notes") { this.area = "notes"; if (this.mode !== "confirm") this.mode = "main"; }
        else this.mode = "feedback";
        cx.notify();
      });
    }
    this.noteInput = InputState.new({ placeholder: "Note on this point (280 max)" });
    this.noteInput.on("submit", (_e, cx) => this.saveNote(cx));

    if (FORCE_SAMPLE) { this.loadSample(); return; }
    if (checking()) return;
    cx.spawn(async cx => {
      for (;;) {
        const c = await nextCommand();
        if (c === "focus") this.focusArea();
        else if (c === "toggle") { if (this.mode === "confirm") this.cancelLeave(); else this.askLeave(); }
        cx.notify();
      }
    });
    cx.timer.after(40, () => this.handle.focus());
    const remembered = Number(shared(SESSION_KEY));
    if (remembered > 0) this.open(remembered, cx);
    this.loadSessions(cx, !(remembered > 0));
    // The elapsed clock shows minutes, so a quarter-minute tick is enough. A quiet reload
    // picks up changes made on the Ops page while nothing is being edited.
    cx.timer.every(15000, cx => cx.notify());
    cx.timer.every(30000, cx => { if (this.sessionId && !this.saving && !this.submitting && this.mode === "main" && this.area !== "notes") this.loadSheet(cx); });
  }

  // Palette launcher: remember where we came from, then flip. From Meeting it is the toggle.
  launch() {
    const id = props()?.overlay, current = shared("layout");
    if (id) closeOverlay(id);
    if (current === LAYOUT) { run("pg-meeting.toggle"); return; }
    if (!layouts().includes(LAYOUT)) { notify({ title: "Meeting mode", body: `No ${LAYOUT} layout in layouts/.`, level: "error" }); return; }
    setShared(PREV_KEY, current);
    run("layout.switch", { name: LAYOUT });
  }

  loadSample() {
    this.sessions = SAMPLE_SESSIONS;
    this.sessionId = 9001;
    this.sheet = sampleSheet(); this.apply(this.sheet);
    this.fields.notes.state.set_value("Priya owns the DE. Sam backs up.\nFirst ticket: PAY-142, the refund retry bug.\n\nFollow up with the staging repo access.");
    const m = FORCE_MODE ?? "points";
    this.mode = m === "pick" || m === "note" || m === "confirm" ? m : m === "feedback" ? "confirm" : "main";
    this.area = ["agenda", "notes"].includes(m) ? m : "points";
    this.cursor = 1;
    if (m === "note") { this.notePoint = this.points()[1]; this.noteInput.set_value(this.notePoint.note); }
    if (m === "confirm" || m === "feedback") this.rating = "green";
    this.flash[pointKey(this.points()[0])] = true;
  }

  // ---- data -------------------------------------------------------------------------

  loadSessions(cx, autoOpen = false) {
    cx.spawn(async cx => {
      const r = await callsheet(["sessions", "--date", localDay(new Date())]);
      if (r.error) { this.error = r.error; cx.notify(); return; }
      this.sessions = r.data.sessions ?? [];
      const live = this.sessions.filter(s => s.live);
      const at = this.sessions.findIndex(s => s.id === (this.sessionId ?? live[0]?.id));
      this.pickCursor = Math.max(0, at);
      // Flipping in mid-call: exactly one live session opens by itself.
      if (autoOpen && !this.sessionId && live.length === 1) this.open(live[0].id, cx);
      cx.notify();
    });
  }

  dirtyFields() { return Object.keys(FIELDS).filter(name => this.fields[name].state.value() !== this.fields[name].saved); }

  keepLocal() {
    if (!this.sessionId || !this.sheet || FORCE_SAMPLE) return;
    const draft = {};
    for (const name of this.dirtyFields()) draft[name] = this.fields[name].state.value();
    writeDraft(this.sessionId, draft);
  }

  open(id, cx) {
    if (id !== this.sessionId) {
      this.keepLocal(); this.sheet = null; this.cursor = 0; this.rating = null; this.blocks = []; this.blockSel = 0;
      for (const f of Object.values(this.fields)) { f.saved = ""; f.state.set_value(""); }
    }
    this.sessionId = id; this.mode = "main"; this.area = "points"; this.error = null; this.notice = null;
    if (!checking()) setShared(SESSION_KEY, id);
    this.handle.focus();
    this.loadSheet(cx);
  }

  loadSheet(cx) {
    const id = this.sessionId;
    this.loading = true;
    cx.spawn(async cx => {
      const r = await callsheet(["show", "--session", String(id)]);
      this.loading = false;
      if (id !== this.sessionId) return;
      if (r.error) { this.error = r.error; cx.notify(); return; }
      const first = !this.sheet;
      this.sheet = r.data; this.error = null;
      this.apply(r.data);
      if (first) {
        const draft = readDraft(id);
        for (const [name, text] of Object.entries(draft)) if (this.fields[name] && text !== this.fields[name].saved) this.fields[name].state.set_value(text);
        this.keepLocal();
      }
      cx.notify();
    });
  }

  // Takes a show or save answer. A field with unsaved typing keeps what was typed.
  apply(data) {
    this.version = data.version;
    this.sheet = { ...this.sheet, groups: data.groups, status: data.status, submitted: data.submitted ?? this.sheet?.submitted, rating: data.rating ?? this.sheet?.rating };
    if ("scratchpad" in data) {
      this.blocks = splitBlocks(data.scratchpad);
      this.blockSel = Math.min(this.blockSel, Math.max(0, this.blocks.length - 1));
    }
    for (const [name, field] of Object.entries(FIELDS)) {
      if (!(field.key in data)) continue;
      const entry = this.fields[name], remote = data[field.key] ?? "";
      if (entry.state.value() === entry.saved) entry.state.set_value(remote);
      entry.saved = remote;
    }
    this.cursor = Math.min(this.cursor, Math.max(0, this.points().length - 1));
    this.keepLocal();
  }

  points() { return (this.sheet?.groups ?? []).flatMap(g => g.points); }

  // One save at a time, each with the version the last one returned (as the Call Sheet).
  save(args, cx, describe, { after } = {}) {
    const id = this.sessionId;
    if (FORCE_SAMPLE) return;
    this.saving++; cx.notify();
    this.chain = this.chain.then(() => new Promise(resolve => cx.spawn(async cx => {
      const version = this.version == null ? [] : ["--version", this.version];
      const r = await callsheet([...args, "--session", String(id), ...version]);
      this.saving--;
      if (id === this.sessionId) {
        if (r.error) {
          this.error = r.code === "version_conflict" ? "Someone saved this call sheet on the Ops page. Reloaded, so check your last change."
            : r.code === "mutation_unknown" ? "That save may not have landed. Reloaded from Ops." : `${describe} failed: ${r.error}`;
          this.loadSheet(cx);
        } else { this.apply(r.data); this.error = null; this.notice = `Saved ${describe}`; after?.(cx); }
      }
      cx.notify(); resolve();
    })));
  }

  pointArgs(point) { return point.id != null ? ["--point", String(point.id)] : ["--type-point", String(point.meeting_type_point_id)]; }

  // Ticking flashes the row: full strength for a frame, then it fades (see pg-glances).
  mark(result, cx, index = this.cursor) {
    const point = this.points()[index];
    if (!point) return;
    const next = point.result === result ? "clear" : result;
    point.result = next === "clear" ? null : next;
    this.recount();
    const key = pointKey(point);
    this.flash[key] = true;
    cx.timer.after(60, cx => { this.flash[key] = false; cx.notify(); });
    this.save(["mark", ...this.pointArgs(point), "--result", next], cx, next === "clear" ? "cleared" : next === "na" ? "n/a" : next);
  }

  recount() {
    for (const g of this.sheet?.groups ?? []) {
      g.done = g.points.filter(p => p.result === "done").length;
      g.missed = g.points.filter(p => p.result === "missed").length;
      g.na = g.points.filter(p => p.result === "na").length;
    }
  }

  editNote() {
    const point = this.points()[this.cursor];
    if (!point) return;
    this.mode = "note"; this.notePoint = point;
    this.noteInput.set_value(point.note ?? "");
    this.noteInput.focus();
  }

  saveNote(cx) {
    const point = this.notePoint, note = this.noteInput.value().trim();
    if (!point) return;
    if ([...note].length > NOTE_LIMIT) { this.error = `Notes are capped at ${NOTE_LIMIT} characters (this one is ${[...note].length}).`; cx.notify(); return; }
    this.mode = "main"; this.notePoint = null; this.handle.focus();
    if (note === (point.note ?? "")) { cx.notify(); return; }
    point.note = note;
    this.save(["point-note", ...this.pointArgs(point), "--note", note], cx, "note");
  }

  // ---- leaving ----------------------------------------------------------------------

  // Leave asks to rate and submit. With no session open there is nothing to submit.
  askLeave() {
    if (this.submitting) return;
    if (!this.sheet) { this.leave(); return; }
    this.beforeConfirm = this.area;
    this.rating = this.rating ?? this.sheet.rating ?? null;
    this.mode = "confirm"; this.error = null;
    this.handle.focus();
  }

  cancelLeave() { this.mode = "main"; this.area = this.beforeConfirm ?? "points"; this.focusArea(); }

  // Back to the layout we came from. The session is kept unless it was just submitted.
  leave() {
    const prev = shared(PREV_KEY);
    const names = layouts();
    const target = prev && prev !== LAYOUT && names.includes(prev) ? prev : names.includes(FALLBACK_LAYOUT) ? FALLBACK_LAYOUT : names.find(n => n !== LAYOUT);
    if (target && !checking()) run("layout.switch", { name: target });
  }

  // The person said yes: the Call Sheet's submit, with changed fields and the rating.
  submit(cx) {
    if (this.submitting || !this.sheet) return;
    const id = this.sessionId, args = ["submit", "--confirmed"];
    for (const name of this.dirtyFields()) args.push(`--${FIELDS[name].flag}`, this.fields[name].state.value());
    if (this.rating && this.rating !== this.sheet?.rating) args.push("--rating", this.rating);
    this.mode = "main"; this.submitting = true; this.handle.focus();
    this.save(args, cx, "submit", { after: () => {
      this.submitting = false;
      writeDraft(id, {});
      setShared(SESSION_KEY, null);
      notify({ title: "Call sheet submitted", body: "Transcript Machine gets it, and call feedback posts to #engagement-feedback.", level: "success" });
      this.leave();
    } });
    this.chain = this.chain.then(() => { this.submitting = false; this.keepLocal(); });
  }

  // ---- keys -------------------------------------------------------------------------

  focusArea() {
    if (this.mode === "confirm" || this.mode === "pick") { this.handle.focus(); return; }
    if (this.area === "notes") this.fields.notes.state.focus(); else this.handle.focus();
  }

  setArea(area) { this.area = area; this.mode = "main"; this.focusArea(); }

  cycleArea(back) {
    const n = AREAS.length;
    this.setArea(AREAS[(AREAS.indexOf(this.area) + (back ? n - 1 : 1)) % n]);
  }

  move(by) {
    const n = this.points().length;
    if (n) this.cursor = Math.max(0, Math.min(n - 1, this.cursor + by));
    this.pointsScroll.scroll_to_item(this.rowIndex(this.cursor));
  }

  jumpGroup(dir) {
    const groups = this.sheet?.groups ?? [];
    let start = 0, at = 0;
    const starts = groups.map(g => { const s = start; start += g.points.length; return s; });
    for (let i = 0; i < starts.length; i++) if (starts[i] <= this.cursor) at = i;
    const target = dir > 0 ? starts[Math.min(at + 1, starts.length - 1)] : (this.cursor > starts[at] ? starts[at] : starts[Math.max(0, at - 1)]);
    this.cursor = target ?? 0;
    this.pointsScroll.scroll_to_item(this.rowIndex(this.cursor));
  }

  rowIndex(cursor) {
    let index = 0, seen = 0;
    for (const g of this.sheet?.groups ?? []) {
      index++;
      if (cursor < seen + g.points.length) return index + cursor - seen;
      index += g.points.length; seen += g.points.length;
    }
    return index;
  }

  selectBlock(i) {
    if (!this.blocks.length) return;
    this.blockSel = Math.max(0, Math.min(this.blocks.length - 1, i));
    this.agendaScroll.scroll_to_item(this.blockSel);
  }

  key(e, cx) {
    const k = e.key, shift = e.modifiers?.shift, ks = e.keystroke;
    if (this.mode === "confirm") {
      const rating = RATINGS.find(([key]) => key === k);
      if (k === "escape") this.cancelLeave();
      else if (ks === "enter") this.submit(cx);
      else if (k === "s") this.leave();
      else if (k === "f") this.fields.feedback.state.focus();
      else if (rating) this.rating = this.rating === rating[1] ? null : rating[1];
      return true;
    }
    if (this.mode === "feedback") {
      if (k === "escape") { this.mode = "confirm"; this.handle.focus(); return true; }
      if (ks === "cmd-enter" || ks === "ctrl-enter") { this.submit(cx); return true; }
      return false;
    }
    if (this.mode === "note") {
      if (k === "escape") { this.mode = "main"; this.notePoint = null; this.handle.focus(); return true; }
      return false;
    }
    if (ks === "cmd-enter" || ks === "ctrl-enter") { if (this.mode !== "pick") this.askLeave(); return true; }
    if (this.mode === "pick") {
      if (k === "escape") { if (this.sessionId) this.mode = "main"; else this.leave(); }
      else if (k === "q") this.leave();
      else if (k === "j" || k === "down") this.pickCursor = Math.min(this.sessions.length - 1, this.pickCursor + 1);
      else if (k === "k" || k === "up") this.pickCursor = Math.max(0, this.pickCursor - 1);
      else if (k === "enter" && this.sessions[this.pickCursor]) this.open(this.sessions[this.pickCursor].id, cx);
      else if (k === "r") this.loadSessions(cx);
      else return false;
      return true;
    }
    if (this.area === "notes") {
      // The text box has the keyboard: Esc and Tab leave it, the text stays saved locally.
      if (k === "escape") { this.setArea("points"); return true; }
      if (k === "tab") { this.cycleArea(shift); return true; }
      return false;
    }
    if (k === "tab") this.cycleArea(shift);
    else if (k === "1" || k === "2" || k === "3") this.setArea(AREAS[Number(k) - 1]);
    else if (k === "i" || k === "w") this.setArea("notes");
    else if (k === "q") this.askLeave();
    else if (k === "s") { this.mode = "pick"; this.loadSessions(cx); }
    else if (k === "r") { this.loadSheet(cx); }
    else if (this.area === "agenda") {
      if (k === "j" || k === "down") this.selectBlock(this.blockSel + 1);
      else if (k === "k" || k === "up") this.selectBlock(this.blockSel - 1);
      else if ((k === "g" && shift) || k === "G" || k === "end") this.selectBlock(this.blocks.length - 1);
      else if (k === "g" || k === "home") this.selectBlock(0);
      else if (k === "escape") this.setArea("points");
      else return false;
    }
    else if ((k === "j" && shift) || k === "J") this.jumpGroup(1);
    else if ((k === "k" && shift) || k === "K") this.jumpGroup(-1);
    else if (k === "j" || k === "down") this.move(1);
    else if (k === "k" || k === "up") this.move(-1);
    else if (k === "d" || k === "space") this.mark("done", cx);
    else if (k === "m") this.mark("missed", cx);
    else if (k === "n") this.mark("na", cx);
    else if (k === "c") { const p = this.points()[this.cursor]; if (p?.result) this.mark(p.result, cx); }
    else if ((k === "e" && shift) || k === "E" || k === "e" || k === "enter") this.editNote();
    else return false;
    return true;
  }

  // ---- render -----------------------------------------------------------------------

  card(t, id, title, aside, active, body) {
    return v_flex().id(id).flex_1().min_w(0).min_h(0).rounded(10).border_1()
      .border_color(active ? t.accent : t.border).bg(alpha(t.raised, 0.35)).overflow_hidden()
      .child(h_flex().flex_none().h(30).px(12).gap(8).items_center().border_b(1).border_color(alpha(t.border, 0.7))
        .child(div().flex_none().font_semibold().text_color(active ? t.accent : t.muted).child(title))
        .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(aside ?? "")))
      .child(body);
  }

  renderAgenda(t) {
    const active = this.area === "agenda" && this.mode === "main";
    const rows = this.blocks.map((b, i) => {
      const sel = active && i === this.blockSel;
      return div().id(`blkrow-${i}`).px(8).py(2).child(
        div().id(`blk-${i}`).w_full().px(10).py(4).rounded(6).text_size(13).text_color(t.foreground)
          .border_l(3).border_color(sel ? t.accent : alpha(t.border, 0))
          .when(sel, el => el.bg(t.selected ?? t.hover))
          .on_mouse_down("left", (_e, cx) => { this.area = "agenda"; this.mode = "main"; this.selectBlock(i); this.handle.focus(); cx.stop_propagation(); cx.notify(); })
          .child(TextView.markdown(`md-${i}`, shownMd(b.text))));
    });
    const body = v_flex().id("agenda-scroll").flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.agendaScroll).py(8)
      .children(rows)
      .when(!this.blocks.length, el => el.child(div().px(14).py(6).text_color(t.dim).child(this.sheet ? "No agenda yet. The prep scratchpad on the Call Sheet holds it." : "")));
    return this.card(t, "agenda", "Agenda", "prep scratchpad · read-only", active, body);
  }

  renderPoint(t, point, index) {
    const selected = index === this.cursor && this.area === "points" && (this.mode === "main" || this.mode === "note");
    const tone = point.result === "done" ? t.working : point.result === "missed" ? t.blocked : t.dim;
    const noting = this.mode === "note" && this.notePoint === point;
    return v_flex().id(`point-${index}`).relative().px(6).py(5).gap(2).rounded(6).cursor_pointer()
      .when(selected, el => el.bg(t.selected ?? t.hover))
      .hover(st => st.bg(t.hover))
      .on_click((_e, cx) => { this.cursor = index; this.area = "points"; if (this.mode !== "note") this.mode = "main"; this.handle.focus(); cx.notify(); })
      .child(div().id(`flash-${index}`).absolute().inset_0().rounded(6).bg(alpha(point.result === "missed" ? t.blocked : t.working, 0.4))
        .opacity(this.flash[pointKey(point)] ? 1 : 0).transition("opacity", { duration: 900, easing: "ease-out" }))
      .child(h_flex().gap(8).items_start()
        // The tick: a click marks it done, a second click clears it.
        .child(div().id(`tick-${index}`).flex_none().w(18).h(18).rounded(5).border_1().flex().items_center().justify_center()
          .border_color(point.result ? alpha(tone, 0.7) : t.border).text_color(tone).text_size(12)
          .hover(st => st.border_color(t.accent))
          .on_click((_e, cx) => { this.cursor = index; this.area = "points"; this.mark("done", cx, index); this.handle.focus(); cx.stop_propagation(); cx.notify(); })
          .child(RESULT[point.result] ?? ""))
        .child(div().flex_1().min_w(0).text_size(13).text_color(point.result === "na" ? t.dim : t.foreground).child(point.label)))
      .when(noting, el => el.child(div().pl(26).child(Input.new(this.noteInput).w_full().px(6).py(3).rounded(5).border_1().border_color(t.accent).bg(t.background).text_color(t.foreground))))
      .when(Boolean(point.note) && !noting, el => el.child(div().pl(26).text_color(t.muted).child(point.note)));
  }

  renderPoints(t) {
    const groups = this.sheet?.groups ?? [];
    const done = groups.reduce((n, g) => n + g.done, 0), total = groups.reduce((n, g) => n + g.total, 0);
    const rows = [];
    let index = 0;
    for (const g of groups) {
      const complete = g.done + g.missed + g.na === g.total;
      rows.push(h_flex().id(`group-${index}`).px(5).pt(rows.length ? 10 : 2).pb(2).gap(7).items_center()
        .child(div().font_semibold().text_color(complete ? t.working : t.accent).child(g.name))
        .child(div().text_color(t.dim).child(`${g.done}/${g.total}${g.missed ? ` · ${g.missed} missed` : ""}${g.na ? ` · ${g.na} n/a` : ""}`))
        .child(div().flex_1().h(1).bg(alpha(t.border, 0.7))));
      for (const point of g.points) rows.push(this.renderPoint(t, point, index++));
    }
    const body = v_flex().id("points-scroll").flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.pointsScroll).p(8).gap(1)
      .children(rows)
      .when(!rows.length, el => el.child(div().px(6).py(4).text_color(t.dim).child(this.sheet ? "This meeting type has no points." : "")));
    return this.card(t, "points", "Points of performance", total ? `${done}/${total}` : "", this.area === "points" && this.mode !== "confirm", body);
  }

  renderNotes(t) {
    const entry = this.fields.notes, dirty = entry.state.value() !== entry.saved;
    const active = this.area === "notes" && this.mode === "main";
    const body = v_flex().id("notes-scroll").flex_1().min_h(0).overflow_y_scrollbar().p(10)
      .on_mouse_down("left", (_e, cx) => { this.setArea("notes"); cx.notify(); })
      .child(Textarea.new(entry.state).w_full().p(8).rounded(6).border_1().border_color(active ? alpha(t.accent, 0.6) : alpha(t.border, 0.6))
        .bg(alpha(t.background, 0.5)).text_size(13.5).text_color(t.foreground));
    return this.card(t, "notes", "Notes", dirty ? "saved here · goes to Ops as the follow-up on submit" : "follow-up instructions", active, body);
  }

  renderPick(t) {
    return v_flex().id("pick").flex_1().min_h(0).overflow_y_scrollbar().p(16).gap(4).max_w(720)
      .child(div().px(4).pb(4).font_semibold().text_size(14).text_color(t.foreground).child("Which call is this?"))
      .when(!this.sessions.length, el => el.child(div().px(4).text_color(t.dim).child(this.error ? "" : "No sessions you lead today.")))
      .children(this.sessions.map((s, i) => h_flex().id(`pick-${s.id}`).px(8).py(6).gap(10).rounded(6).cursor_pointer()
        .when(i === this.pickCursor, el => el.bg(t.selected ?? t.hover))
        .hover(st => st.bg(t.hover)).on_click((_e, cx) => { this.open(s.id, cx); cx.notify(); })
        .child(div().w(60).flex_none().text_color(s.live ? t.working : t.muted).child(clock(s.starts_at)))
        .child(v_flex().flex_1().min_w(0)
          .child(div().truncate().text_color(t.foreground).child(s.name))
          .child(div().truncate().text_color(t.dim).child(s.live ? `Live · ${s.project_name}` : s.project_name)))
        .when(Boolean(s.submitted), el => el.child(div().flex_none().text_color(t.working).child("✓")))));
  }

  // The leave box: rate and submit (the Call Sheet's submit), Skip, or stay.
  renderConfirm(t, session) {
    const groups = this.sheet?.groups ?? [];
    const open = groups.reduce((n, g) => n + g.total - g.done - g.missed - g.na, 0);
    const dirty = this.dirtyFields();
    const line = (text, color = t.muted) => div().text_color(color).child(text);
    const button = (id, text, primary, onClick) => div().id(id).px(12).py(6).rounded(6).cursor_pointer().border_1()
      .border_color(primary ? t.accent : t.border).bg(primary ? t.accent : alpha(t.background, 0.6)).text_color(primary ? (t.accent_foreground ?? t.background) : t.foreground)
      .child(text).on_click((_e, cx) => { onClick(cx); cx.notify(); });
    const fb = this.fields.feedback;
    const card = v_flex().id("confirm-card").w(520).max_w_full().p(18).gap(12).rounded(12).border_1().border_color(t.border).bg(t.popover ?? t.background)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(div().font_semibold().text_size(15).text_color(t.foreground).child(`Submit the call sheet${session ? ` for ${session.name}` : ""}?`))
      .child(v_flex().gap(3)
        .child(line("Transcript Machine gets the call sheet, and call feedback posts to #engagement-feedback."))
        .child(line("The session is marked Completed if it has started."))
        .child(line(dirty.length ? `Also sends: ${dirty.map(n => n === "notes" ? "notes as the follow-up" : "call feedback").join(", ")}.` : "No local text changes to send.", t.dim))
        .when(open > 0, el => el.child(line(`${open} point${open === 1 ? "" : "s"} still unanswered.`, t.blocked)))
        .when(Boolean(this.sheet?.submitted), el => el.child(line("Already submitted once. Submitting again marks it edited since submit.", t.dim))))
      .child(v_flex().gap(5)
        .child(div().font_semibold().text_color(this.mode === "feedback" ? t.accent : t.muted).child("Call feedback (f)"))
        .child(Textarea.new(fb.state).w_full().p(7).rounded(6).border_1().border_color(this.mode === "feedback" ? t.accent : t.input ?? t.border).bg(t.background).text_color(t.foreground)))
      .child(v_flex().gap(5)
        .child(div().font_semibold().text_color(t.muted).child("Rating"))
        .child(h_flex().gap(6).children(RATINGS.map(([key, value, label]) => div().id(`rating-${value}`).px(9).py(4).rounded(5).cursor_pointer().border_1()
          .border_color(this.rating === value ? t.accent : t.border).text_color(this.rating === value ? t.accent : t.muted)
          .child(`${key} ${label}`).on_click((_e, cx) => { this.rating = this.rating === value ? null : value; this.handle.focus(); this.mode = "confirm"; cx.notify(); })))))
      .child(h_flex().gap(8).pt(4).flex_wrap()
        .child(button("confirm-submit", "Submit and leave (Enter)", true, cx => this.submit(cx)))
        .child(button("confirm-skip", "Skip, leave without submitting (s)", false, () => this.leave()))
        .child(button("confirm-stay", "Stay (Esc)", false, () => this.cancelLeave())));
    return div().id("confirm-veil").absolute().inset_0().bg(alpha("#000000", 0.45)).flex().items_center().justify_center().p(16)
      .on_mouse_down("left", (_e, cx) => { this.cancelLeave(); cx.stop_propagation(); cx.notify(); })
      .child(card);
  }

  render() {
    const t0 = theme();
    if (this.launcher) {
      return h_flex().size_full().items_center().justify_center().text_size(12).text_color(t0.muted).child("Opening Meeting mode…");
    }
    // Brighter secondary text over a wallpaper, as the Call Sheet's default look.
    const t = { ...t0, dim: t0.muted, muted: t0.foreground };
    const session = this.sheet?.session;
    const zoom = Number(settings()?.zoom) || 1;
    const width = this.size ? this.size.width / zoom : 1200;
    const wide = width >= 920;

    const headerButton = (id, text, primary, onClick) => div().id(id).flex_none().px(10).py(3).rounded(6).cursor_pointer().border_1()
      .border_color(primary ? t.accent : t.border).bg(primary ? alpha(t.accent, 0.18) : "#00000000").text_color(primary ? t.accent : t.foreground)
      .hover(st => st.bg(t.hover)).child(text).on_click((_e, cx) => { onClick(cx); cx.notify(); });
    const status = this.submitting ? "Submitting…" : this.saving ? "Saving…" : this.loading ? "Loading…" : "";
    const clockText = this.mode === "pick" && !session ? "" : elapsed(session, new Date());
    const header = h_flex().flex_none().h(40).px(14).gap(10).items_center().border_b(1).border_color(t.border)
      .child(div().flex_none().w(8).h(8).rounded(4).bg(t.working).loop("opacity", { from: 0.35, to: 1, period: 1600 }))
      .child(div().flex_none().font_semibold().text_color(t.foreground).text_size(13).child(session ? session.name : "Meeting mode"))
      .when(Boolean(session?.project_name), el => el.child(div().min_w(0).truncate().text_color(t.dim).child(session.project_name)))
      .child(div().flex_1())
      .when(Boolean(status), el => el.child(div().flex_none().text_color(t.accent).child(status)))
      .when(Boolean(clockText), el => el.child(div().flex_none().font_semibold().text_size(14).text_color(t.foreground).child(clockText)))
      .child(div().id("pick-session").flex_none().px(6).cursor_pointer().text_color(t.muted).hover(st => st.text_color(t.foreground)).tooltip("Pick the session (s)")
        .child("⇄").on_click((_e, cx) => { this.mode = "pick"; this.loadSessions(cx); this.handle.focus(); cx.notify(); }))
      .when(Boolean(this.sheet), el => el.child(headerButton("done", "Done", true, () => this.askLeave())))
      .child(headerButton("leave", "Leave", false, () => this.askLeave()));

    const hint = this.mode === "pick" ? "j/k move · Enter open · r reload · q leave"
      : this.mode === "note" ? "Enter save note · Esc cancel"
      : this.mode === "confirm" ? "Enter submit and leave · g y r x rating · f feedback · s skip · Esc stay"
      : this.mode === "feedback" ? "⌘Enter submit and leave · Esc back to rating"
      : this.area === "notes" ? "Typing saves here · Tab next area · Esc to points · ⌘Enter leave"
      : this.area === "agenda" ? "j/k section · g/G top/end · Tab next area · i notes · q leave"
      : "click or d done · m missed · n n/a · c clear · e note · J/K group · Tab next area · i notes · s session · q leave";
    const footer = h_flex().flex_none().h(24).px(14).gap(8).items_center().text_size(11).text_color(t.dim)
      .child(div().flex_1().min_w(0).truncate().child(hint))
      .when(Boolean(this.notice) && !this.error, el => el.child(div().flex_none().text_color(t.dim).child(this.notice)));

    let body;
    if (this.mode === "pick" || !this.sessionId) body = this.renderPick(t);
    else if (wide) body = h_flex().id("areas").flex_1().min_h(0).p(10).gap(10)
      .child(div().flex_1().min_w(0).h_full().flex().child(this.renderAgenda(t)))
      .child(div().flex_1().min_w(0).h_full().flex().child(this.renderPoints(t)))
      .child(div().flex_grow(1.3).flex_shrink_1().flex_basis(0).min_w(0).h_full().flex().child(this.renderNotes(t)));
    else body = h_flex().id("areas").flex_1().min_h(0).p(8).gap(8)
      .child(v_flex().flex_1().min_w(0).h_full().gap(8).child(this.renderAgenda(t)).child(this.renderPoints(t)))
      .child(div().flex_1().min_w(0).h_full().flex().child(this.renderNotes(t)));

    return v_flex().id("pg-meeting").relative().track_focus(this.handle).size_full().min_h(0).bg(paneBacking(t0)).text_size(12)
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
      .on_key_down((e, cx) => { if (this.key(e, cx)) { cx.stop_propagation(); cx.notify(); } })
      .child(header)
      .when(Boolean(this.error), el => el.child(div().flex_none().px(14).py(6).text_color(t.blocked).child(this.error)))
      .child(body)
      .child(footer)
      .when(this.mode === "confirm" || this.mode === "feedback", el => el.child(this.renderConfirm(t, session)));
  }
}
