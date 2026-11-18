// Tokens used and what they'd cost at API list prices. Pure: no Herdr imports.
// Input is helpers/tokens.py's JSON: per local day, per tool, per model key.

// Standard API rates in USD per million tokens, checked 2026-11-18.
// https://platform.claude.com/docs/en/about-claude/pricing
// https://developers.openai.com/api/docs/pricing and the individual model pages.
// A model missing here shows its tokens and "unpriced" instead of counting as $0.
export const PRICES = {
  claude: {
    // input, output, cache read, 5-minute cache write, 1-hour cache write
    "claude-fable-5-2": { input: 8, output: 40, cacheRead: 0.2, cacheWrite5m: 10, cacheWrite1h: 16 },
    "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25, cacheWrite5m: 12.5, cacheWrite1h: 20 },
    "claude-fable-5": { input: 10, output: 50, cacheRead: 1, cacheWrite5m: 12.5, cacheWrite1h: 20 },
    "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite5m: 5, cacheWrite1h: 8 },
    "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10 },
    "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10 },
    "claude-opus-4-7": { input: 5, output: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10 },
    "claude-opus-4-6": { input: 5, output: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10 },
    "claude-opus-4-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10 },
    "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1, cacheWrite5m: 2.5, cacheWrite1h: 4 },
    "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite5m: 2.5, cacheWrite1h: 4 },
    "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheWrite5m: 3.75, cacheWrite1h: 6 },
    "claude-sonnet-4-5": { input: 3, output: 15, cacheRead: 0.3, cacheWrite5m: 3.75, cacheWrite1h: 6 },
    "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite5m: 0.125, cacheWrite1h: 0.2 },
    // Prompts over 100K tokens.
    "claude-haiku-5-5|long": { input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite5m: 0.625, cacheWrite1h: 1 },
    "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite5m: 1.25, cacheWrite1h: 2 },
  },
  codex: {
    // uncached input, cached input, output (reasoning included)
    "gpt-6.2-sol": { input: 2, cached: 0.1, output: 10 },
    "gpt-6.2-astra": { input: 8, cached: 0.4, output: 40 },
    "gpt-6.1-terra": { input: 1, cached: 0.05, output: 5 },
    "gpt-6.1-sol": { input: 2, cached: 0.1, output: 10 },
    "gpt-6-astra": { input: 10, cached: 1, output: 50 },
    "gpt-6-sol": { input: 2, cached: 0.2, output: 10 },
    "gpt-6-luna": { input: 0.1, cached: 0.01, output: 0.5 },
    // GPT-5.6 Sol's published promotion runs through November 30, 2026.
    "gpt-5.6-sol": { input: 4, cached: 0.4, output: 20 },
    "gpt-5.6-terra": { input: 2, cached: 0.2, output: 12 },
    "gpt-5.6-luna": { input: 0.2, cached: 0.02, output: 1.2 },
  },
};
const FAST = 2; // fast mode bills twice the standard rate

export const CATEGORIES = {
  claude: [
    { id: "input", label: "Input" },
    { id: "output", label: "Output" },
    { id: "cacheRead", label: "Cache read" },
    { id: "cacheWrite5m", label: "Cache write 5m" },
    { id: "cacheWrite1h", label: "Cache write 1h" },
  ],
  codex: [
    { id: "input", label: "Input" },
    { id: "cached", label: "Cached input" },
    { id: "output", label: "Output" },
  ],
};

export const PERIODS = [
  { id: "today", label: "Today", days: 1 },
  { id: "week", label: "7 days", days: 7 },
  { id: "month", label: "30 days", days: 30 },
  { id: "all", label: "All time", days: Infinity },
];

export function parseTokens(text) {
  try {
    const d = JSON.parse(text);
    return d && typeof d.days === "object" ? d : null;
  } catch {
    return null;
  }
}

// YYYY-MM-DD for the local day `back` days before `today` (a Date).
export function dayKey(today, back = 0) {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function priceOf(tool, key) {
  const fast = key.endsWith("|fast");
  let base = fast ? key.slice(0, -5) : key;
  if (tool === "claude") {
    // Older Claude models can log the dated snapshot ID instead of its alias.
    base = base.replace(/-\d{8}$/, "");
  }
  const codexLong = tool === "codex" && base.endsWith("|long");
  if (codexLong) base = base.slice(0, -5);
  let p = Object.hasOwn(PRICES[tool] ?? {}, base) ? PRICES[tool][base] : null;
  if (!p) return null;
  if (codexLong) {
    p = { input: p.input * 2, cached: p.cached * 2, output: p.output * 1.5 };
  }
  return fast ? Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v * FAST])) : p;
}

// "claude-opus-5-5|long|fast" → "opus-5-5 (long, fast)"
export function modelLabel(key) {
  const [name, ...tags] = key.split("|");
  const short = name.replace(/^claude-/, "");
  return tags.length ? `${short} (${tags.join(", ")})` : short;
}

// One tool over one period: totals per category and per model, with costs.
export function summarize(data, tool, periodDays, today) {
  const cats = CATEGORIES[tool];
  const tokens = Object.fromEntries(cats.map((c) => [c.id, 0]));
  const costs = Object.fromEntries(cats.map((c) => [c.id, 0]));
  const models = {};
  let firstDay = null;
  const from = Number.isFinite(periodDays) ? dayKey(today, periodDays - 1) : "";
  const to = dayKey(today);
  for (const [date, tools] of Object.entries(data?.days ?? {})) {
    const day = tools?.[tool];
    if (!day || date < from || date > to) continue;
    if (firstDay == null || date < firstDay) firstDay = date;
    for (const [key, b] of Object.entries(day)) {
      const price = priceOf(tool, key);
      const m = (models[key] ??= { key, label: modelLabel(key), tokens: 0, cost: 0, calls: 0, priced: price != null });
      m.calls += b.calls ?? 0;
      for (const c of cats) {
        const n = b[c.id] ?? 0;
        const cost = price ? (n * price[c.id]) / 1e6 : 0;
        tokens[c.id] += n;
        costs[c.id] += cost;
        m.tokens += n;
        m.cost += cost;
      }
    }
  }
  const list = Object.values(models).sort((a, b) => b.cost - a.cost || b.tokens - a.tokens);
  return {
    tool,
    total: cats.reduce((s, c) => s + tokens[c.id], 0),
    cost: cats.reduce((s, c) => s + costs[c.id], 0),
    calls: list.reduce((s, m) => s + m.calls, 0),
    firstDay,
    categories: cats.map((c) => ({ id: c.id, label: c.label, tokens: tokens[c.id], cost: costs[c.id] })),
    models: list,
    unpriced: list.filter((m) => !m.priced && m.tokens > 0).map((m) => m.label),
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-10-08" → "Oct 8"
export function shortDate(iso) {
  const [, m, d] = String(iso ?? "").split("-").map(Number);
  return m >= 1 && m <= 12 && d ? `${MONTHS[m - 1]} ${d}` : "";
}

export function exact(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function money(usd) {
  if (usd > 0 && usd < 0.01) return "<$0.01";
  const [whole, cents] = usd.toFixed(2).split(".");
  return `$${exact(Number(whole))}.${cents}`;
}
