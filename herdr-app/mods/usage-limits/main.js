// Usage limits: every Claude Code / Codex limit window in the status bar, and one
// panel on hover: the details, and behind ⚙ the checkboxes to choose what shows.
//
// Data comes from small helpers that run the CLIs themselves (helpers/*.sh)
// and a log scan for token totals (helpers/tokens.py);
// this mod never reads an auth token. Everything below main.js is pure and tested.
import { View, div, image, svg } from "gpui-kit";
import { HoverCard, h_flex, v_flex } from "gpui-base";
import { checking, exec, focused, home, spaces, theme, props, readTextFile, run, shared, setShared, appHome, window } from "herdr";
import { PROVIDERS, TOKEN_PROVIDERS } from "./providers/index.js";
import { barModel, cardModel, chooseDensity, panelOnEnter } from "./lib/view.js";
import { effectivePrefs, isOnBar, isShown, toggleOnBar, toggleProvider, toggleShowBars, toggleShowResetTime, toggleWindow } from "./lib/prefs.js";
import { parseSession, sessionOnBar, sessionView } from "./lib/session.js";
import { nextState } from "./lib/state.js";
import { PERIODS, parseTokens, summarize, exact, money, shortDate } from "./lib/tokens.js";
import { tokens as compact } from "./lib/format.js";
import { teamChip } from "./lib/team.js";

const MOD = "usage-limits";
const KEY_STATE = "usage-limits.state";
const KEY_PREFS = "usage-limits.prefs";
const KEY_REFRESH = "usage-limits.refresh";
const KEY_TOKENS = "usage-limits.tokens";
// The team's Claude usage from Ops: the kit's `claude-usage` CLI (work Mac only) writes the chip
// here, and so does the Claude usage panel each time it loads. Machines without the CLI show none.
const KEY_TEAM = "claude-usage.chip";
const TEAM_EVERY = 5 * 60;           // s
const TOKENS_EVERY = 10 * 60;     // s, the log scan takes a few seconds
const TOKEN_DAYS = "all";
const FETCH_EVERY = 5 * 60;       // s, installed providers
const MISSING_EVERY = 60 * 60;    // s, not-installed providers
const REFRESH_COOLDOWN = 30;      // s
const SESSION_EVERY = 10 * 1000;   // ms, at most this often on hover
const AGENTS = { "claude-code": "claude", codex: "codex" }; // Herdr's app name → session.sh
const BAR_W = 30;
const PANEL_W = 340;
const PANEL_BAR_W = 110;
const SESSION_BAR_W = 60;
const LEFT_W = 48;                   // the time-left column in the panel
const PANEL_OPEN_DELAY = 350;       // ms, so passing over the bar doesn't flash it
const PANEL_CLOSE_DELAY = 300;      // ms, lets the pointer cross from the bar to the card

const now = () => Math.floor(Date.now() / 1000);
// The earliest day any tool has logs for: where "All time" starts.
const since = (usage) => usage.map((u) => u.s.firstDay).filter(Boolean).sort()[0] ?? null;
const states = () => shared(KEY_STATE) ?? {};

function levelColor(level, t) {
  if (level === "hot") return t.ansi1 ?? t.blocked;
  if (level === "warn") return t.ansi3 ?? t.done;
  return t.ansi2 ?? t.working;
}

const textColor = (level, text, t) => (level === "ok" ? (text === "—" ? t.dim : t.foreground) : levelColor(level, t));

// A limit's number always wears its level, green included; session numbers don't.
const limitColor = (level, text, t) => (text === "—" ? t.dim : levelColor(level, t));

function usageBar(width, fill, tick, color, t) {
  return div().relative().w(width).h(4).rounded(2).bg(t.border).flex_none()
    .child(div().absolute().left(0).top(0).h(4).rounded(2).w(Math.round(width * fill)).bg(color))
    .when(tick != null, (b) => b.child(div().absolute().top(-2).left(Math.round(width * tick)).w(1).h(8).bg(t.foreground).opacity(0.75)));
}

