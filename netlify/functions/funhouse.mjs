// Mutsify AI edit (funny Santa hats, faces unchanged) via Replicate (black-forest-labs/flux-2-klein-4b).
// The Replicate token stays on the server: set REPLICATE_API_TOKEN in the hosting environment.
//
//   POST /api/funhouse  { image: "data:image/jpeg;base64,..." }  -> { id, status }
//   GET  /api/funhouse?id=<prediction id>                        -> { status, image?, error? }
//
// Generation takes longer than many serverless time limits, so the browser starts the
// prediction and then polls for the result.

import { takeSlot, giveBack, clientIp, LIMIT, WINDOW_MS } from "../../lib/rate-limit.mjs";

const MODEL_URL = "https://api.replicate.com/v1/models/black-forest-labs/flux-2-klein-4b/predictions";
const PREDICTION_URL = "https://api.replicate.com/v1/predictions/";
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

// Ways to wear the hat. All of them stay above the eyes, so the face itself is never covered or changed.
const HAT_IDEAS = [
  "tilted far to one side at a cheeky angle",
  "slightly too big, slipping down to just above the eyebrows",
  "comically tiny and perched on the very top of the head",
  "extra tall and floppy, bending over to one side",
  "worn backwards with the pom-pom dangling behind the head",
  "cocked to one side with a little jingle bell instead of a pom-pom",
  "with an extra long tail hanging down behind the head",
];

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

function totalHeads(subjects) {
  return Object.values(subjects).reduce((sum, n) => sum + n, 0);
}

function buildPrompt(raw) {
  const subjects = normalise(raw);
  const ideas = shuffle([...HAT_IDEAS]).slice(0, 3);
  const who = describe(subjects);
  const n = totalHeads(subjects);
  const kinds = Object.keys(subjects);
  const hasPeople = kinds.includes("person");
  const hasAnimals = kinds.some(k => k !== "person");
  return [
    "Add a red Santa Christmas hat with white fur trim and a pom-pom on top of each head in this photo. Change nothing else.",
    who ? `The photo shows exactly ${who}, so add exactly ${NUMBERS[n] || n} Santa ${n === 1 ? "hat" : "hats"} in total: one hat per head, never more.`
        : "Exactly one hat per head, never more.",
    "Only on heads: no hats on backs, tails, bodies, objects or the background, and no second hat on any head.",
    "Each hat sits on top of the head, above the eyes: it must not cover the eyes or any part of the face.",
    "Keep every face exactly the same as in the original photo: same face shape, eyes, expression, mouth,",
    "skin, fur, colours and identity. Do not retouch, stylise, warp or redraw any face.",
    hasAnimals ? "Animals stay exactly the same animals, with their own unchanged heads." : "",
    who && !hasPeople ? "There are no people in this photo: do not add any human face or human features." : "",
    "Do not add any extra heads, faces, people or animals.",
    "Make it funny only through how each hat is worn, each one differently,",
    `for example: ${ideas.join("; ")}.`,
    "The hats sit naturally on the heads with matching lighting and shadows.",
    "Keep the background, the bodies, the clothing and the photographic style unchanged.",
  ].filter(Boolean).join(" ");
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
  const { image, subjects } = await req.json().catch(() => ({}));
  if (typeof image !== "string" || !/^data:image\/(jpeg|png|webp);base64,/.test(image)) {
    return json({ error: "Send a JPEG, PNG or WebP image as a data URL." }, 400);
  }
  if (image.length * 0.75 > MAX_IMAGE_BYTES) return json({ error: "Image is too large (max 4 MB)." }, 413);

  // Abuse protection: LIMIT generations per WINDOW per visitor (by IP address).
  const ip = clientIp(req, context);
  const slot = await takeSlot(ip);
  if (!slot.ok) {
    return json({
      error: `You can make ${LIMIT} pictures every ${WINDOW_MS / 3600000} hours.`,
      limited: true, retryAt: slot.retryAt,
    }, 429);
  }
  let p;
  try {
    p = await replicate(MODEL_URL, {
      method: "POST",
      headers: { prefer: "wait=5" }, // short wait: often done already, and stays under serverless time limits
      body: JSON.stringify({
        input: {
          prompt: buildPrompt(subjects && typeof subjects === "object" ? subjects : null),
          images: [image],
          aspect_ratio: "match_input_image",
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
