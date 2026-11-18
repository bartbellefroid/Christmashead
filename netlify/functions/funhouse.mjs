// Mutsify AI edit (funny Santa hats, faces unchanged) via Replicate (black-forest-labs/flux-2-klein-4b).
// The Replicate token stays on the server: set REPLICATE_API_TOKEN in the hosting environment.
//
//   POST /api/funhouse  { image: "data:image/jpeg;base64,...", subjects?, extra? }  -> { id, status }
//        extra: "hat" (default) | "antlers" | "scarf" | "cookie" | "candycane" — chosen with the colour dots
//        robin: true — sent by the hidden /robin page: Robin the robot joins the photo
//   GET  /api/funhouse?id=<prediction id>                        -> { status, image?, error? }
//
// Generation takes longer than many serverless time limits, so the browser starts the
// prediction and then polls for the result.

import { takeSlot, giveBack, clientIp, LIMIT, WINDOW_MS } from "../../lib/rate-limit.mjs";
import { ROBIN_IMAGE } from "../../lib/robin-image.mjs";

const MODEL_URL = "https://api.replicate.com/v1/models/black-forest-labs/flux-2-klein-4b/predictions";
const PREDICTION_URL = "https://api.replicate.com/v1/predictions/";
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

// Ways to wear the hat. All of them stay above the eyes, so the face itself is never covered or changed.
// Variants that made the model draw a second tip or pom-pom (floppy bend, bell, extra long tail) are left out.
const HAT_IDEAS = [
  "tilted far to one side at a cheeky angle",
  "comically tiny and perched on the very top of the head",
  "worn backwards with the pom-pom dangling behind the head",
  "pushed far back on the head, as if it is about to slide off the back",
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

// Optional extra per colour dot on the page. "hat" (the default) adds nothing beyond the hat.
// `each` is the item counted per head, `keep` relaxes "keep the bodies unchanged" just enough for it.
const EXTRAS = {
  hat: null,
  antlers: {
    each: "pair of antlers",
    text: "On every Santa hat, also attach a pair of small soft felt reindeer antlers in light brown, sticking up from the hat.",
    keep: "",
  },
  scarf: {
    each: "scarf",
    text: "Also wrap a cosy knitted Christmas scarf with red and green stripes loosely around every neck, over the clothes or fur.",
    keep: " (apart from the scarf around the neck)",
  },
  cookie: {
    each: "gingerbread cookie",
    text: "Also give everyone a gingerbread man cookie with white icing, clearly visible: animals have it in their mouth or right in front of their paws; people hold it in a hand that is already visible in the photo, and anyone whose hands are not visible gets it tucked into the white fur brim of their hat. Never add extra hands or arms.",
    keep: " (apart from a hand or paws holding the cookie)",
  },
  candycane: {
    each: "candy cane",
    text: "Also give everyone a red-and-white striped candy cane, clearly visible: animals have it in their mouth or right in front of their paws; people hold it in a hand that is already visible in the photo, and anyone whose hands are not visible gets it hooked over the white fur brim of their hat. Never add extra hands or arms.",
    keep: " (apart from a hand or paws holding the candy cane)",
  },
};

function totalHeads(subjects) {
  return Object.values(subjects).reduce((sum, n) => sum + n, 0);
}

// /robin: Robin (the robot in the second input image) joins every photo, close by like family.
const ROBIN_TEXT = [
  "The second image shows Robin, a small friendly toy robot. Add Robin into the first photo as one extra member of the group:",
  "close to the others, like a beloved family member posing with them (for example right beside or in front of them,",
  "leaning in or snuggled up), at a natural size compared to them, facing the camera, in the same lighting, perspective and focus as the photo.",
  "Robin keeps exactly the look from the second image: smooth glossy white body and round head, one big blue eye,",
  "a small smile, an antenna with a blue ball, short dark-blue arms with white hands, three small coloured buttons",
  "(green, blue, orange) and a dark-blue base. Robin also wears a Santa hat, sized to his round head, above his eye.",
].join(" ");

function buildPrompt(raw, extraName, robin = false) {
  const subjects = normalise(raw);
  const extra = EXTRAS[extraName] || null;
  const who = describe(subjects);
  const n = totalHeads(subjects) + (robin ? 1 : 0);
  // One way of wearing it per head. Listing several ideas for a single head made the model merge
  // them into one hat (two tips, two pom-poms: a jester's hat).
  const ideas = shuffle([...HAT_IDEAS]).slice(0, Math.min(Math.max(n, 1), 3));
  const kinds = Object.keys(subjects);
  const hasPeople = kinds.includes("person");
  const hasAnimals = kinds.some(k => k !== "person");
  return [
    "Add a red Santa Christmas hat with white fur trim and a pom-pom on top of each head in this photo.",
    extra ? "Change nothing else apart from the one extra described below." : "Change nothing else.",
    who ? `The photo shows exactly ${who}${robin ? ", plus Robin who joins them" : ""}, so add exactly ${NUMBERS[n] || n} Santa ${n === 1 ? "hat" : "hats"} in total: one hat per head, never more.`
        : "Every head or face in the photo gets one hat (people, animals, toys, figures, drawings), never more than one per head.",
    "Only on heads: no hats on backs, tails, bodies, objects or the background, and no second hat on any head.",
    "Each hat is sized to fit its head and sits on top of it: the white brim rests on the upper part of the head,",
    "with the whole face still fully visible below the brim, exactly as it was.",
    "Keep every face exactly the same as in the original photo: same face shape, eyes, expression, mouth,",
    "skin, fur, colours and identity. Do not retouch, stylise, warp or redraw any face.",
    hasAnimals ? "Animals stay exactly the same animals, with their own unchanged heads." : "",
    who && !hasPeople ? "There are no people in this photo: do not add any human face or human features." : "",
    robin ? ROBIN_TEXT : "",
    robin ? "Apart from Robin, do not add any extra heads, faces, people or animals." : "Do not add any extra heads, faces, people or animals.",
    "Every hat is one classic Santa hat: a single soft cone that ends in one point with one white pom-pom.",
    ideas.length === 1
      ? `Make it funny only through how the hat is worn: ${ideas[0]}.`
      : `Make it funny only through how each hat is worn, each one differently, for example: ${ideas.join("; ")}.`,
    "The hats sit naturally on the heads with matching lighting and shadows.",
    extra ? extra.text : "",
    extra && who ? `That is exactly ${NUMBERS[n] || n} ${n === 1 ? extra.each : extra.each + "s"} in total, one each${robin ? ", Robin included" : ""}.` : "",
    `Keep the background, the bodies, arms, legs, clothing${extra ? extra.keep : ""} and the photographic style unchanged.`,
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
  const { image, subjects, extra, robin } = await req.json().catch(() => ({}));
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
          prompt: buildPrompt(subjects && typeof subjects === "object" ? subjects : null, Object.hasOwn(EXTRAS, extra) ? extra : "hat", robin === true),
          images: robin === true ? [image, ROBIN_IMAGE] : [image],
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
