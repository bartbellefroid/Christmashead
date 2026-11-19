// Mutsify AI edit (funny Santa hats, faces unchanged) via Replicate (black-forest-labs/flux-2-klein-4b).
// The Replicate token stays on the server: set REPLICATE_API_TOKEN in the hosting environment.
//
//   POST /api/funhouse  { image: "data:image/jpeg;base64,...", subjects?, extra? }  -> { id, status }
//        extra: "hat" (default) | "antlers" | "scarf" | "cookie" | "candycane" — chosen with the colour dots
//        robin: true — sent by the hidden /robin page: Robin the robot joins the photo
//        mode: "knight" — sent by the hidden /ridder page: everyone becomes a medieval knight;
//              extra then picks the costume: "plate" | "guard" | "forest" | "king" | "tournament"
//   GET  /api/funhouse?id=<prediction id>                        -> { status, image?, error? }
//
// Generation takes longer than many serverless time limits, so the browser starts the
// prediction and then polls for the result.

import { takeSlot, giveBack, clientIp, LIMIT, WINDOW_MS } from "../../lib/rate-limit.mjs";
import { ROBIN_IMAGE } from "../../lib/robin-image.mjs";
import P from "../../lib/prompts-data.mjs";
import { fill } from "../../lib/prompts.mjs";

const MODEL_URL = "https://api.replicate.com/v1/models/black-forest-labs/flux-2-klein-4b/predictions";
const PREDICTION_URL = "https://api.replicate.com/v1/predictions/";
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const SUBJECTS = new Set(["person", "bird", "cat", "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe", "teddy bear"]);
const NUMBERS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const plural = (label, n) => {
  const word = label === "animal" ? "animal" : label;
  return n === 1 ? word : word === "person" ? "people" : word === "sheep" ? "sheep" : `${word}s`;
};

// subjects: what the page's detector found, e.g. { person: 2, dog: 1 }. Telling the model exactly
// who is in the picture stops it from inventing extra (human) faces.
function describe(subjects) {
  const parts = Object.entries(subjects || {})
    .map(([k, n]) => `${NUMBERS[n] || n} ${plural(k, n)}`);
  if (!parts.length) return null;
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

function normalise(subjects) {
  // The in-browser detector sometimes mixes up similar animals (a beagle labelled "cow"), and
  // naming the wrong species makes the model morph the animal. With more than one animal
  // species we therefore only pass on "animal" and let the model keep each one's own species.
  const clean = {};
  for (const [k, n] of Object.entries(subjects || {})) {
    if (SUBJECTS.has(k) && Number.isInteger(n) && n > 0 && n <= 30) clean[k] = n;
  }
  const animalKinds = Object.keys(clean).filter(k => k !== "person");
  if (animalKinds.length > 1) {
    clean.animal = animalKinds.reduce((sum, k) => sum + clean[k], 0);
    animalKinds.forEach(k => delete clean[k]);
  }
  return clean;
}

// Optional extra per colour dot on the page. "hat" (the default) adds nothing beyond the hat.
function totalHeads(subjects) {
  return Object.values(subjects).reduce((sum, n) => sum + n, 0);
}

// ---------- prompts ----------
// All prompt text lives in prompts.md (hand-editable); scripts/build-prompts.mjs turns it into
// lib/prompts-data.mjs on every deploy. Here it is only assembled.
const EXTRA_KEYS = ["antlers", "scarf", "cookie", "candycane"];
const KNIGHT_KEYS = ["plate", "guard", "forest", "king", "tournament"];
const shared = () => ({ who: P["shared.who"], pose: P["shared.pose"], scene: P["shared.scene"] });

function buildKnightPrompt(raw, styleName) {
  const subjects = normalise(raw);
  const style = KNIGHT_KEYS.includes(styleName) ? styleName : "plate";
  const hasAnimals = Object.keys(subjects).some(k => k !== "person");
  return fill(P["knight.prompt"], {
    ...shared(),
    costume: P[`knight.${style}.costume`],
    helmet: P[`knight.${style}.helmet`],
    animals: hasAnimals ? P["knight.animals"] : "",
  });
}

function buildPrompt(raw, extraName, robin = false) {
  const subjects = normalise(raw);
  const who = describe(subjects);
  const n = totalHeads(subjects) + (robin ? 1 : 0);
  // One way of wearing it per head. Listing several ideas for a single head made the model merge
  // them into one hat (two tips, two pom-poms: a jester's hat).
  const all = P["hat.ideas"].split("\n").map(t => t.trim()).filter(Boolean);
  const ideas = shuffle([...all]).slice(0, Math.min(Math.max(n, 1), 3));
  const number = `${NUMBERS[n] || n} ${n === 1 ? "hat" : "hats"}`;
  return fill(P["hat.prompt"], {
    ...shared(),
    count: who ? fill(P[robin ? "hat.count.robin" : "hat.count"], { number }) : "",
    worn: ideas.length === 1 ? fill(P["hat.worn.one"], { idea: ideas[0] }) : fill(P["hat.worn.many"], { ideas: ideas.join("; ") }),
    extra: EXTRA_KEYS.includes(extraName) ? P[`extra.${extraName}`] : "",
    robin: robin ? P["robin.text"] : "",
    everyone: P[robin ? "robin.everyone" : "hat.everyone"],
  });
}

// The model's fixed aspect ratios; pick the one closest to the photo (width / height from the page).
const RATIOS = ["1:1", "16:9", "9:16", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "21:9", "9:21"];
function nearestRatio(aspect) {
  if (typeof aspect !== "number" || !(aspect > 0.2 && aspect < 5)) return "match_input_image";
  let best = RATIOS[0], gap = Infinity;
  for (const r of RATIOS) {
    const [w, h] = r.split(":").map(Number), d = Math.abs(Math.log(aspect / (w / h)));
    if (d < gap) { gap = d; best = r; }
  }
  return best;
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function replicate(url, init = {}) {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw Object.assign(new Error("REPLICATE_API_TOKEN is not set on the server."), { status: 500 });
  const res = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.detail || data.title || `Replicate error ${res.status}`), { status: 502 });
  return data;
}

