// Reads prompts.md: every "### … — `key`" heading followed by a fenced block becomes one entry.
export function parsePrompts(md) {
  const out = {};
  const re = /^###[^\n]*`([^`\n]+)`[^\n]*\n(?:(?!^###|^```)[^\n]*\n)*?```[^\n]*\n([\s\S]*?)\n?```/gm;
  for (const m of md.matchAll(re)) out[m[1]] = m[2].trim();
  return out;
}

/** Fill {placeholders}; unknown ones are left out, and leftover double spaces are tidied up. */
export function fill(template, values) {
  return String(template || "").replace(/\{(\w+)\}/g, (_, k) => values[k] ?? "").replace(/\s+/g, " ").trim();
}

export const REQUIRED = [
  "shared.who", "shared.pose", "shared.scene",
  "hat.prompt", "hat.count", "hat.count.robin", "hat.worn.one", "hat.worn.many", "hat.ideas", "hat.everyone",
  "extra.antlers", "extra.scarf", "extra.cookie", "extra.candycane",
  "robin.text", "robin.everyone",
  "knight.prompt", "knight.animals",
  ...["plate", "guard", "forest", "king", "tournament"].flatMap(k => [`knight.${k}.costume`, `knight.${k}.helmet`]),
];