export default class UsageLimits extends View {
  init(_props, cx) {
    this.width = 0;
    this.panel = "limits"; // or "settings"
    this.leftAt = null;    // ms, when the pointer left the bar and the panel
    this.terminal = null;  // the focused terminal the session below belongs to
    this.session = null;   // { data: Session, title } or null
    this.sessionAt = 0;    // ms, last session read
    this.sessionBusy = false;
    this.lastFetch = {};   // providerId → epoch s of last attempt
    this.busy = {};        // providerId → fetch in flight
    this.seenRefresh = shared(KEY_REFRESH) ?? 0;
    this.tokensBusy = false;
    this.tokensAt = 0;     // epoch s of the last scan started
    this.period = "today";
    this.teamAt = 0;       // epoch s of the last team fetch
    this.teamBusy = false;
    this.teamCli = null;   // null until checked, then true or false
    this.teamCliAt = 0;    // epoch s of the last check, so a CLI linked later is found
    this.tick(cx, true);
    cx.timer.every(60 * 1000, (cx) => this.tick(cx, false));
  }

  // Fetch whatever is due, then redraw (countdowns and pace move every minute).
  tick(cx, force) {
    if (checking()) return;
    const st = states();
    for (const p of PROVIDERS) {
      const s = st[p.id];
      const every = s?.installed === false ? MISSING_EVERY
        : s?.report?.rateLimited ? (p.backoffEvery ?? p.every ?? FETCH_EVERY)
        : (p.every ?? FETCH_EVERY);
      if (force || now() - (this.lastFetch[p.id] ?? 0) >= every) this.fetch(p, cx);
    }
    if (force || now() - this.tokensAt >= TOKENS_EVERY) this.fetchTokens(cx);
    if (force || (now() - this.teamAt >= TEAM_EVERY && window()?.visible !== false)) this.fetchTeam(cx);
    this.readSession(cx);
    cx.notify();
  }

  // Tokens per day and model from both tools' session logs (helpers/tokens.py).
  fetchTokens(cx) {
    if (this.tokensBusy) return;
    this.tokensBusy = true;
    this.tokensAt = now();
    cx.spawn(async (cx) => {
      try {
        const r = await exec("python3", ["-I", `${appHome()}/mods/${MOD}/helpers/tokens.py`, String(TOKEN_DAYS)]);
        const data = r.code === 0 ? parseTokens(r.stdout) : null;
        if (data) setShared(KEY_TOKENS, { ...data, observedAt: now() });
      } catch {
        // keep the last scan
      } finally {
        this.tokensBusy = false;
      }
      cx.notify();
    });
  }

  // The team chip, from the kit's claude-usage CLI when this machine has it.
  fetchTeam(cx) {
    if (this.teamBusy) return;
    // No CLI here (Omarchy, or before link.sh ran): look again every half hour.
    if (this.teamCli === false && now() - this.teamCliAt < 30 * 60) return;
    // The panel may have just loaded; its stamp counts as a fetch.
    const chip = shared(KEY_TEAM);
    if (chip?.at && Date.now() - chip.at < TEAM_EVERY * 1000 / 2) { this.teamAt = now(); return; }
    this.teamBusy = true;
    this.teamAt = now();
    const cli = `${home()}/.local/bin/claude-usage`;
    cx.spawn(async (cx) => {
      try {
        if (!this.teamCli) {
          this.teamCliAt = now();
          this.teamCli = (await exec("test", ["-x", cli]).catch(() => null))?.code === 0;
        }
        if (!this.teamCli) return;
        const r = await exec(cli, ["report"], { timeout: 45000 });
        const out = JSON.parse(r.stdout);
        const report = out.data;
        if (report?.chip) setShared(KEY_TEAM, { ...report.chip, stale: Boolean(report.stale), at: Date.now() });
      } catch {
        // keep the last chip; it dims once it's old
      } finally {
        this.teamBusy = false;
      }
      cx.notify();
    });
  }

  async readLimits(p) {
    const modPath = `${appHome()}/mods/${MOD}`;
    if (!p.remote) return exec("sh", [`${modPath}/${p.helper}`]);
    const machine = (await readTextFile(`${appHome()}/data/${MOD}/personal-machine`))?.trim();
    if (!machine) return { code: 127 };
    const [remote, limits] = await Promise.all([
      readTextFile(`${modPath}/${p.helper}`),
      readTextFile(`${modPath}/helpers/codex-limits.sh`),
    ]);
    if (!remote || !limits) throw new Error("Missing Codex quota helper");
    return exec("sh", ["-c", remote, "codex-personal", limits], { on: machine, timeout: 27000 });
  }

