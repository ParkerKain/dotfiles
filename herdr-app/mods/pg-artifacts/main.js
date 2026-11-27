// Playground prototype of the Artifacts panel as a card shelf (round 2 pick A, kept simple):
// one card per artifact with a type chip, newest first, letter hints unchanged. A card
// that arrives after the first read flashes once. Everything else is the kit's Artifacts mod.
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, home, theme, run, spaces, knownAgents, shared, focused, props, nextCommand, layout, settings } from "herdr";

// Matches the terminal panes' backing over a wallpaper. A terminal paints its
// background at terminal_opacity twice (surface, then cells), so it shows
// 1 - (1 - o)^2. Without terminal_opacity the layout's own color stands.
function paneBacking(t, fallback) {
  const o = Number(layout()?.terminal_opacity);
  if (!(o >= 0 && o < 1) || !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(t.background ?? "")) return fallback;
  return t.background.slice(0, 7) + Math.round((1 - (1 - o) ** 2) * 255).toString(16).padStart(2, "0");
}

const HINTS = "artifacts.hints";
const CARD_MIN = 150;
// Jump labels, easiest keys first; past single letters, two-letter labels behind reserved prefixes.
const KEYS = "asdfghjklqwertyuiopzxcvbnm";
function labels(n) {
  let p = 0;
  while (KEYS.length - p + p * KEYS.length < n && p < KEYS.length) p++;
  const out = KEYS.slice(0, KEYS.length - p).split("").slice(0, n);
  for (const prefix of KEYS.slice(KEYS.length - p)) for (const k of KEYS) if (out.length < n) out.push(prefix + k);
  return out;
}

// Lists Claude artifacts and Docs recorded by the `artifacts record` hook.
// ▶ starts a session that addresses the artifact's comments: a fork of the
// session that published it when that transcript still exists, else a fresh one.
const cli = () => `${home()}/.local/bin/artifacts`;

function decode(result) {
  let value;
  try { value = JSON.parse(result.stdout); } catch { throw new Error(result.stderr.trim() || result.stdout.trim() || `artifacts exited ${result.code}`); }
  if (!value.ok || result.code !== 0) throw new Error(value.error?.message || result.stderr.trim() || `artifacts exited ${result.code}`);
  return value.data;
}

function ago(stamp) {
  const t = Date.parse(String(stamp || "").replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  if (!t) return "";
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 60) return `${Math.max(m, 0)}m`;
  if (m < 48 * 60) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
}

export default class Artifacts extends View {
  init(_props, cx) {
    this.items = []; this.error = null; this.loading = false; this.note = null;
    // Keyboard row picking (my-tabs.hints, Cmd+J): a letter picks a row, then 1/2/3 act on it.
    this.handle = cx.focus_handle();
    cx.spawn(async cx => {
      for (;;) {
        if (await nextCommand() === "focus") this.handle.focus();
        cx.notify();
      }
    });
    this.hinting = false; this.typed = ""; this.picked = null; this.hintMap = [];
    // Opened by the hint key itself: a stamp from the last two seconds means start labelled.
    this.seenHints = shared(HINTS);
    if (this.seenHints && Date.now() - this.seenHints < 2000) cx.timer.after(0, cx => { this.startHints(); cx.notify(); });
    this.load(cx);
    cx.timer.every(60000, cx => this.load(cx));
  }

  load(cx) {
    if (this.loading) return;
    this.loading = true;
    // Show the spinner for at least 600ms; notify on the next tick since load can run from render.
    this.spinUntil = Date.now() + 600; cx.timer.after(0, cx => cx.notify());
    cx.spawn(async cx => {
      try {
        const items = decode(await exec(cli(), ["list", "--json"])).artifacts ?? [];
        // New since the last read: flash them once (not on the first read).
        if (this.known) for (const it of items) if (!this.known.has(it.url)) this.flashUrl(it.url, cx);
        this.known = new Set(items.map(it => it.url));
        this.items = items;
        this.error = null;
      } catch (e) { this.error = String(e?.message ?? e); }
      this.loading = false;
      cx.notify();
      cx.timer.after(Math.max(0, this.spinUntil - Date.now()), cx => cx.notify());
    });
  }

  flashUrl(url, cx) {
    this.flash = { ...(this.flash ?? {}), [url]: true };
    cx.timer.after(60, cx => { this.flash[url] = false; cx.notify(); });
  }

