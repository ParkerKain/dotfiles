// Pure helpers for the radar prototype: lanes, plane placement, short names, and the fix
// prompt (copied from the kit's lock-in/lib/model.js so the prototype stands alone).
// No herdr imports, so `node --test` can run them.

export const LANES = {
  final: { label: "Final", range: "within 3 days", from: -1, to: 3 },
  approach: { label: "Approach", range: "4 to 7 days", from: 4, to: 7 },
  holding: { label: "Holding", range: "8 days or more", from: 8, to: 14 },
};

export function laneOf(days) {
  const d = Number(days);
  if (!Number.isFinite(d) || d <= 3) return "final";
  if (d <= 7) return "approach";
  return "holding";
}

// Detail grows as a session gets closer, like a radar: Final shows the full short name,
// Approach two words, Holding just the client code.
// "[BD-A] Advisory Hours" -> "BD-A Advisory Hours"; "[RAYA] Automated Context Management (DE-B) | Kickoff" -> "RAYA Kickoff".
export function shortName(name, lane = "final") {
  const s = String(name ?? "Untitled");
  const m = s.match(/^\[([^\]]+)\]\s*(.*)$/);
  const code = m ? m[1] : "", rest = (m ? m[2] : s).trim();
  if (lane === "holding" && code) return code;
  const words = lane === "approach" ? 2 : 3;
  const tail = rest.includes("|") ? rest.split("|").pop().trim() : rest.replace(/\s*[-:(].*$/, "").split(/\s+/).slice(0, words).join(" ");
  return [code, tail].filter(Boolean).join(" ");
}

// Rough width of a plane in layout px: icon, name, days and padding at 11.5px text.
export const planeWidth = (flag, lane) => 44 + Math.ceil(shortName(flag.name, lane).length * 7.2) + String(flag.days ?? "").length * 7;

// Where each plane in a lane sits: by days out, nudged right so none overlap, and the
// ones that don't fit folded into a "+N" chip at the end. Returns [{ flag, x } | { more, x }].
export function placeLane(flags, lane, width) {
  const spec = LANES[lane];
  const sorted = [...flags].sort((a, b) => (a.days - b.days) || (a.id - b.id));
  const out = [];
  const usable = Math.max(0, width - 40);
  const widths = sorted.map(f => planeWidth(f, lane));
  let right = 6;
  for (let i = 0; i < sorted.length; i++) {
    const f = sorted[i];
    const span = Math.max(1, spec.to - spec.from);
    const frac = Math.min(1, Math.max(0, (Number(f.days) - spec.from) / span));
    const ideal = 8 + frac * Math.max(0, usable - widths[i]);
    // Leave room for the planes after this one, so a crowded end of the lane pushes
    // planes left instead of off the edge.
    const rest = widths.slice(i).reduce((a, w) => a + w + 8, 0) - 8;
    const cap = usable + 34 - rest;
    const x = Math.max(right, Math.min(ideal, cap));
    if (width > 0 && x + widths[i] > usable + 34) {
      out.push({ more: sorted.length - i, x: Math.max(right, usable) });
      break;
    }
    out.push({ flag: f, x: Math.round(x) });
    right = x + widths[i] + 8;
  }
  return out;
}

// Hint letters, home row first, as in Lock-in (r refreshes, so it's left out).
export const HINTS = "asdfgqwetyuipzxcvbnm";
export const hintFor = (index) => (index != null && index < HINTS.length ? HINTS[index] : null);
export function hintIndex(key, count) {
  const k = String(key ?? "").toLowerCase();
  const i = k.length === 1 ? HINTS.indexOf(k) : -1;
  return i >= 0 && i < count ? i : -1;
}

export function decode(stdout, stderr, code) {
  let value = null;
  try { value = JSON.parse(stdout || ""); } catch { /* handled below */ }
  if (!value || typeof value !== "object") {
    const why = (stderr || "").trim() || `lock-in exited ${code}`;
    return { report: null, error: why.split("\n").at(-1) };
  }
  if (value.ok) return { report: value.data ?? null, error: null };
  return { report: value.data ?? null, error: value.error?.message ?? "lock-in failed" };
}

export function fixPrompt(flag) {
  const lines = [
    `Session not locked in: ${flag.name}`,
    `Ops session ${flag.id}, project ${flag.project_id}`,
    `When: ${flag.when_label ?? flag.starts_at ?? "no date"}${flag.relative_label ? ` (${flag.relative_label})` : ""}`,
    `Status: ${flag.status ?? "none"}`,
    `Why it's flagged: ${flag.reason}`,
  ];
  const d = flag.decline;
  if (d) {
    const parts = [d.name, d.comment && `"${d.comment}"`, d.proposed_label && `proposed ${d.proposed_label}`].filter(Boolean);
    lines.push(`Client decline: ${parts.join(", ")}`);
  }
  if (flag.hub_url) lines.push(`Scheduling Hub: ${flag.hub_url}`);
  lines.push("",
    "Help me get this session locked in with the client. Use the ops-mcp skill: read the project's scheduling state and this session, tell me what's blocking it, and preview the fix.",
    "Don't send, move or cancel anything, or email anyone, until I confirm.");
  return lines.join("\n");
}

export function fixTask(flag, folder) {
  return { title: `Lock in ${flag.name}`, prompt: fixPrompt(flag), slug: `lock-in-${flag.id}`, folder };
}
