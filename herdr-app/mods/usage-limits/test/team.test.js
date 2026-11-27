import { test } from "node:test";
import assert from "node:assert/strict";
import { teamChip, TEAM_OLD } from "../lib/team.js";

const chip = { text: "Team 38% · You 22%", hint: "Team tracking towards 38%", stale: false, at: 1000 };

test("no chip without the CLI's data", () => {
  assert.equal(teamChip(null, 0), null);
  assert.equal(teamChip({ hint: "x" }, 0), null);
});

test("a fresh chip shows its text and hint", () => {
  const c = teamChip(chip, 1000 + 60000);
  assert.equal(c.text, "Team 38% · You 22%");
  assert.equal(c.hint, "Team tracking towards 38%");
  assert.equal(c.old, false);
});

test("a stale or old chip dims and says so", () => {
  assert.equal(teamChip({ ...chip, stale: true }, 1000).old, true);
  assert.equal(teamChip(chip, 1000 + TEAM_OLD + 1).old, true);
  assert.equal(teamChip({ ...chip, at: undefined }, 1000).old, true);
  assert.match(teamChip({ ...chip, stale: true }, 1000).hint, /Couldn't reach Ops, so this is the last report$/);
  assert.match(teamChip(chip, 1000 + TEAM_OLD + 1).hint, /\nLast updated \d{1,2}:\d{2} (AM|PM), so it may be out of date$/);
  assert.doesNotMatch(teamChip(chip, 1000 + TEAM_OLD + 1).hint, /reach Ops/);
});