  start(item, cx) {
    cx.spawn(async cx => {
      try {
        const data = decode(await exec(cli(), ["prompt", "--url", item.url, "--json"]));
        const agents = await knownAgents();
        const claude = agents.find(a => a.installed && (a.key?.toLowerCase() === "claude" || a.name?.toLowerCase().includes("claude")));
        if (!claude) throw new Error("Claude is not installed in Herdr.");
        const argv = data.session_id
          ? [...claude.run, "--resume", data.session_id, "--fork-session", "-n", data.slug]
          : [...claude.run, "-n", data.slug];
        const name = `Comments: ${data.title || "artifact"}`.slice(0, 60);
        const space = spaces().find(s => !s.machine && s.folder === data.folder);
        if (space) run("tab.new", { name, space: space.id, folder: data.folder, argv, task: data.prompt });
        else run("space.new", { name: data.folder.split("/").pop(), folder: data.folder, tab: name, argv, task: data.prompt, machine: "" });
        this.note = data.session_id ? `Forked the session that built "${data.title}"` : `Started a fresh session for "${data.title}"`;
        this.error = null;
      } catch (e) { this.error = String(e?.message ?? e); }
      cx.notify();
    });
  }

  // Listing artifacts needs the Artifact tool, which only an interactive Claude session has.
  sync(cx) {
    cx.spawn(async cx => {
      try {
        const data = decode(await exec(cli(), ["sync-prompt", "--json"]));
        const agents = await knownAgents();
        const claude = agents.find(a => a.installed && (a.key?.toLowerCase() === "claude" || a.name?.toLowerCase().includes("claude")));
        if (!claude) throw new Error("Claude is not installed in Herdr.");
        const argv = [...claude.run, "-n", "artifacts-sync"];
        const space = spaces().find(s => !s.machine && s.folder === data.folder);
        if (space) run("tab.new", { name: "Artifacts sync", space: space.id, folder: data.folder, argv, task: data.prompt });
        else run("space.new", { name: data.folder.split("/").pop(), folder: data.folder, tab: "Artifacts sync", argv, task: data.prompt, machine: "" });
        this.note = "Sync started in a new tab; press ↻ when it finishes";
        this.error = null;
      } catch (e) { this.error = String(e?.message ?? e); }
      cx.notify();
    });
  }

  open(item) { exec("open", [item.url]); }

  hide(item, cx) {
    cx.spawn(async cx => {
      try { decode(await exec(cli(), ["hide", "--url", item.url])); this.load(cx); }
      catch (e) { this.error = String(e?.message ?? e); cx.notify(); }
    });
  }

  // The picked row's number keys: [key, label, action].
  actions(item) {
    return [["1", "comments session", cx => this.start(item, cx)], ["2", "open", () => this.open(item)], ["3", "hide", cx => this.hide(item, cx)]];
  }

  startHints() {
    if (this.hinting) { this.endHints(); return; }
    this.returnPane = focused()?.pane ?? null;
    this.hinting = true; this.typed = ""; this.picked = null;
    this.handle.focus();
  }

  endHints(restore = true) {
    this.hinting = false; this.typed = ""; this.picked = null;
    if (restore && this.returnPane) run("pane.focus", { pane: this.returnPane });
  }

  hintKey(key, cx) {
    if (key === "escape") { this.endHints(); return; }
    if (this.picked) {
      const action = this.actions(this.picked).find(([k]) => k === key);
      if (action) { this.endHints(); action[2](cx); }
      return;
    }
    if (key === "backspace") { this.typed = this.typed.slice(0, -1); return; }
    if (!/^[a-z]$/.test(key)) return;
    const typed = this.typed + key, matches = this.hintMap.filter(([label]) => label.startsWith(typed));
    if (!matches.length) return;
    const exact = matches.find(([label]) => label === typed);
    if (exact) { this.picked = exact[1]; this.typed = ""; } else this.typed = typed;
  }

