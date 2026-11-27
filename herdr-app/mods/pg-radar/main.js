// Playground prototype: Lock-in as an approach radar. The Ops "Sessions not locked in" list
// as three lanes by days out (Final within 3 days, Approach 4-7, Holding 8 and later). Each
// session is a plane placed by how many days away it is, so planes glide left as the days
// pass. A session that locks in lands: it slides off the left edge and a check shows.
//
// Click a plane to start a fix in the session launcher (the same prompt Lock-in uses).
// Right-click opens it in the Ops Scheduling Hub. With the keyboard (pane.go onto the band),
// letters pick planes as in Lock-in. Data comes from the kit's `lock-in` CLI.
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { checking, exec, focused, home, layout, nextCommand, openOverlay, run, settings, theme, window } from "herdr";
import { decode, fixTask, hintFor, hintIndex, laneOf, LANES, placeLane, shortName } from "./lib/model.js";

const POLL_MS = 5 * 60 * 1000;
const LAND_MS = 1600;         // how long a landed plane takes to leave
const LANDED_NOTE_MS = 8000;  // how long "locked in" stays on the Final lane
const LABEL_W = 108;          // lane label column, layout px
const PLANE_H = 22;
const cli = () => `${home()}/.local/bin/lock-in`;
const vault = () => `${home()}/Documents/internal/repos/devclarity-vault`;
const open = (url) => exec("open", [url]);

