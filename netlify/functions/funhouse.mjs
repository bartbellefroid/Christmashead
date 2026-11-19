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
// One short sentence each, in the same plain style as the rest of the prompt.
const EXTRAS = {
  hat: null,
  antlers: { text: "Each Santa hat also has a pair of small soft felt reindeer antlers in light brown sticking up from it." },
  scarf: { text: "Everyone also wears a cosy knitted Christmas scarf with red and green stripes, loosely around the neck." },
  cookie: { text: "Everyone also has a gingerbread man cookie with white icing: people hold it in a hand that is already in the picture, animals have it lying right in front of their paws." },
  candycane: { text: "Everyone also has a red-and-white striped candy cane: people hold it in a hand that is already in the picture, animals have it lying right in front of their paws." },
};

function totalHeads(subjects) {
  return Object.values(subjects).reduce((sum, n) => sum + n, 0);
}

// /robin: Robin (the robot in the second input image) joins every photo, close by like family.
const ROBIN_TEXT = [
  "Robin, the small white toy robot from the second image, joins the picture as the one new figure: one robot, close to the others",
  "like a member of the family posing with them, at a natural toy size, facing the camera, in the same lighting and focus.",
  "Robin looks exactly as in the second image and wears a Santa hat too.",
].join(" ");

// /ridder: everyone becomes a medieval knight. The colour dots pick the costume and helmet.
// All helmets are open-faced, so the face itself is never covered or changed.
const KNIGHT_STYLES = {
  plate: {
    costume: "polished silver steel plate armour with a royal-blue tabard",
    helmet: "a simple round shiny steel helmet that sits on top of the head like a cap, above the eyebrows, with a tall red feather plume on top",
  },
  guard: {
    costume: "a chainmail shirt under a red heraldic tabard showing a golden lion",
    helmet: "a round steel kettle-hat helmet with a wide brim, over a chainmail hood that frames the face",
  },
  forest: {
    costume: "dark green enamelled armour with bronze edges and a green hooded cloak",
    helmet: "a simple round bronze helmet that sits on top of the head like a cap, above the eyebrows, with a small crest of oak leaves",
  },
  king: {
    costume: "ornate golden armour with engraved patterns and a red velvet cape with white fur trim",
    helmet: "an open-faced golden helmet with a small royal crown on top",
  },
  tournament: {
    costume: "steel armour under a jousting tabard with purple and white stripes",
    helmet: "a simple round steel helmet that sits on top of the head like a cap, above the eyebrows, with large purple and white feather plumes",
  },
};

// Prompt style, tuned by hand by the site owner: short sentences that only say what we DO want to see
// (no "do not…", no talk about faces being changed: this model tends to draw whatever a prompt names),
// addressed to "every face of a person or animal in this picture".
const WHO = "For every face of a person or animal in this picture:";
const POSE_LINE = "exactly as it is posed right now: same position in the frame, same lean and head tilt, same arms and hand gestures, same expression, and they keep holding whatever they are holding.";
const SCENE_LINE = "The background, framing, lighting and photographic style stay exactly the same, and everything else in the picture stays as it is.";

function buildKnightPrompt(raw, styleName) {
  const subjects = normalise(raw);
  const style = KNIGHT_STYLES[styleName] || KNIGHT_STYLES.plate;
  const hasAnimals = Object.keys(subjects).some(k => k !== "person");
  return [
    `${WHO} dress them in ${style.costume}, and put ${style.helmet} around the head.`,
    "The helmet is open at the front.",
    hasAnimals ? "Animals stay the same animals: small ones such as dogs and cats wear a little helmet and a matching little armoured coat over their back, large ones such as horses and cows wear a decorated cloth over their body." : "",
    `The costume is fitted onto each body ${POSE_LINE}`,
    SCENE_LINE,
  ].filter(Boolean).join(" ");
}

function buildPrompt(raw, extraName, robin = false) {
  const subjects = normalise(raw);
  const extra = EXTRAS[extraName] || null;
  const who = describe(subjects);
  const n = totalHeads(subjects) + (robin ? 1 : 0);
  // One way of wearing it per head. Listing several ideas for a single head made the model merge
  // them into one hat (two tips, two pom-poms: a jester's hat).
  const ideas = shuffle([...HAT_IDEAS]).slice(0, Math.min(Math.max(n, 1), 3));
  return [
    `${WHO} put one classic red Santa Christmas hat with white fur trim and one white pom-pom on top of the head, above the eyebrows.`,
    who ? `That is exactly ${NUMBERS[n] || n} ${n === 1 ? "hat" : "hats"} in the picture${robin ? ", Robin's included" : ""}.` : "",
    ideas.length === 1 ? `The hat is worn ${ideas[0]}.` : `Each hat is worn differently, for example: ${ideas.join("; ")}.`,
    extra ? extra.text : "",
    robin ? ROBIN_TEXT : "",
    `${robin ? "Everyone already in the picture" : "Everyone"} stays ${POSE_LINE}`,
    SCENE_LINE,
  ].filter(Boolean).join(" ");
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
            ? buildKnightPrompt(cleanSubjects, Object.hasOwn(KNIGHT_STYLES, extra) ? extra : "plate")
            : buildPrompt(cleanSubjects, Object.hasOwn(EXTRAS, extra) ? extra : "hat", robin === true),
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