  fetch(p, cx) {
    if (this.busy[p.id]) return;
    this.busy[p.id] = true;
    this.lastFetch[p.id] = now();
    cx.spawn(async (cx) => {
      let next;
      const prev = states()[p.id] ?? { report: null, lastGood: null, installed: null };
      try {
        const r = await this.readLimits(p);
        next = r.code === 127 ? nextState(prev, null, false) : nextState(prev, p.parse(r.stdout, now()), true);
      } catch (e) {
        const report = p.remote ? p.parse("", now())
          : { status: "error", message: String(e?.message ?? e), plan: null, observedAt: now(), source: p.helper, windows: [] };
        next = nextState(prev, report, true);
      }
      this.busy[p.id] = false;
      setShared(KEY_STATE, { ...states(), [p.id]: next });
      cx.notify();
    });
  }

  // Terminal → its agent's process → that process's session. Any step failing means
  // no block at all: another session's numbers would be worse than none.
  readSession(cx) {
    if (this.sessionBusy) return; // a hung hc mustn't pile up; it re-reads below if focus moved
    const terminal = this.terminal;
    this.sessionAt = Date.now();
    if (!terminal) {
      this.session = null;
      return;
    }
    this.sessionBusy = true;
    cx.spawn(async (cx) => {
      let next = null;
      try {
        const info = JSON.parse((await exec("hc", ["get", terminal])).stdout);
        const app = AGENTS[info.status?.app];
        const pid = info.foreground?.pid;
        if (app && pid) {
          const r = await exec("sh", [`${appHome()}/mods/${MOD}/helpers/session.sh`, app, String(pid)]);
          const data = r.code === 0 ? parseSession(r.stdout, app) : null;
          if (data) next = { data, title: (info.cwd ?? "").split("/").pop() };
        }
      } catch {
        next = null;
      } finally {
        this.sessionBusy = false;
      }
      if (terminal !== this.terminal) {
        this.readSession(cx); // focus moved on while this was reading
        return;
      }
      this.session = next;
      cx.notify();
    });
  }

  cooling() {
    return now() - Math.floor((shared(KEY_REFRESH) ?? 0) / 1000) < REFRESH_COOLDOWN;
  }

  refresh(cx) {
    if (!this.cooling()) setShared(KEY_REFRESH, Date.now());
    cx.notify();
  }

  // Herdr's props come from props(), not init's first argument (shipped mods ignore it too).
  prefs() {
    return effectivePrefs(shared(KEY_PREFS), props());
  }

  hover(on, cx) {
    if (!on) {
      this.leftAt = Date.now();
      return;
    }
    this.panel = panelOnEnter(this.panel, this.leftAt, Date.now(), PANEL_CLOSE_DELAY);
    this.leftAt = null;
    if (Date.now() - this.sessionAt >= SESSION_EVERY) this.readSession(cx);
    cx.notify();
  }

  show(panel, cx) {
    this.panel = panel;
    cx.notify();
  }

  // ---------- status bar ----------

  segment(s, density, t) {
    const color = levelColor(s.level, t);
    return h_flex().gap(5).items_center().flex_none()
      .when(density < 2, (e) => e.child(div().text_size(10.5).text_color(t.dim).child(s.short)))
      .when(density === 0, (e) => e.child(usageBar(BAR_W, s.fill, s.tick, color, t)))
      .child(div().whitespace_nowrap().text_color(limitColor(s.level, s.text, t)).child(density === 3 ? s.brief : s.text));
  }

