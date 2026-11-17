import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MOD } from "./_util.js";
import { parseTokens, summarize, dayKey, priceOf, modelLabel, money, exact } from "../lib/tokens.js";

const TODAY = new Date(2026, 10, 17, 15, 0);

const DATA = {
  since: "2026-10-18",
  days: {
    "2026-11-17": {
      claude: {
        "claude-opus-5-5": { input: 1000, output: 2000, cacheRead: 1_000_000, cacheWrite5m: 100_000, cacheWrite1h: 50_000, calls: 3 },
        "claude-opus-5-5|fast": { input: 0, output: 1_000_000, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, calls: 1 },
      },
      codex: {
        "gpt-6.1-sol": { input: 1_000_000, cached: 10_000_000, output: 100_000, reasoning: 50_000, calls: 4 },
        "codex-auto-review": { input: 500, cached: 0, output: 10, reasoning: 0, calls: 1 },
      },
    },
    "2026-11-11": { claude: { "claude-sonnet-5-5": { input: 0, output: 1_000_000, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, calls: 1 } } },
    "2026-11-10": { claude: { "claude-sonnet-5-5": { input: 0, output: 1_000_000, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, calls: 1 } } },
  },
};

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test("dayKey: local days back, across a month edge", () => {
  assert.equal(dayKey(TODAY), "2026-11-17");
  assert.equal(dayKey(TODAY, 17), "2026-10-31");
});

test("summarize: Claude prices each category, fast mode at 2x", () => {
  const s = summarize(DATA, "claude", 1, TODAY);
  // 1000*4 + 2000*20 + 1e6*0.2 + 1e5*5 + 5e4*8 per MTok, plus 1M fast output at $40
  near(s.cost, (4000 + 40000 + 200000 + 500000 + 400000) / 1e6 + 40);
  assert.equal(s.total, 1000 + 2000 + 1_000_000 + 100_000 + 50_000 + 1_000_000);
  assert.equal(s.calls, 4);
  assert.deepEqual(s.unpriced, []);
  assert.equal(s.models[0].label, "opus-5-5 (fast)");
});

test("summarize: Codex counts uncached, cached and output; unknown models are unpriced, not $0", () => {
  const s = summarize(DATA, "codex", 1, TODAY);
  near(s.cost, 2 + 1 + 1);
  assert.deepEqual(s.unpriced, ["codex-auto-review"]);
  assert.equal(s.total, 11_100_000 + 510);
});

test("summarize: the 7-day window includes 6 days back and not 7", () => {
  const s = summarize(DATA, "claude", 7, TODAY);
  const sonnet = s.models.find((m) => m.key === "claude-sonnet-5-5");
  assert.equal(sonnet.tokens, 1_000_000);
  near(sonnet.cost, 10);
});

test("summarize: all time counts every day in the scan", () => {
  const s = summarize(DATA, "claude", Infinity, TODAY);
  assert.equal(s.models.find((m) => m.key === "claude-sonnet-5-5").tokens, 2_000_000);
});

test("summarize: no data gives zeros", () => {
  const s = summarize(null, "codex", 30, TODAY);
  assert.equal(s.total, 0);
  assert.equal(s.cost, 0);
});

test("priceOf / modelLabel", () => {
  assert.equal(priceOf("claude", "nope"), null);
  assert.equal(priceOf("claude", "claude-opus-5-5|fast").output, 40);
  assert.equal(modelLabel("claude-haiku-5-5|long"), "haiku-5-5 (long)");
});

test("money / exact", () => {
  assert.equal(exact(1234567), "1,234,567");
  assert.equal(exact(12), "12");
  assert.equal(money(1234.567), "$1,234.57");
  assert.equal(money(0.001), "<$0.01");
  assert.equal(money(0), "$0.00");
});

test("parseTokens: bad input is null", () => {
  assert.equal(parseTokens(""), null);
  assert.equal(parseTokens("{}"), null);
  assert.ok(parseTokens(JSON.stringify(DATA)));
});

// The helper over a fake home: duplicates counted once, Codex totals turned into deltas.
test("tokens.py: dedupes Claude responses and diffs Codex running totals", () => {
  const home = mkdtempSync(join(tmpdir(), "ul-tokens-"));
  const now = new Date().toISOString();
  const proj = join(home, ".claude", "projects", "p");
  mkdirSync(join(proj, "s", "subagents"), { recursive: true });
  const usage = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 300, cache_creation_input_tokens: 40, cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 30 } };
  const line = (id) => JSON.stringify({ type: "assistant", timestamp: now, requestId: `r${id}`, message: { id: `m${id}`, model: "claude-opus-5-5", usage } });
  writeFileSync(join(proj, "s.jsonl"), [line(1), line(1), line(2)].join("\n") + "\n");
  writeFileSync(join(proj, "s", "subagents", "a.jsonl"), [line(2), line(3)].join("\n") + "\n");

  const sess = join(home, ".codex", "sessions", "2026", "11", "17");
  mkdirSync(sess, { recursive: true });
  const tc = (total, last) => JSON.stringify({ timestamp: now, type: "event_msg", payload: { type: "token_count", info: { total_token_usage: total, last_token_usage: last } } });
  const u = (i, c, o, r) => ({ input_tokens: i, cached_input_tokens: c, output_tokens: o, reasoning_output_tokens: r });
  writeFileSync(join(sess, "rollout-x.jsonl"), [
    JSON.stringify({ timestamp: now, type: "turn_context", payload: { model: "gpt-6.1-sol" } }),
    tc(u(100, 60, 10, 4), u(100, 60, 10, 4)),
    tc(u(100, 60, 10, 4), u(100, 60, 10, 4)), // repeated, no new call
    tc(u(250, 200, 15, 5), u(150, 140, 5, 1)),
  ].join("\n") + "\n");

  const r = spawnSync("python3", ["-I", join(MOD, "helpers", "tokens.py")], { env: { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: "", CODEX_HOME: "" }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const data = parseTokens(r.stdout);
  const day = Object.values(data.days)[0];
  assert.deepEqual(day.claude["claude-opus-5-5"], { input: 30, output: 60, cacheRead: 900, cacheWrite5m: 30, cacheWrite1h: 90, calls: 3 });
  assert.deepEqual(day.codex["gpt-6.1-sol"], { input: 50, cached: 200, output: 15, reasoning: 5, calls: 2 });
});