  render(cx) {
    // my-tabs bumps this when the refresh key is pressed with Artifacts showing.
    const latest = shared("artifacts.refresh");
    if (latest !== this.seenRefresh) { this.seenRefresh = latest; this.load(cx); }
    const hints = shared(HINTS);
    if (hints !== this.seenHints) { this.seenHints = hints; cx.timer.after(0, cx => { this.startHints(); cx.notify(); }); }
    if (this.hinting) {
      if (this.handle.is_focused()) this.hadFocus = true;
      else if (this.hadFocus) this.endHints(false);
    } else this.hadFocus = false;
    const t = theme();
    // Keep the picked row across reloads by matching its URL.
    if (this.picked) this.picked = this.items.find(i => i.url === this.picked.url) ?? null;
    const names = labels(this.items.length);
    this.hintMap = this.items.map((item, i) => [names[i], item]);
    const badge = (i) => {
      const live = names[i].startsWith(this.typed);
      return div().flex_none().px(4).rounded(3).font_semibold().bg(live ? t.accent : t.border).text_color(live ? t.background : t.dim).child(names[i]);
    };
    const legend = this.picked ? this.actions(this.picked).map(([k, label]) => `${k} ${label}`).join(" · ") + " · Esc" : `Pick an artifact${this.typed ? ` · ${this.typed}` : ""} · Esc`;
    return v_flex().id("artifacts").track_focus(this.handle).size_full().min_h(0).bg(paneBacking(t, props()?.glass ? t.chrome : t.background)).text_size(12)
      .on_key_down((e, cx) => { if (!this.hinting) return; this.hintKey(e.key, cx); cx.stop_propagation(); cx.notify(); })
      .child(h_flex().h(40).px(12).items_center().border_b(1).border_color(t.border)
        .child(div().flex_1().min_w(0).truncate().font_semibold().text_color(t.foreground).child(this.hinting ? legend : `Artifacts · ${this.items.length}`))
        .child(h_flex().gap(12)
          .child(div().id("sync").cursor_pointer().text_color(t.muted).child("Sync").on_click((_e, cx) => this.sync(cx)))
          .child(div().id("refresh").cursor_pointer().text_color(t.muted).child(this.loading || Date.now() < (this.spinUntil ?? 0) ? svg("mods/workspace-chrome/spinner.svg").size(13).text_color(t.muted).spin(900) : "↻").on_click((_e, cx) => this.load(cx)))))
      .when(this.error, el => el.child(div().p(10).text_color(t.blocked).child(this.error)))
      .when(this.note && !this.error, el => el.child(div().px(12).py(6).text_color(t.dim).child(this.note)))
      .when(!this.items.length && !this.error, el => el.child(div().p(12).text_color(t.dim).child("Nothing yet. Artifacts and Docs you publish from Claude Code show up here.")))
      .child(div().id("shelf").flex_1().min_h(0).overflow_y_scrollbar().p(8)
        .on_size_change((size, cx) => { const w = Math.round(size.width / (Number(settings()?.zoom) || 1)); if (w !== this.width) { this.width = w; cx.notify(); } })
        .child(h_flex().flex_wrap().gap(6).children(this.items.map((item, i) => this.card(item, i, t, badge)))));
  }

  card(item, i, t, badge) {
    const cols = Math.max(1, Math.floor(((this.width ?? 300) - 16 + 6) / (CARD_MIN + 6)));
    const w = Math.floor(((this.width ?? 300) - 16 - 6 * (cols - 1)) / cols);
    const doc = item.kind === "doc";
    const chip = doc ? (t.working ?? t.ansi3) : (t.ansi6 ?? t.accent);
    const ink = settings()?.dark ? t.background : t.foreground;
    return v_flex().id(`artifact-${i}`).relative().w(w).h(84).p(8).gap(4).rounded(8).overflow_hidden()
      .bg(t.hover).border_1().border_color(this.picked === item ? t.accent : t.border)
      .cursor_pointer().hover(s => s.border_color(t.accent)).on_click(() => this.open(item))
      .tooltip(`${item.title || item.url}\n${(item.folder || "").split("/").pop()} · ${ago(item.updated)}\nClick opens · ▶ comments session · ✕ hide`)
      .child(div().id(`flash-${i}`).absolute().inset_0().bg(t.accent).opacity(this.flash?.[item.url] ? 0.4 : 0)
        .transition("opacity", { duration: 1200, easing: "ease-out" }))
      .child(h_flex().gap(6).items_center()
        .when(this.hinting && !this.picked, el => el.child(badge(i)))
        .child(div().flex_none().px(4).rounded(3).bg(chip).text_color(ink).text_size(9).font_semibold().child(doc ? "DOC" : "PAGE"))
        .child(div().flex_1())
        .child(div().text_size(10).text_color(t.dim).child(ago(item.updated))))
      .child(div().flex_1().min_h(0).overflow_hidden().text_color(t.foreground).text_size(11.5).font_semibold().child(item.title || item.url))
      .child(h_flex().gap(10).items_center().text_size(10.5)
        .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child((item.folder || "").split("/").pop()))
        .child(div().id(`go-${i}`).cursor_pointer().text_color(t.accent).child("▶").on_click((_e, cx) => { cx.stop_propagation(); this.start(item, cx); }))
        .child(div().id(`hide-${i}`).cursor_pointer().text_color(t.dim).child("✕").on_click((_e, cx) => { cx.stop_propagation(); this.hide(item, cx); })));
  }
}
