// The team chip on the bar: the Claude usage from Ops that the kit's claude-usage CLI and
// panel write to shared state ({text, hint, stale, at}). Pure, so it's tested on its own.

export const TEAM_OLD = 20 * 60 * 1000; // ms, past this the chip dims as old

function clock(d) {
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export function teamChip(chip, nowMs) {
  if (!chip?.text) return null;
  const old = Boolean(chip.stale) || !chip.at || nowMs - chip.at > TEAM_OLD;
  const note = chip.stale ? "\nCouldn't reach Ops, so this is the last report"
    : old ? `\nLast updated ${chip.at ? clock(new Date(chip.at)) : "a while ago"}, so it may be out of date` : "";
  const hint = (chip.hint || "Team Claude usage") + note;
  return { text: chip.text, hint, old, width: 7 * chip.text.length + 36 };
}
