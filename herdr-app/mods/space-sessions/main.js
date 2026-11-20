import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, spaces, theme, run, checking, setAgentOrder, openOverlay } from "herdr";
import { SAMPLE_SPACES, SAMPLE_AGENTS, summary } from "./model.js";

const tint = (color, alpha) => /^#[0-9a-f]{6,8}$/i.test(color ?? "") ? color.slice(0,7) + alpha : "#00000000";

export default class SpaceSessions extends View {
  init() {
    this.sample = checking();
    try {
      const saved = JSON.parse(localStorage.getItem("collapsed-spaces") ?? "[]");
      this.collapsed = new Set(Array.isArray(saved) ? saved.filter(id => typeof id === "string") : []);
    } catch { this.collapsed = new Set(); }
  }
  allSpaces() { return this.sample ? SAMPLE_SPACES : spaces(); }
  allAgents() { return this.sample ? SAMPLE_AGENTS : agents(); }
  act(name,args) { if(!this.sample)run(name,args); }

  toggleSpace(id, cx) {
    if (this.collapsed.has(id)) this.collapsed.delete(id);
    else this.collapsed.add(id);
    try { localStorage.setItem("collapsed-spaces", JSON.stringify([...this.collapsed])); } catch {}
    cx.notify();
  }

  renderAgentRow(t, agent, space, tab) {
    const program = agent.program;
    const selected = space.active && tab.active && agent.focused;
    const label = agent.title || program?.name || agent.address;
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
    const all = this.allSpaces(), allAgents = this.allAgents();
    const grouped = true;
    if (!this.sample) setAgentOrder(allAgents.map(a => a.address));
    const cards = all.map(space => {
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
        .child(div().flex_1().min_w(0).truncate().text_size(11.8).font_semibold()
          .text_color(space.active ? t.foreground : t.muted).child(space.name))
        .when(Boolean(busy), el => el.child(div().text_size(10).text_color(details.counts.blocked ? t.blocked : t.dim).child(busy)))
        .child(div().px(5).py(1).rounded(4).text_size(10).text_color(t.dim).child(String(count)));
      const sessions = (space.tabs ?? []).map((tab,index) => {
        const selected = space.active && tab.active;
        const tabAgents = allAgents.filter(a => a.tab === tab.id);
        const program = tabAgents[0]?.program;
        const row = h_flex().id(`session-${tab.id}`).gap(7).items_center().px(8).py(4).rounded(0)
          .cursor_pointer().hover(s => s.bg(t.hover)).on_click(() => this.act("tab.select", {id:tab.id}))
          .on_mouse_down("right", (_e,cx) => {cx.stop_propagation();if(!this.sample)openOverlay({mod:"menu",kind:"popup",width:200,props:{tab:"tab",target:{id:tab.id,space:space.id}}});})
          .bg(selected ? t.selected : "#00000000")
          .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(13).text_color(t.muted) : image(program.icon).size(13)))
          .when(!program?.icon, el => el.child(div().w(13).flex_none().text_size(11).text_color(t.dim).child("›_")))
          .child(div().flex_1().min_w(0).truncate().text_color(selected ? t.foreground : t.muted).child(tab.name))
          .when(["working","blocked","done"].includes(tab.status), el => el.child(div().size(5).rounded(3).flex_none().bg(t[tab.status])));
        const paneRows = tabAgents.length > 1 ? tabAgents.map(agent => this.renderAgentRow(t, agent, space, tab)) : [];
        return v_flex().id(`row-${tab.id}`).child(row)
          .when(paneRows.length > 0, el => el.child(v_flex().id(`panes-${tab.id}`).pl(20).pb(2).children(paneRows)))
          .when(index < count - 1 && !selected, el => el.child(div().h(1).ml(28).mr(8).bg(tint(t.foreground,"1b"))));
      });
      return v_flex().id(`space-${space.id}`).gap(0).mx(7).my(3).px(4).py(3).rounded(8)
        .border_1().border_color(space.active ? t.input : t.border).bg(tint(t.surface,"20"))
        .child(heading)
        .when(grouped && expanded, el => el.child(v_flex().id(`sessions-${space.id}`).pl(14).pr(2).gap(2).children(sessions)));
    });
    return v_flex().size_full().min_h(0).text_size(12.5).bg(t.chrome)
      .child(h_flex().items_center().justify_between().px(12).py(7).text_color(t.muted)
        .child("Spaces")
        .child(div().text_size(10).child(String(all.length))))
      .child(v_flex().id("context-list").min_h(0).overflow_y_scrollbar()
        .when(grouped, el => el.flex_1()).children(cards))
      .when(!all.length, el => el.child(div().p(12).text_color(t.muted).child("Open a space to start a work context.")));
  }

  render() { return this.renderSpaces(theme()); }
}
