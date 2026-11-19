// Turns prompts.md into lib/prompts-data.mjs, the file the server function imports.
// Runs on every Netlify deploy (see netlify.toml) and when the local server starts.
import { readFileSync, writeFileSync } from "node:fs";
import { parsePrompts, REQUIRED } from "../lib/prompts.mjs";

const root = new URL("../", import.meta.url);
const data = parsePrompts(readFileSync(new URL("prompts.md", root), "utf8"));
const missing = REQUIRED.filter(k => !(k in data));
if (missing.length) {
  console.error(`prompts.md: these blocks are missing or their heading was changed:\n  ${missing.join("\n  ")}`);
  process.exit(1);          // fail the deploy rather than go live with half a prompt
}
if (!data["hat.ideas"].trim()) { console.error("prompts.md: hat.ideas needs at least one line"); process.exit(1); }
const body = `// GENERATED from prompts.md by scripts/build-prompts.mjs. Edit prompts.md, not this file.\nexport default ${JSON.stringify(data, null, 2)};\n`;
writeFileSync(new URL("lib/prompts-data.mjs", root), body);
console.log(`prompts.md -> lib/prompts-data.mjs (${Object.keys(data).length} blocks)`);
