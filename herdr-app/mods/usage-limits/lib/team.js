// The team chip on the bar: the Claude usage from Ops that the kit's claude-usage CLI and
// panel write to shared state ({text, hint, stale, at}). Pure, so it's tested on its own.

export const TEAM_OLD = 20 * 60 * 1000; // ms, past this the chip dims as old

export function teamChip(chip, nowMs) {
  if (!chip?.text) return null;
  const old = Boolean(chip.stale) || !chip.at || nowMs - chip.at > TEAM_OLD;
  const hint = (chip.hint || "Team Claude usage") + (old ? "\nCouldn't reach Ops lately, so this may be out of date" : "");
  return { text: chip.text, hint, old, width: 7 * chip.text.length + 36 };
}