  // Where this space runs, on the left: the part of Herdr's workspace-status this bar replaces.
  location(t) {
    const space = spaces().find((s) => s.active);
    const label = (icon, text) => h_flex().gap(6).items_center().flex_none().whitespace_nowrap()
      .child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    const parts = [label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer")];
    if (space?.branch) parts.push(label("branch", space.branch));
    const width = parts.length * 20 + 16 + 7 * ((space?.machine ?? "This computer").length + (space?.branch?.length ?? 0));
    return { el: h_flex().gap(16).items_center().flex_none().children(parts), width };
  }

  renderBar(cx) {
    const t = theme();
    const where = this.location(t);
    const st = states();
    const prefs = this.prefs();
    const model = barModel(st, prefs, now());
    const numbers = sessionOnBar(this.session?.data, prefs);
    const numbersWidth = numbers.reduce((w, n) => w + 7 * n.text.length + 14, numbers.length ? 14 : 0);
    const team = this.teamEl(t);
    const density = chooseDensity(model, this.width ? this.width - 28 - where.width - numbersWidth - team.width : Infinity, prefs.showBars);
    const root = h_flex().id("root").size_full().px(14).gap(16).items_center().overflow_hidden()
      .bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .on_size_change((size, cx) => { this.width = size.width; cx.notify(); });
    // Only the limits themselves open the panel, not the empty rest of the block.
    const content = h_flex().id("ul-content").gap(14).items_center().flex_none().on_hover((on, cx) => this.hover(on, cx));
    if (numbers.length) {
      content.child(h_flex().gap(10).items_center().flex_none()
        .children(numbers.map((n) => div().whitespace_nowrap().text_color(textColor(n.level, n.text, t)).child(n.text))));
      if (!model.empty) content.child(div().w(1).h(14).bg(t.border).flex_none());
    }
    if (model.empty) content.child(div().id("ul-empty").child(svg(`mods/${MOD}/icons/gauge.svg`).size(14)));
    model.groups.forEach((g, i) => {
      if (i > 0) content.child(div().w(1).h(14).bg(t.border).flex_none());
      content.child(
        h_flex().id(`ul-${g.providerId}`).gap(density === 0 ? 10 : 8).items_center().flex_none()
          .opacity(g.dim ? 0.55 : 1)
          .child(image(g.icon).size(13))
          .when(g.accountLabel != null, (e) => e.child(div().text_size(10.5).text_color(t.dim).child(g.accountLabel)))
          .when(g.mark != null, (e) => e.child(div().text_color(t.dim).child(g.mark)))
          .children(g.segments.map((s) => this.segment(s, density, t))));
    });
    const panel = cardModel(st, now());
    // With no CLI installed there are no limits to show, so settings are all there is.
    const body = this.panel === "settings" || panel.empty ? this.settings(!panel.empty, t)
      : this.panel === "tokens" ? this.tokensPanel(t)
      : this.limits(panel, t);
    return root.child(where.el).child(div().flex_1()).when(team.el != null, (e) => e.child(team.el)).child(HoverCard.new("ul-panel").anchor("bottom_right").open_delay(PANEL_OPEN_DELAY).close_delay(PANEL_CLOSE_DELAY)
      .trigger(content)
      .content(body));
  }

  // The team's Claude usage from Ops: "Team 38% · You 22%". Clicking opens the Claude usage
  // panel and refreshes it. Neutral colors on purpose: the ops page's red means under-using,
  // while this bar's red means near a limit.
  teamEl(t) {
    const team = teamChip(shared(KEY_TEAM), Date.now());
    if (!team) return { el: null, width: 0 };
    const el = h_flex().id("ul-team").gap(6).items_center().flex_none().whitespace_nowrap().cursor_pointer()
      .opacity(team.old ? 0.55 : 1).tooltip(team.hint)
      .hover((s) => s.text_color(t.foreground))
      .on_click(() => { run("my-tabs.open-claude-usage"); setShared("claude-usage.refresh", Date.now()); })
      .child(svg("mods/claude-usage/gauge.svg").size(13))
      .child(team.text);
    return { el, width: team.width };
  }

  // ---------- panel: limits ----------

  cardRow(r, providerId, t) {
    return v_flex().gap(3)
      .child(h_flex().id(`ul-row-${providerId}-${r.id}`).gap(8).items_center()
        .when(r.hint != null, (e) => e.tooltip(r.hint))
        .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(r.long))
        .child(usageBar(PANEL_BAR_W, r.fill, r.tick, levelColor(r.level, t), t))
        .child(div().w(36).flex_none().flex().justify_end().whitespace_nowrap().text_color(limitColor(r.level, r.percent, t)).child(r.percent))
        .child(div().w(LEFT_W).flex_none().flex().justify_end().whitespace_nowrap().text_size(11).text_color(t.dim).child(r.left)))
      .when(r.detail !== "", (e) => e.child(div().text_size(11).text_color(t.dim).truncate().child(r.detail)));
  }

