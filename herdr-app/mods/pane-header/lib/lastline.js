// Picks the line to quote from a terminal's screen text (`hc read`): the agent's last
// message bullet when there is one (Claude Code's "⏺", Codex's "•"), else the last line
// that isn't prompt or status chrome. `hc read` marks soft wraps with a trailing "\",
// so wrapped lines are joined back first.

const CHROME = [
  /^[─━═\-_\s]+$/,                 // box rules
  /^[❯>›$%#]\s*$/,                 // an empty prompt
  /^[╭╰│┌└]/,                      // input box edges
  /--\s*(INSERT|NORMAL)\s*--/,
  /⏵⏵|shift\+tab|esc to interrupt|ctrl\+c to/i,
  /^[✶✻✽✢·*⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s+\S+…/,   // spinner status ("✶ Working… (4m · ...)")
  /^⎿/,
  /^…\s*\+\d+ lines/,
];

export function unwrap(text) {
  const out = [];
  let buf = "";
  for (const raw of String(text ?? "").split("\n")) {
    if (raw.endsWith("\\")) { buf += raw.slice(0, -1); continue; }
    out.push(buf + raw);
    buf = "";
  }
  if (buf) out.push(buf);
  return out.map(l => l.replace(/\s+$/, ""));
}

const isChrome = (l) => !l.trim() || CHROME.some(re => re.test(l.trim()));

export function lastLine(text) {
  const lines = unwrap(text);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^\s*(⏺|•)\s+(.*)$/.exec(lines[i]);
    if (m && m[2].trim()) return m[2].trim();
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!isChrome(lines[i])) return lines[i].trim();
  }
  return "";
}
