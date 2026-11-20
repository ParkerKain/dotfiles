export const SAMPLE_SPACES = [
  {id:"training", name:"Training materials", folder:"/Users/parker/Documents/internal/repos/devclarity-vault", active:true, machine:null,
    tabs:[{id:"design", name:"Slide design", active:true, status:"working"}, {id:"builder", name:"Builder experiments", status:"blocked"}]},
  {id:"herdr", name:"Herdr setup", folder:"/Users/parker/Documents/internal/repos/devclarity-vault", machine:null,
    tabs:[{id:"mods", name:"Mod review", status:"done"}]},
  {id:"client", name:"Client work", folder:"/Users/parker/Documents/internal/repos/devclarity-vault", machine:null,
    tabs:[{id:"prep", name:"Session prep", status:"idle"}]}
];
export const SAMPLE_AGENTS = [
  {address:"sample-design", title:"Slide design", tab_name:"Slide design", space:"training", space_name:"Training materials", status:"working", app:"claude-code"},
  {address:"sample-builder", pane:"builder-1", title:"Builder experiments", tab:"builder", tab_name:"Builder experiments", space:"training", space_name:"Training materials", status:"blocked", app:"codex"},
  {address:"sample-builder-review", pane:"builder-2", title:"Builder review", tab:"builder", tab_name:"Builder experiments", space:"training", space_name:"Training materials", status:"working", app:"claude-code"},
  {address:"sample-mods", title:"Mod review", tab_name:"Mod review", space:"herdr", space_name:"Herdr setup", status:"done", app:"codex"}
];
export function summary(space, allAgents) {
  const own = allAgents.filter(a => a.space === space.id);
  const counts = Object.fromEntries(["working", "blocked", "done", "idle"].map(s => [s, own.filter(a => a.status === s).length]));
  const parts = [];
  if (counts.blocked) parts.push(`${counts.blocked} needs you`);
  if (counts.done) parts.push(`${counts.done} finished`);
  if (counts.working) parts.push(`${counts.working} working`);
  if (!parts.length) parts.push(`${space.tabs?.length ?? 0} sessions`);
  return {counts, text:parts.join(" · ")};
}
