import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, spaces, panes, focused, layout, theme, run, hc, checking, setAgentOrder, openOverlay, nextCommand, terminals } from "herdr";
import { SAMPLE_SPACES, SAMPLE_AGENTS, summary, ownerTabs, sidebarTabOrder } from "./model.js";

// Jump labels, easiest keys first; past single letters, two-letter labels behind reserved prefixes.
const KEYS = "asdfghjklqwertyuiopzxcvbnm";
function labels(n) {
  let p = 0;
  while (KEYS.length - p + p * KEYS.length < n && p < KEYS.length) p++;
  const out = KEYS.slice(0, KEYS.length - p).split("").slice(0, n);
  for (const prefix of KEYS.slice(KEYS.length - p)) for (const k of KEYS) if (out.length < n) out.push(prefix + k);
  return out;
}
function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) { const found = find(child, id); if (found) return found; }
  return null;
}

const tint = (color, alpha) => /^#[0-9a-f]{6,8}$/i.test(color ?? "") ? color.slice(0,7) + alpha : "#00000000";

export default class SpaceSessions extends View {
  init(_props, cx) {
    this.sample = checking();
    // keys.json: space-sessions.hints labels every tab (or collapsed space) with a letter; typing it jumps there.
    this.handle = cx.focus_handle();
    this.hinting = false; this.typed = ""; this.hintMap = [];
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === "hints") this.startHints();
        if (command === "focus") this.handle.focus();
        if (command === "next-agent") this.stepAgent(1);
        if (command === "prev-agent") this.stepAgent(-1);
        cx.notify();
      }
    });
    try {
      const saved = JSON.parse(localStorage.getItem("collapsed-spaces") ?? "[]");
      this.collapsed = new Set(Array.isArray(saved) ? saved.filter(id => typeof id === "string") : []);
    } catch { this.collapsed = new Set(); }
    try {
      const saved = JSON.parse(localStorage.getItem("collapsed-machines") ?? "[]");
      this.collapsedMachines = new Set(Array.isArray(saved) ? saved.filter(id => typeof id === "string") : []);
    } catch { this.collapsedMachines = new Set(); }
    // A remote machine's name is its address; `hc machine ls` knows its host name (omarchy).
    this.hosts = {};
    if (!this.sample) cx.spawn(async cx => {
      try {
        const out = await hc(["machine", "ls", "--json"]);
        for (const m of JSON.parse(out.stdout).machines ?? []) if (m.name && m.host) this.hosts[m.name] = m.host;
        cx.notify();
      } catch {}
    });
  }
  machineKey(space) { return space.machine ?? ""; }
  machineLabel(key) { return key ? (this.hosts[key] ?? key) : "This machine"; }
  toggleMachine(key, cx) {
    if (this.collapsedMachines.has(key)) this.collapsedMachines.delete(key);
    else this.collapsedMachines.add(key);
    try { localStorage.setItem("collapsed-machines", JSON.stringify([...this.collapsedMachines])); } catch {}
    cx.notify();
  }
  allSpaces() { return this.sample ? SAMPLE_SPACES : spaces(); }
  allAgents() { return this.sample ? SAMPLE_AGENTS : agents(); }
  act(name,args) { if(!this.sample)run(name,args); }

  // Agents in the order the sidebar shows them: spaces by machine, tabs depth-first with owned tabs
  // under their owner, panes in model order within a tab.
  orderedAgents() {
    const allAgents = this.allAgents();
    const keys = [...new Set(this.allSpaces().map(s => this.machineKey(s)))].sort((a, b) => (a ? 1 : 0) - (b ? 1 : 0));
    const all = keys.flatMap(k => this.allSpaces().filter(s => this.machineKey(s) === k));
    const cores = this.sample ? [] : terminals();
    const ownersOf = new Map(all.map(space => [space.id, ownerTabs(space.tabs ?? [], allAgents, cores)]));
    const tabOrder = all.flatMap(space => sidebarTabOrder(space.tabs ?? [], ownersOf.get(space.id)));
    const rank = id => { const i = tabOrder.indexOf(id); return i < 0 ? tabOrder.length : i; };
    const ordered = allAgents.map((a, i) => [a, i]).sort((x, y) => rank(x[0].tab) - rank(y[0].tab) || x[1] - y[1]).map(([a]) => a);
    return {all, ownersOf, ordered};
  }

  // keys.json: Cmd+] and Cmd+[ step through agents in sidebar order. The built-in agent.next folds a
  // delegated child into its parent when it works out the current agent, so it stalls on the child.
  stepAgent(dir) {
    const ordered = this.orderedAgents().ordered;
    if (!ordered.length) return;
    const pane = focused()?.pane;
    let at = ordered.findIndex(a => a.pane === pane);
    if (at < 0) {
      const space = this.allSpaces().find(s => s.active);
      const tab = space?.tabs?.find(t => t.active);
      at = ordered.findIndex(a => a.tab === tab?.id);
    }
    const next = ordered[at < 0 ? (dir > 0 ? 0 : ordered.length - 1) : (at + dir + ordered.length) % ordered.length];
    this.act("tab.select", { id: next.tab });
    if (next.pane) this.act("pane.focus", { pane: next.pane });
  }

  startHints() {
    if (this.hinting) { this.endHints(); return; }
    const sidebar = find(layout(), "sidebar");
    if (sidebar?.hidden) run("layout.show", { id: "sidebar" });
    this.returnPane = focused()?.pane ?? null;
    this.hinting = true; this.typed = "";
    this.handle.focus();
  }

  endHints(restore = true) {
    this.hinting = false; this.typed = "";
    if (restore && this.returnPane) run("pane.focus", { pane: this.returnPane });
  }

  // Jump to a tab and put the keyboard in its focused pane.
  jump(target) {
    this.endHints(false);
    if (target.kind === "space") { this.act("space.select", { id: target.id }); return; }
    this.act("tab.select", { id: target.id });
    const own = panes().filter(p => p.tab === target.id);
    const pane = own.find(p => p.focused) ?? own[0];
    if (pane) this.act("pane.focus", { pane: pane.pane });
  }

  hintKey(key) {
    if (key === "escape") { this.endHints(); return; }
    if (key === "backspace") { this.typed = this.typed.slice(0, -1); return; }
    if (!/^[a-z]$/.test(key)) return;
    const typed = this.typed + key, matches = this.hintMap.filter(([label]) => label.startsWith(typed));
    if (!matches.length) return;
    const exact = matches.find(([label]) => label === typed);
    if (exact) this.jump(exact[1]); else this.typed = typed;
  }

  badge(t, label) {
    const live = label.startsWith(this.typed);
    return div().flex_none().px(4).rounded(3).text_size(11).font_semibold()
      .bg(live ? t.accent : t.border).text_color(live ? t.background : t.dim).child(label);
  }

  toggleSpace(id, cx) {
    if (this.collapsed.has(id)) this.collapsed.delete(id);
    else this.collapsed.add(id);
    try { localStorage.setItem("collapsed-spaces", JSON.stringify([...this.collapsed])); } catch {}
    cx.notify();
  }

  renderAgentRow(t, agent, space, tab) {
    const program = agent.program;
    const selected = space.active && tab.active && agent.focused;
    const label = agent.pane_name || agent.title || program?.name || agent.address;
    return h_flex().id(`agent-${agent.address}`).gap(6).items_center().px(8).py(3)
      .cursor_pointer().hover(s => s.bg(t.hover))
      .on_click(() => { this.act("tab.select", {id:tab.id}); this.act("pane.focus", {pane:agent.pane}); })
      .bg(selected ? t.selected : "#00000000")
      .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(11).text_color(t.dim) : image(program.icon).size(11)))
      .when(!program?.icon, el => el.child(div().w(11).flex_none().text_size(10).text_color(t.dim).child("›_")))
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(selected ? t.foreground : t.dim).child(label))
      .when(["working","blocked","done"].includes(agent.status), el => el.child(div().size(5).rounded(3).flex_none().bg(t[agent.status])));
  }

  renderSpaces(t) {
    const allAgents = this.allAgents();
    const keys = [...new Set(this.allSpaces().map(s => this.machineKey(s)))].sort((a, b) => (a ? 1 : 0) - (b ? 1 : 0));
    const multi = keys.length > 1;
    const {all, ownersOf, ordered} = this.orderedAgents();
    const shown = all.filter(s => !multi || !this.collapsedMachines.has(this.machineKey(s)));
    const grouped = true;
    // agent.select and other built-in navigation use the sidebar order too.
    if (!this.sample) setAgentOrder(ordered.map(a => a.address));
    if (this.hinting) {
      if (this.handle.is_focused()) this.hadFocus = true;
      else if (this.hadFocus) this.endHints(false);
    } else this.hadFocus = false;
    const targets = shown.flatMap(space => this.collapsed.has(space.id) ? [{kind:"space", id:space.id}]
      : (space.tabs ?? []).map(tab => ({kind:"tab", id:tab.id})));
    const names = labels(targets.length);
    this.hintMap = targets.map((target, i) => [names[i], target]);
    const labelFor = (kind, id) => this.hinting ? this.hintMap.find(([, x]) => x.kind === kind && x.id === id)?.[0] : null;
    const cardFor = space => {
      const expanded = !this.collapsed.has(space.id);
      const details = summary(space, allAgents);
      const count = space.tabs?.length ?? 0;
      const busy = details.counts.blocked ? `${details.counts.blocked} needs you`
        : details.counts.working ? `${details.counts.working} working` : "";
      const heading = h_flex().id(`pick-${space.id}`).gap(5).items_center().px(5).py(4)
        .cursor_pointer().on_click(() => this.act("space.select", {id:space.id}))
        .on_mouse_down("right", (_e,cx) => {cx.stop_propagation();if(!this.sample)openOverlay({mod:"menu",kind:"popup",width:200,height:260,props:{tab:"space",target:{id:space.id}}});})
        .child(div().id(`fold-${space.id}`).w(16).h(18).flex_none().flex().items_center().justify_center().rounded(4)
          .text_size(12).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
          .tooltip(`${expanded ? "Collapse" : "Expand"} ${space.name}`)
          .accessibility_label(`${expanded ? "Collapse" : "Expand"} ${space.name}`)
          .on_mouse_down("left", (_e,cx) => cx.stop_propagation())
          .on_click((_e,cx) => {cx.stop_propagation();this.toggleSpace(space.id,cx);})
          .child(expanded ? "▾" : "▸"))
        .when(Boolean(labelFor("space", space.id)), el => el.child(this.badge(t, labelFor("space", space.id))))
        .child(div().flex_1().min_w(0).truncate().text_size(11.8).font_semibold()
          .text_color(space.active ? t.foreground : t.muted).child(space.name))
        .when(Boolean(busy), el => el.child(div().text_size(10).text_color(details.counts.blocked ? t.blocked : t.dim).child(busy)))
        .child(div().px(5).py(1).rounded(4).text_size(10).text_color(t.dim).child(String(count)));
      const owners = ownersOf.get(space.id);
      const childTabs = id => (space.tabs ?? []).filter(x => owners.get(x.id) === id);
      const topTabs = (space.tabs ?? []).filter(x => !owners.has(x.id));
      const renderTab = (tab, index, depth) => {
        const selected = space.active && tab.active;
        const tabAgents = allAgents.filter(a => a.tab === tab.id);
        const program = tabAgents[0]?.program;
        const row = h_flex().id(`session-${tab.id}`).gap(7).items_center().px(8).py(4).rounded(0)
          .cursor_pointer().hover(s => s.bg(t.hover)).on_click(() => this.act("tab.select", {id:tab.id}))
          .on_mouse_down("right", (_e,cx) => {cx.stop_propagation();if(!this.sample)openOverlay({mod:"menu",kind:"popup",width:200,props:{tab:"tab",target:{id:tab.id,space:space.id}}});})
          .bg(selected ? t.selected : "#00000000")
          .when(Boolean(labelFor("tab", tab.id)), el => el.child(this.badge(t, labelFor("tab", tab.id))))
          .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(13).text_color(t.muted) : image(program.icon).size(13)))
          .when(!program?.icon, el => el.child(div().w(13).flex_none().text_size(11).text_color(t.dim).child("›_")))
          .child(div().flex_1().min_w(0).truncate().text_color(selected ? t.foreground : t.muted).child(tab.name))
          .when(["working","blocked","done"].includes(tab.status), el => el.child(div().size(5).rounded(3).flex_none().bg(t[tab.status])));
        const paneRows = tabAgents.length > 1 ? tabAgents.map(agent => this.renderAgentRow(t, agent, space, tab)) : [];
        return v_flex().id(`row-${tab.id}`).child(row)
          .when(paneRows.length > 0, el => el.child(v_flex().id(`panes-${tab.id}`).pl(20).pb(2).children(paneRows)))
          .when(childTabs(tab.id).length > 0 && depth < 4, el => el.child(v_flex().id(`owned-${tab.id}`).pl(14).children(
            childTabs(tab.id).map((child, i) => renderTab(child, i, depth + 1)))))
          .when(depth === 0 && index < topTabs.length - 1 && !selected, el => el.child(div().h(1).ml(28).mr(8).bg(tint(t.foreground,"1b"))));
      };
      const sessions = topTabs.map((tab, index) => renderTab(tab, index, 0));
      return v_flex().id(`space-${space.id}`).gap(0).mx(7).my(3).px(4).py(3).rounded(8)
        .border_1().border_color(space.active ? t.input : t.border).bg(tint(t.surface,"20"))
        .child(heading)
        .when(grouped && expanded, el => el.child(v_flex().id(`sessions-${space.id}`).pl(14).pr(2).gap(2).children(sessions)));
    };
    const cards = !multi ? all.map(cardFor) : keys.flatMap(key => {
      const own = all.filter(s => this.machineKey(s) === key);
      const open = !this.collapsedMachines.has(key);
      const counts = own.map(s => summary(s, allAgents).counts);
      const blocked = counts.reduce((n, c) => n + c.blocked, 0), working = counts.reduce((n, c) => n + c.working, 0);
      const busy = blocked ? `${blocked} needs you` : working ? `${working} working` : "";
      const label = this.machineLabel(key);
      const header = h_flex().id(`machine-${key || "local"}`).gap(5).items_center().px(12).pt(6).pb(2)
        .cursor_pointer().text_color(t.dim).hover(s => s.text_color(t.foreground))
        .tooltip(`${open ? "Collapse" : "Expand"} ${label}`)
        .accessibility_label(`${open ? "Collapse" : "Expand"} ${label}`)
        .on_click((_e, cx) => this.toggleMachine(key, cx))
        .child(div().w(10).flex_none().text_size(10).child(open ? "▾" : "▸"))
        .child(div().flex_1().min_w(0).truncate().text_size(10.5).font_semibold().child(label.toUpperCase()))
        .when(!open && Boolean(busy), el => el.child(div().text_size(10).text_color(blocked ? t.blocked : t.dim).child(busy)))
        .child(div().text_size(10).child(String(own.length)));
      return [header, ...(open ? own.map(cardFor) : [])];
    });
    return v_flex().id("space-sessions").track_focus(this.handle).size_full().min_h(0).text_size(12.5).bg(t.chrome)
      .on_key_down((e, cx) => { if (!this.hinting) return; this.hintKey(e.key); cx.stop_propagation(); cx.notify(); })
      .child(h_flex().items_center().justify_between().px(12).py(7).text_color(t.muted)
        .child(this.hinting ? `Jump to a tab${this.typed ? ` · ${this.typed}` : ""} · Esc` : "Spaces")
        .child(div().text_size(10).child(String(all.length))))
      .child(v_flex().id("context-list").min_h(0).overflow_y_scrollbar()
        .when(grouped, el => el.flex_1()).children(cards))
      .when(!all.length, el => el.child(div().p(12).text_color(t.muted).child("Open a space to start a work context.")));
  }

  render() { return this.renderSpaces(theme()); }
}