  cardGroup(g, t) {
    return v_flex().gap(8)
      .child(h_flex().gap(6).items_center()
        .child(image(g.icon).size(13))
        .child(div().flex_none().font_semibold().child(g.name))
        .when(g.plan != null, (e) => e.child(div().flex_none().px(5).rounded(4).bg(t.raised).text_size(10).text_color(t.accent).child(g.plan)))
        .child(div().flex_1())
        .child(div().min_w(0).truncate().text_size(11).text_color(g.failed ? levelColor("hot", t) : t.dim).child(g.status)))
      .when(g.age != null, (e) => e.child(div().text_size(11).text_color(t.dim).child(g.age)))
      .child(v_flex().gap(6).opacity(g.dim ? 0.55 : 1).children(g.rows.map((r) => this.cardRow(r, g.providerId, t))));
  }

  sessionBlock(v, t) {
    const stats = [v.context.detail, v.calls, v.compactions, v.last].filter(Boolean).join(" · ");
    return v_flex().gap(4)
      .child(h_flex().gap(6).items_center()
        .child(div().flex_none().font_semibold().child("This session"))
        .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(v.title))
        .when(v.context.fill != null, (r) => r.child(usageBar(SESSION_BAR_W, v.context.fill, null, levelColor(v.context.level, t), t)))
        .child(div().flex_none().whitespace_nowrap().text_color(textColor(v.context.level, v.context.text, t)).child(`ctx ${v.context.text}`)))
      .child(div().text_size(11).text_color(t.dim).child(stats));
  }

  iconButton(id, icon, label, enabled, onClick, t) {
    return div().id(id).size(24).rounded(5).flex().items_center().justify_center().tooltip(label)
      .when(enabled, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => onClick(cx)))
      .child(svg(`mods/${MOD}/icons/${icon}.svg`).size(14).text_color(enabled ? t.muted : t.dim));
  }

  shell(t) {
    return v_flex().id("ul-panel-body").w(PANEL_W).p(12).gap(10).rounded(8).border(1).border_color(t.border).bg(t.popover).shadow_lg()
      .text_size(12).text_color(t.foreground)
      .on_hover((on, cx) => this.hover(on, cx));
  }

  limits(model, t) {
    const rule = () => div().h(1).bg(t.border).flex_none();
    const body = this.shell(t);
    const session = sessionView(this.session?.data, this.session?.title);
    if (session) body.child(this.sessionBlock(session, t)).child(rule());
    model.groups.forEach((g, i) => {
      if (i > 0) body.child(rule());
      body.child(this.cardGroup(g, t));
    });
    const usage = this.tokenSummaries();
    if (usage) body.child(rule()).child(this.tokensBlock(usage, t));
    const cooling = this.cooling();
    return body.child(rule())
      .child(h_flex().gap(2).justify_end().items_center()
        .child(this.iconButton("ul-refresh", "refresh", cooling ? "Refreshing…" : "Refresh now", !cooling, (cx) => this.refresh(cx), t))
        .child(this.iconButton("ul-settings", "gear", "Settings", true, (cx) => this.show("settings", cx), t)));
  }

  // ---------- tokens ----------

  tokenSummaries() {
    const data = shared(KEY_TOKENS);
    if (!data) return null;
    const days = PERIODS.find((p) => p.id === this.period)?.days ?? 1;
    return TOKEN_PROVIDERS.map((p) => ({ provider: p, s: summarize(data, p.id, days, new Date()) }));
  }

  periodTabs(t) {
    return h_flex().gap(2).items_center().children(PERIODS.map((p) => {
      const on = p.id === this.period;
      return div().id(`ul-period-${p.id}`).px(6).py(1).rounded(4).text_size(11).cursor_pointer()
        .when(on, (e) => e.bg(t.raised).text_color(t.foreground))
        .when(!on, (e) => e.text_color(t.dim).hover((s) => s.bg(t.hover)))
        .on_click((_e, cx) => { this.period = p.id; cx.notify(); })
        .child(p.label);
    }));
  }

  costText(s) {
    if (s.total === 0) return "$0.00";
    return s.unpriced.length && s.cost === 0 ? "unpriced" : `≈ ${money(s.cost)}`;
  }

  // The summary in the limits panel: one row per tool, and the combined cost.
  tokensBlock(usage, t) {
    const sum = usage.reduce((c, u) => c + u.s.cost, 0);
    const block = v_flex().gap(6)
      .child(h_flex().gap(6).items_center()
        .child(div().flex_none().font_semibold().child("Tokens"))
        .child(div().flex_1())
        .child(this.periodTabs(t)));
    for (const { provider: p, s } of usage) {
      block.child(h_flex().id(`ul-tok-${p.id}`).gap(8).items_center().cursor_pointer().rounded(4)
        .hover((e) => e.bg(t.hover))
        .tooltip(`${exact(s.total)} tokens in ${exact(s.calls)} calls. Click for the breakdown.`)
        .on_click((_e, cx) => this.show("tokens", cx))
        .child(image(p.icon).size(13))
        .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(p.name))
        .child(div().flex_none().whitespace_nowrap().child(compact(s.total)))
        .child(div().w(80).flex_none().flex().justify_end().whitespace_nowrap().text_color(t.dim).child(this.costText(s))));
    }
    return block.child(h_flex().gap(8).items_center()
      .child(div().flex_1().text_size(11).text_color(t.dim).child(this.period === "all" && since(usage)
        ? `Since ${shortDate(since(usage))}, at API list prices` : "Estimated at API list prices"))
      .child(div().flex_none().whitespace_nowrap().font_semibold().child(`≈ ${money(sum)}`)));
  }

  numberRow(id, label, n, cost, t, strong = false) {
    return h_flex().id(id).gap(8).items_center()
      .child(div().flex_1().min_w(0).truncate().text_color(strong ? t.foreground : t.muted).child(label))
      .child(div().flex_none().whitespace_nowrap().when(strong, (e) => e.font_semibold()).child(exact(n)))
      .child(div().w(76).flex_none().flex().justify_end().whitespace_nowrap().text_color(t.dim).child(cost));
  }

  tokensPanel(t) {
    const usage = this.tokenSummaries() ?? [];
    const rule = () => div().h(1).bg(t.border).flex_none();
    const body = this.shell(t)
      .child(h_flex().gap(6).items_center().h(24)
        .child(this.iconButton("ul-back-tokens", "back", "Back to limits", true, (cx) => this.show("limits", cx), t))
        .child(div().font_semibold().child("Tokens"))
        .child(div().flex_1())
        .child(this.periodTabs(t)));
    for (const { provider: p, s } of usage) {
      body.child(rule());
      const group = v_flex().gap(3)
        .child(h_flex().gap(6).items_center().pb(2)
          .child(image(p.icon).size(13))
          .child(div().flex_1().font_semibold().child(p.name))
          .child(div().flex_none().whitespace_nowrap().text_color(t.dim).text_size(11).child(this.period === "all" && s.firstDay ? `since ${shortDate(s.firstDay)} · ${exact(s.calls)} calls` : `${exact(s.calls)} calls`)));
      for (const c of s.categories) {
        group.child(this.numberRow(`ul-tc-${p.id}-${c.id}`, c.label, c.tokens, s.unpriced.length && c.cost === 0 && c.tokens ? "" : money(c.cost), t));
      }
      group.child(this.numberRow(`ul-tt-${p.id}`, "Total", s.total, this.costText(s), t, true));
      if (s.models.length > 1 || s.unpriced.length) {
        group.child(v_flex().gap(1).pt(4).children(s.models.filter((m) => m.tokens > 0).map((m) =>
          h_flex().gap(8).text_size(11).text_color(t.dim)
            .child(div().flex_1().min_w(0).truncate().child(m.label))
            .child(div().flex_none().whitespace_nowrap().child(compact(m.tokens)))
            .child(div().w(76).flex_none().flex().justify_end().whitespace_nowrap().child(m.priced ? money(m.cost) : "unpriced")))));
      }
      body.child(group);
    }
    const data = shared(KEY_TOKENS);
    const note = data ? `From session logs, scanned ${new Date(data.observedAt * 1000).toTimeString().slice(0, 5)}. Cost is an estimate at API list prices.` : "Reading session logs…";
    return body.child(rule()).child(div().text_size(10.5).text_color(t.dim).child(note));
  }

  // ---------- panel: settings ----------

  check(id, on, label, onToggle, t, indent = 0, extra = null) {
    return h_flex().id(id).gap(8).items_center().pl(indent).py(3).rounded(4).cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { onToggle(); cx.notify(); })
      .child(div().size(13).rounded(3).border(1).border_color(on ? t.accent : t.input).bg(on ? t.accent : t.popover)
        .flex().items_center().justify_center().text_size(9).text_color(t.accent_foreground).child(on ? "✓" : ""))
      .children(label)
      .when(extra != null, (e) => e.child(div().text_color(t.dim).truncate().child(extra)));
  }

  settings(canGoBack, t) {
    const prefs = this.prefs();
    const st = states();
    const save = (p) => setShared(KEY_PREFS, p);
    const rows = [];
    for (const p of PROVIDERS.filter((p) => !p.panelOnly)) {
      const s = st[p.id] ?? {};
      const on = isShown(prefs, p.id);
      const reason = s.installed === false ? (p.remote ? "not configured" : "not installed")
        : s.report && s.report.status !== "ok" ? s.report.message : null;
      rows.push(this.check(`p-${p.id}`, on, [image(p.icon).size(13), div().text_color(s.installed === false ? t.dim : t.foreground).child(p.name)],
        () => save(toggleProvider(this.prefs(), p.id)), t, 0, reason));
      const windows = (s.report?.status === "ok" ? s.report : s.lastGood)?.windows ?? [];
      for (const w of windows) {
        rows.push(this.check(`w-${p.id}-${w.id}`, on && isShown(prefs, p.id, w.id), [div().text_color(on ? t.muted : t.dim).child(w.long)],
          () => save(toggleWindow(this.prefs(), p.id, w.id)), t, 21));
      }
    }
    return this.shell(t)
      .child(h_flex().gap(6).items_center().h(24)
        .when(canGoBack, (e) => e.child(this.iconButton("ul-back", "back", "Back to limits", true, (cx) => this.show("limits", cx), t)))
        .child(div().font_semibold().child("Settings")))
      .child(div().text_size(11).text_color(t.dim).child("What the bar shows. This panel always shows everything."))
      .child(v_flex().gap(1).children(rows))
      .child(div().h(1).bg(t.border).flex_none())
      .child(this.check("opt-reset-time", prefs.showResetTime, [div().text_color(t.foreground).child("Always show time to reset")],
        () => save(toggleShowResetTime(this.prefs())), t))
      .child(this.check("opt-bars", prefs.showBars, [div().text_color(t.foreground).child("Show bars")],
        () => save(toggleShowBars(this.prefs())), t))
      .child(div().h(1).bg(t.border).flex_none())
      .child(v_flex().gap(1)
        .child(div().font_semibold().pb(3).child("This session"))
        .children(["Context", "Calls", "Compactions"].map((name) => {
          const row = name.toLowerCase();
          return this.check(`s-${row}`, isOnBar(prefs, row), [div().text_color(t.foreground).child(name)],
            () => save(toggleOnBar(this.prefs(), row)), t);
        })))
      .child(div().text_size(10.5).text_color(t.dim).child("Data: claude and codex CLIs, numbers from session logs."));
  }

  render(cx) {
    const terminal = focused()?.terminal ?? null;
    if (terminal !== this.terminal) {
      this.terminal = terminal;
      this.session = null;
      this.readSession(cx);
    }
    const asked = shared(KEY_REFRESH) ?? 0;
    if (asked !== this.seenRefresh) {
      this.seenRefresh = asked;
      for (const p of PROVIDERS) this.fetch(p, cx);
      this.fetchTokens(cx);
    }
    return this.renderBar(cx);
  }
}