const alpha = (hex, a) => (/^#[0-9a-f]{6}$/i.test(hex ?? "") ? hex + Math.round(a * 255).toString(16).padStart(2, "0") : hex);

export default class Radar extends View {
  init(_props, cx) {
    this.report = null; this.error = null; this.loading = false; this.loadedAt = 0;
    this.skyW = 0;              // measured width of a lane's sky, layout px
    this.landing = [];          // [{ flag, x, lane, at, gone }]
    this.landedNote = null;     // { name, until }
    this.picking = false; this.returnPane = null;
    this.handle = cx.focus_handle();
    if (checking()) return;
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === "focus") { this.picking = true; this.returnPane = null; this.handle.focus(); }
        else if (command === "refresh") this.load(cx);
        cx.notify();
      }
    });
    this.load(cx);
    cx.timer.every(POLL_MS, cx => { if (window()?.visible !== false) this.load(cx); });
  }

  load(cx) {
    if (this.loading && Date.now() - this.loadStarted < 60000) return;
    this.loading = true; this.loadStarted = Date.now();
    cx.timer.after(0, cx => cx.notify());
    cx.spawn(async cx => {
      const r = await exec(cli(), ["flags"], { timeout: 45000 }).catch(e => ({ code: 1, stdout: "", stderr: String(e?.message ?? e) }));
      const { report, error } = decode(r.stdout, r.stderr, r.code);
      this.loading = false;
      this.apply(report, error, cx);
      cx.notify();
    });
  }

  apply(report, error, cx) {
    const before = this.flags();
    if (report) this.report = report;
    else if (this.report) this.report = { ...this.report, stale: true };
    this.error = error;
    if (!error) this.loadedAt = Date.now();
    if (!report || !before.length) return;
    // Anything that left the list since the last read has locked in (or been cancelled): land it.
    const still = new Set(this.flags().map(f => f.id));
    const gone = before.filter(f => !still.has(f.id));
    if (!gone.length) return;
    const now = Date.now();
    for (const flag of gone) {
      const lane = laneOf(flag.days);
      const spot = this.positions(lane, before).find(p => p.flag.id === flag.id);
      this.landing.push({ flag, lane, x: spot?.x ?? 0, at: now, gone: false });
    }
    this.landedNote = { name: shortName(gone[0].name) + (gone.length > 1 ? ` +${gone.length - 1}` : ""), until: now + LANDED_NOTE_MS };
    // Phase flag: draw at the old spot first, then let the transition carry it off the edge.
    cx.timer.after(40, cx => { for (const l of this.landing) l.gone = true; cx.notify(); });
    cx.timer.after(LAND_MS + 100, cx => { this.landing = this.landing.filter(l => Date.now() - l.at < LAND_MS); cx.notify(); });
    cx.timer.after(LANDED_NOTE_MS + 100, cx => cx.notify());
  }

  flags() { return this.report?.flags ?? []; }

  positions(lane, flags = this.flags()) {
    const inLane = flags.filter(f => laneOf(f.days) === lane);
    return placeLane(inLane, lane, Math.max(0, this.skyW - 8));
  }

  fix(flag) {
    if (!flag) return;
    this.release();
    openOverlay({ mod: "session-launcher", kind: "dialog", width: 560, height: 300, props: { task: fixTask(flag, vault()) } });
  }

  release() {
    const had = this.handle.is_focused();
    this.picking = false;
    if (had) {
      if (this.returnPane) run("pane.focus", { pane: this.returnPane });
      else run("pane.go", { direction: "down" });
    }
  }

  key(e, cx) {
    if (!this.picking) return;
    const flags = this.flags();
    if (e.keystroke === "escape") this.release();
    else if (e.keystroke === "r") this.load(cx);
    else if (!e.modifiers.platform && !e.modifiers.control && !e.modifiers.alt && hintIndex(e.key, flags.length) >= 0) {
      const flag = flags[hintIndex(e.key, flags.length)];
      if (e.modifiers.shift) open(flag.hub_url); else this.fix(flag);
    } else return;
    cx.stop_propagation();
    cx.notify();
  }

  render() {
    const t = theme();
    const tone = { final: t.ansi1 ?? t.blocked, approach: t.ansi3 ?? t.working, holding: t.ansi5 ?? t.accent, done: t.ansi2 ?? t.done };
    const active = this.picking && this.handle.is_focused();
    const flags = this.flags();
    const zoom = Number(settings()?.zoom) || 1;

    const box = v_flex().id("pg-radar").track_focus(this.handle).size_full().min_w(0).px(8).pt(8).pb(2)
      .on_key_down((e, cx) => this.key(e, cx));
    const frame = h_flex().flex_1().min_h(0).rounded(10).border(1).overflow_hidden()
      .border_color(active ? t.accent : t.border).bg(t.chrome).text_size(11.5);

    if (!this.report) {
      return box.child(frame.px(12).items_center().gap(8)
        .child(div().text_color(this.error ? t.blocked : t.dim).truncate().child(this.error ?? "Asking the tower for sessions not locked in…")));
    }

    const indexOf = new Map(flags.map((f, i) => [f.id, i]));
    const lane = (key) => {
      const spec = LANES[key], color = tone[key];
      const spots = this.positions(key);
      const count = flags.filter(f => laneOf(f.days) === key).length;
      const sky = div().id(`sky-${key}`).relative().flex_1().min_w(0).h_full().overflow_hidden()
        // The left edge is today: a faint runway line the planes approach.
        .child(div().absolute().left(0).top(4).bottom(4).w(2).rounded(1).bg(alpha(color, 0.5)))
        .children(spots.map(p => this.plane(p, color, t, active, indexOf.get(p.flag.id), key)))
        .children(this.landing.filter(l => l.lane === key).map(l => this.lander(l, color, t)))
        .when(key === "final" && this.landedNote && Date.now() < this.landedNote.until, el => el.child(
          h_flex().absolute().right(10).top(0).bottom(0).items_center().gap(5).text_color(tone.done).text_size(11)
            .child("✓").child(`${this.landedNote.name} locked in`)));
      if (key === "final") sky.on_size_change((size, cx) => {
        const w = Math.round(size.width / zoom);
        if (w !== this.skyW) { this.skyW = w; cx.notify(); }
      });
      return h_flex().flex_1().min_h(0).items_center().border_b(key === "holding" ? 0 : 1).border_color(alpha(t.border, 0.6))
        .child(v_flex().flex_none().w(LABEL_W).px(10).justify_center()
          .child(h_flex().gap(6).items_center()
            .child(div().font_semibold().text_color(color).child(spec.label))
            .child(div().text_color(t.dim).child(String(count))))
          .child(div().text_size(10).text_color(t.dim).child(spec.range)))
        .child(sky);
    };

    const checked = this.report.checked_label ? (this.report.stale ? `Offline · ${this.report.checked_label}` : this.report.checked_label) : "";
    const tail = v_flex().flex_none().w(84).h_full().justify_center().items_end().gap(3).px(10).border_l(1).border_color(t.border)
      .child(div().id("refresh").cursor_pointer().text_color(t.muted).hover(s => s.text_color(t.foreground))
        .child(this.loading ? svg("mods/workspace-chrome/spinner.svg").size(12).text_color(t.muted).spin(900) : "↻")
        .on_click((_e, cx) => this.load(cx)))
      .child(div().text_size(10).text_color(t.dim).whitespace_nowrap().child(checked))
      .child(div().text_size(10).text_color(active ? t.accent : t.dim).whitespace_nowrap().child(active ? "letter fixes" : "click fixes"));

    if (!flags.length && !this.landing.length) {
      return box.child(frame.px(12).items_center().gap(8)
        .child(div().text_color(tone.done).child("✓"))
        .child(div().flex_1().text_color(t.muted).child("Every session is locked in. The sky is clear.")));
    }
    return box.child(frame.child(v_flex().flex_1().min_w(0).h_full().child(lane("final")).child(lane("approach")).child(lane("holding"))).child(tail));
  }

  plane(p, color, t, active, index, lane) {
    const f = p.flag, urgent = lane === "final";
    const hint = active ? hintFor(index) : null;
    const tip = [f.name, `${f.when_label ?? ""} · ${f.relative_label ?? ""}`, f.short_reason || f.reason, "Click: fix · Right-click: open in Ops"].filter(Boolean).join("\n");
    if (p.more) {
      return div().id(`more-${p.more}`).absolute().left(p.x).top(0).bottom(0).flex().items_center().px(6).text_color(t.dim).child(`+${p.more}`);
    }
    return h_flex().id(`pl-${f.id}`).absolute().left(p.x).top(0).bottom(0).items_center().gap(5).px(4).rounded(6)
      .transition("left", { duration: 900, easing: "ease-out" })
      .cursor_pointer().hover(s => s.bg(t.hover)).tooltip(tip)
      .on_click((_e, cx) => { this.fix(f); cx.notify(); })
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); open(f.hub_url); })
      .when(Boolean(hint), el => el.child(div().flex_none().w(15).h(15).rounded(4).bg(t.accent).text_color(t.accent_foreground ?? t.background)
        .text_size(10).font_semibold().flex().items_center().justify_center().child(hint)))
      .child(div().flex_none().text_size(15).text_color(color)
        .when(urgent, el => el.loop("opacity", { from: 0.45, to: 1, period: 1100 + (f.id % 5) * 90 }))
        .child("✈"))
      .child(div().flex_none().whitespace_nowrap().text_color(t.foreground).child(shortName(f.name, lane)))
      .child(div().flex_none().whitespace_nowrap().text_color(color).child(`${f.days}d`));
  }

  lander(l, color, t) {
    return h_flex().id(`pl-${l.flag.id}`).absolute().left(l.gone ? -160 : l.x).top(0).bottom(0).items_center().gap(5).px(4)
      .opacity(l.gone ? 0 : 1)
      .transition("left", { duration: LAND_MS, easing: "ease-in" })
      .transition("opacity", { duration: LAND_MS, easing: "ease-in" })
      .child(div().text_size(15).text_color(color).child("✈"))
      .child(div().whitespace_nowrap().text_color(t.muted).child(shortName(l.flag.name, l.lane)));
  }
}