async function finish(p, extra = {}) {
  if (p.status === "failed" || p.status === "canceled") return json({ status: p.status, error: p.error || "Generation failed.", ...extra });
  if (p.status !== "succeeded") return json({ id: p.id, status: p.status, ...extra });
  // The output URL is a short-lived link on another domain; hand the image itself to the browser
  // so it can be shown and downloaded without CORS trouble.
  const url = Array.isArray(p.output) ? p.output[0] : p.output;
  const img = await fetch(url);
  if (!img.ok) return json({ status: "failed", error: "Could not fetch the generated image." });
  const b64 = Buffer.from(await img.arrayBuffer()).toString("base64");
  return json({ id: p.id, status: "succeeded", image: `data:${img.headers.get("content-type") || "image/jpeg"};base64,${b64}`, ...extra });
}

async function start(req, context) {
  const { image, subjects, extra, robin, mode, aspect } = await req.json().catch(() => ({}));
  const knight = mode === "knight";
  const cleanSubjects = subjects && typeof subjects === "object" ? subjects : null;
  if (typeof image !== "string" || !/^data:image\/(jpeg|png|webp);base64,/.test(image)) {
    return json({ error: "Send a JPEG, PNG or WebP image as a data URL." }, 400);
  }
  if (image.length * 0.75 > MAX_IMAGE_BYTES) return json({ error: "Image is too large (max 4 MB)." }, 413);

  // Abuse protection: per-visitor limit plus a daily cap for everyone together (lib/rate-limit.mjs).
  const ip = clientIp(req, context);
  const slot = await takeSlot(ip);
  if (!slot.ok) {
    return json({
      error: slot.reason === "global"
        ? "Mutsify has made all its pictures for today. Please come back tomorrow."
        : `You can make ${LIMIT} pictures every ${WINDOW_MS / 3600000} hours.`,
      limited: true, reason: slot.reason, retryAt: slot.retryAt,
    }, 429);
  }
  let p;
  try {
    p = await replicate(MODEL_URL, {
      method: "POST",
      headers: { prefer: "wait=5" }, // short wait: often done already, and stays under serverless time limits
      body: JSON.stringify({
        input: {
          prompt: knight
            ? buildKnightPrompt(cleanSubjects, extra)
            : buildPrompt(cleanSubjects, extra, robin === true),
          images: robin === true && !knight ? [image, ROBIN_IMAGE] : [image],
          // "match_input_image" returns only ~0.25 megapixel; a fixed ratio gives the full 1 megapixel.
          aspect_ratio: nearestRatio(aspect),
          output_megapixels: "1",
          output_format: "jpg",
          output_quality: 90,
        },
      }),
    });
  } catch (err) {
    await giveBack(ip, slot.stamp).catch(() => {});   // never started, so it doesn't count
    throw err;
  }
  return finish(p, { remaining: slot.remaining });
}

async function poll(id) {
  if (!/^[a-z0-9]+$/i.test(id)) return json({ error: "Invalid id." }, 400);
  let p;
  try {
    p = await replicate(PREDICTION_URL + id);
  } catch (err) {
    // Replicate's lookup-by-id has been seen returning 503 for this model while the
    // prediction list works fine, so fall back to finding it in the recent list.
    const list = await replicate(PREDICTION_URL.replace(/\/$/, ""));
    p = (list.results || []).find(r => r.id === id);
    if (!p) throw err;
  }
  return finish(p);
}

export default async function handler(req, context) {
  try {
    if (req.method === "POST") return await start(req, context);
    if (req.method === "GET") {
      const id = new URL(req.url).searchParams.get("id");
      return id ? await poll(id) : json({ error: "Missing id." }, 400);
    }
    return json({ error: "Method not allowed." }, 405);
  } catch (err) {
    return json({ error: err.message }, err.status || 500);
  }
}

export const config = { path: "/api/funhouse" };
