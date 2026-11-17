// Mutsify engine: face/animal detection (MediaPipe) and procedurally drawn Santa hats.
const TV = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const FACE_MODEL = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";
const OBJ_MODEL = "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/float16/1/efficientdet_lite2.tflite";
const ANIMALS = new Set(["bird","cat","dog","horse","sheep","cow","elephant","bear","zebra","giraffe","teddy bear"]);
const MAX_SIDE = 1800;

let detectors = null;
// Works on the page and inside a Web Worker (where there is no document).
const mkCanvas = (w = 1, h = 1) => {
  if (typeof document !== "undefined") { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  return new OffscreenCanvas(w, h);
};
let canvasSize = { width: 1000, height: 1000 };
export function setCanvasSize(w, h) { canvasSize = { width: w, height: h }; }

// ---------- random helpers ----------
const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const sign = () => (Math.random() < 0.5 ? -1 : 1);
const deg = d => d * Math.PI / 180;
export function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function seeded(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }

// ---------- models ----------
export async function loadDetectors(onStatus = () => {}, preferGPU = true) {
  if (detectors) return detectors;
  onStatus("Waking up the hat elves… (first time downloads ~13 MB of models)");
  const { FilesetResolver, FaceDetector, ObjectDetector } = await import(`${TV}/vision_bundle.mjs`);
  const fileset = await FilesetResolver.forVisionTasks(`${TV}/wasm`);
  const make = async (delegate) => Promise.all([
    FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: FACE_MODEL, delegate }, runningMode: "IMAGE", minDetectionConfidence: 0.5,
    }),
    ObjectDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: OBJ_MODEL, delegate }, runningMode: "IMAGE", scoreThreshold: 0.3, maxResults: 25,
    }),
  ]);
  let face, obj;
  if (!preferGPU) [face, obj] = await make("CPU");
  else try { [face, obj] = await make("GPU"); } catch (e) { [face, obj] = await make("CPU"); }
  detectors = { face, obj };
  return detectors;
}

// ---------- detection ----------
function iou(a, b) {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a.w * a.h + b.w * b.h - inter);
}
const centerIn = (a, b) => {
  const cx = a.x + a.w / 2, cy = a.y + a.h / 2;
  return cx > b.x && cx < b.x + b.w && cy > b.y && cy < b.y + b.h;
};

async function detectFaces(src) {
  // The short-range face model works best on close-ups, so also scan overlapping tiles
  // to find smaller faces in group photos.
  const W = src.width, H = src.height, found = [];
  const tile = mkCanvas(), tctx = tile.getContext("2d");
  for (const n of [1, 2, 3]) {
    if (n > 1 && Math.min(W, H) / n < 160) break;
    const tw = Math.min(W, Math.round(W / n * 1.35)), th = Math.min(H, Math.round(H / n * 1.35));
    const stepsX = n === 1 ? [0] : [...Array(n)].map((_, i) => Math.round(i * (W - tw) / (n - 1)));
    const stepsY = n === 1 ? [0] : [...Array(n)].map((_, i) => Math.round(i * (H - th) / (n - 1)));
    for (const ox of stepsX) for (const oy of stepsY) {
      tile.width = tw; tile.height = th;
      tctx.drawImage(src, ox, oy, tw, th, 0, 0, tw, th);
      await new Promise(r => setTimeout(r, 16));   // let animations breathe between tiles
      const res = detectors.face.detect(tile);
      for (const d of res.detections) {
        const score = d.categories[0]?.score ?? 0;
        if (score < (n > 1 ? 0.7 : 0.6)) continue;
        const b = d.boundingBox;
        const kp = (d.keypoints || []).map(p => ({ x: ox + p.x * tw, y: oy + p.y * th }));
        if (location.hash === "#debug") console.debug("face", n, score.toFixed(2), Math.round(ox + b.originX), Math.round(oy + b.originY));
        found.push({ x: ox + b.originX, y: oy + b.originY, w: b.width, h: b.height, score, kp });
      }
    }
  }
  // non-maximum suppression
  found.sort((a, b) => b.score - a.score);
  const keep = [];
  for (const f of found) if (!keep.some(k => iou(k, f) > 0.25 || centerIn(f, k))) keep.push(f);
  return keep;
}

function detailMap(src, box, G) {
  // Gradient energy of the animal's box on a small grid. Eyes, nose and ears carry a lot
  // of fine detail compared with fur or grass, so the head is usually the "busiest" spot.
  const gw = box.w >= box.h ? G : Math.max(8, Math.round(G * box.w / box.h));
  const gh = box.w >= box.h ? Math.max(8, Math.round(G * box.h / box.w)) : G;
  const s = mkCanvas(gw + 1, gh + 1);
  const c = s.getContext("2d", { willReadFrequently: true });
  c.drawImage(src, box.x, box.y, box.w, box.h, 0, 0, gw + 1, gh + 1);
  const px = c.getImageData(0, 0, gw + 1, gh + 1).data, lum = i => px[i] * .3 + px[i + 1] * .59 + px[i + 2] * .11;
  const E = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const i = (y * (gw + 1) + x) * 4, l = lum(i);
    E[y * gw + x] = Math.abs(l - lum(i + 4)) + Math.abs(l - lum(i + (gw + 1) * 4));
  }
  return { E, gw, gh };
}

function findHeadWindow(src, box, frac, endsOnly = false) {
  // Slide a square window (size = frac of the box's short side) and keep the busiest one,
  // with a mild preference for windows near the top. Returns the window in image px.
  const { E, gw, gh } = detailMap(src, box, 48);
  const k = Math.max(3, Math.round(Math.min(gw, gh) * frac));
  const I = new Float32Array((gw + 1) * (gh + 1));
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++)
    I[(y + 1) * (gw + 1) + x + 1] = E[y * gw + x] + I[y * (gw + 1) + x + 1] + I[(y + 1) * (gw + 1) + x] - I[y * (gw + 1) + x];
  let best = -1, bx = 0, by = 0;
  for (let y = 0; y + k <= gh; y++) for (let x = 0; x + k <= gw; x++) {
    if (endsOnly && x > 1 && x + k < gw - 1) continue;
    const sum = I[(y + k) * (gw + 1) + x + k] - I[y * (gw + 1) + x + k] - I[(y + k) * (gw + 1) + x] + I[y * (gw + 1) + x];
    const score = sum * (1 - (endsOnly ? 0.2 : 0.45) * y / Math.max(1, gh - k));
    if (score > best) { best = score; bx = x; by = y; }
  }
  const sx = box.w / gw, sy = box.h / gh;
  return { x: box.x + bx * sx, y: box.y + by * sy, w: k * sx, h: k * sy };
}

export async function detectHeads(src) {
  const faces = await detectFaces(src);
  await new Promise(r => setTimeout(r, 16));
  const objs = detectors.obj.detect(src).detections.map(d => ({
    label: d.categories[0].categoryName, score: d.categories[0].score,
    x: d.boundingBox.originX, y: d.boundingBox.originY, w: d.boundingBox.width, h: d.boundingBox.height,
  }));
  const people = objs.filter(o => o.label === "person" && o.score > 0.45);
  let animals = objs.filter(o => ANIMALS.has(o.label));
  animals.sort((a, b) => b.score - a.score);
  animals = animals.filter((a, i) => !animals.slice(0, i).some(b => iou(a, b) > 0.55));

  const out = [];
  for (const f of faces) {
    // A "face" low down inside a person's box (a knee, a shirt logo…) is a false alarm.
    const fcx = f.x + f.w / 2, fcy = f.y + f.h / 2;
    const inPerson = people.filter(p => fcx > p.x && fcx < p.x + p.w && fcy > p.y && fcy < p.y + p.h);
    if (inPerson.length && inPerson.every(p => fcy > p.y + Math.max(p.h * 0.4, p.w * 0.6))) continue;
    let roll = 0;
    if (f.kp.length >= 2) {
      let [a, b] = [f.kp[0], f.kp[1]];
      if (a.x > b.x) [a, b] = [b, a];
      roll = Math.atan2(b.y - a.y, b.x - a.x);
    }
    out.push({ kind: "face", cx: f.x + f.w / 2, cy: f.y + f.h / 2, fw: f.w, fh: f.h, roll, box: f });
  }
  for (const a of animals) {
    // If the face detector already found this animal's face, it is better than our guess.
    if (out.some(h => centerIn(h.box, a) && !people.some(p => centerIn(h.box, p)))) continue;
    out.push(animalHead(src, a));
  }
  for (const p of people) {
    // People seen from behind / too small: hat on top of the person box.
    if (out.some(h => centerIn(h.box, p) || iou(h.box, p) > 0.3)) continue;
    const hw = Math.min(p.w * 0.38, p.h * 0.28);
    if (hw < 12) continue;
    const box = { x: p.x + p.w / 2 - hw / 2, y: p.y, w: hw, h: hw * 1.2 };
    out.push({ kind: "guess", cx: box.x + hw / 2, cy: p.y + hw * 0.95, fw: hw, fh: hw * 1.1, roll: 0, box });
  }
  return out;
}

function animalFace(src, a) {
  // The human face model often still finds dog/cat/cow faces when it gets a close, square crop.
  const side = Math.max(a.w, a.h), c = mkCanvas(256, 256);
  const g = c.getContext("2d"), k = 256 / side;
  g.fillStyle = "#808080"; g.fillRect(0, 0, 256, 256);
  const ox = (side - a.w) / 2, oy = (side - a.h) / 2;
  g.drawImage(src, a.x, a.y, a.w, a.h, ox * k, oy * k, a.w * k, a.h * k);
  let best = null;
  for (const d of detectors.face.detect(c).detections) {
    const score = d.categories[0]?.score ?? 0, b = d.boundingBox;
    if (score < 0.5 || b.width < 256 * 0.12 || (best && best.score > score)) continue;
    best = { score, x: a.x - ox + b.originX / k, y: a.y - oy + b.originY / k, w: b.width / k, h: b.height / k };
  }
  return best;
}

function animalHead(src, a) {
  const f = animalFace(src, a);
  if (f) return { kind: "face", label: a.label, cx: f.x + f.w / 2, cy: f.y + f.h / 2, fw: f.w * 1.05, fh: f.h, roll: 0, box: f };
  const aspect = a.w / a.h;
  const frac = aspect > 1.4 ? 0.62 : 0.5;     // side-on animals: head is a bigger share of the height
  const win = findHeadWindow(src, a, frac, aspect > 1.4);
  const hw = Math.min(win.w, win.h);
  const cx = win.x + win.w / 2;
  // tilt a little towards the outside of the body for side-on animals
  const roll = aspect > 1.4 ? Math.sign(cx - (a.x + a.w / 2)) * deg(8) : 0;
  const box = { x: cx - hw / 2, y: win.y, w: hw, h: hw };
  return { kind: "animal", label: a.label, cx, cy: win.y + hw * 0.55, fw: hw * 0.95, fh: hw, roll, box };
}

// ---------- hat geometry & drawing ----------
const COLORS = [
  ["#d4142f", "#8e0a1e"], ["#d4142f", "#8e0a1e"], ["#d4142f", "#8e0a1e"], ["#d4142f", "#8e0a1e"],
  ["#1c8a4a", "#0d5229"], ["#2357c6", "#132f73"], ["#e0a21b", "#9a6a07"], ["#e04f9a", "#9b2463"], ["#7a3fc4", "#45207a"],
];

function hatOutline(h) {
  // Local coordinates: brim centre at (0,0), "up" is -y, units in px.
  const w = h.w, P0 = { x: 0, y: -0.08 * w };
  const C = { x: h.ctrl[0] * w * h.dir, y: h.ctrl[1] * w };
  const T = { x: h.tip[0] * w * h.dir, y: h.tip[1] * w };
  const N = 40, left = [], right = [], spine = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, u = 1 - t;
    const p = { x: u * u * P0.x + 2 * u * t * C.x + t * t * T.x, y: u * u * P0.y + 2 * u * t * C.y + t * t * T.y };
    const d = { x: 2 * u * (C.x - P0.x) + 2 * t * (T.x - C.x), y: 2 * u * (C.y - P0.y) + 2 * t * (T.y - C.y) };
    const len = Math.hypot(d.x, d.y) || 1, n = { x: -d.y / len, y: d.x / len };
    const hw = w * (0.42 * Math.pow(1 - t, 0.85) + 0.035);
    spine.push(p); left.push({ x: p.x + n.x * hw, y: p.y + n.y * hw }); right.push({ x: p.x - n.x * hw, y: p.y - n.y * hw });
  }
  return { left, right, spine, tip: T };
}

export function drawHat(c, h) {
  const { left, right, tip } = hatOutline(h);
  const w = h.w, rnd = seeded(h.seed);
  c.save();
  c.translate(h.x, h.y); c.rotate(h.angle);
  c.shadowColor = "rgba(0,0,0,.28)"; c.shadowBlur = w * 0.08; c.shadowOffsetY = w * 0.03;

  // cone
  const g = c.createLinearGradient(-w * 0.5, 0, w * 0.5, 0);
  g.addColorStop(0, h.color[1]); g.addColorStop(0.45, h.color[0]); g.addColorStop(1, h.color[1]);
  c.beginPath(); c.moveTo(left[0].x, left[0].y);
  for (const p of left) c.lineTo(p.x, p.y);
  for (let i = right.length - 1; i >= 0; i--) c.lineTo(right[i].x, right[i].y);
  c.closePath(); c.fillStyle = g; c.fill();
  c.shadowColor = "transparent";

  if (h.stripes) {
    c.fillStyle = "rgba(255,255,255,.92)";
    for (let i = 3; i < left.length - 3; i += 6) {
      c.beginPath(); c.moveTo(left[i].x, left[i].y); c.lineTo(left[i + 2].x, left[i + 2].y);
      c.lineTo(right[i + 2].x, right[i + 2].y); c.lineTo(right[i].x, right[i].y); c.closePath(); c.fill();
    }
  }
  // subtle highlight along one side
  c.strokeStyle = "rgba(255,255,255,.18)"; c.lineWidth = w * 0.03; c.beginPath();
  left.slice(2, 30).forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)); c.stroke();

  // fluffy brim: soft base band plus lots of small overlapping tufts
  const bh = w * 0.21;
  c.shadowColor = "rgba(0,0,0,.25)"; c.shadowBlur = w * 0.05; c.shadowOffsetY = w * 0.02;
  const base = c.createLinearGradient(0, -bh / 2, 0, bh / 2);
  base.addColorStop(0, "#ffffff"); base.addColorStop(1, "#ddd6cf");
  c.fillStyle = base; roundRect(c, -w / 2, -bh / 2, w, bh, bh / 2); c.fill();
  c.shadowColor = "transparent";
  for (let i = 0; i < 70; i++) {
    const x = -w / 2 + bh * 0.3 + rnd() * (w - bh * 0.6);
    const y = (rnd() - 0.5) * bh * 0.6, r = bh * (0.12 + rnd() * 0.12);
    const shade = 232 + Math.floor(rnd() * 23);
    c.fillStyle = `rgba(${shade},${shade - 3},${shade - 6},.6)`;
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  }

  // pom-pom or bell
  const pr = w * 0.13 * h.pom;
  if (h.bell) {
    const bg = c.createRadialGradient(tip.x - pr * 0.3, tip.y - pr * 0.3, pr * 0.1, tip.x, tip.y, pr * 1.1);
    bg.addColorStop(0, "#fff3b0"); bg.addColorStop(0.5, "#f2c230"); bg.addColorStop(1, "#a87a06");
    c.fillStyle = bg; c.beginPath(); c.arc(tip.x, tip.y + pr * 0.3, pr, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#5a3f00"; c.beginPath(); c.arc(tip.x, tip.y + pr * 0.75, pr * 0.18, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "#5a3f00"; c.lineWidth = pr * 0.1; c.beginPath();
    c.moveTo(tip.x, tip.y + pr * 0.75); c.lineTo(tip.x, tip.y + pr * 1.2); c.stroke();
  } else {
    const pg0 = c.createRadialGradient(tip.x - pr * 0.3, tip.y - pr * 0.3, pr * 0.1, tip.x, tip.y, pr);
    pg0.addColorStop(0, "#ffffff"); pg0.addColorStop(1, "#d6cec6");
    c.fillStyle = pg0; c.beginPath(); c.arc(tip.x, tip.y, pr, 0, Math.PI * 2); c.fill();
    for (let i = 0; i < 18; i++) {
      const a = rnd() * Math.PI * 2, d = pr * (0.55 + 0.4 * rnd());
      const x = tip.x + Math.cos(a) * d, y = tip.y + Math.sin(a) * d, r = pr * (0.18 + rnd() * 0.15);
      const pg = c.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
      pg.addColorStop(0, "#ffffff"); pg.addColorStop(1, "#d9d2cb");
      c.fillStyle = pg; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    }
  }
  c.restore();
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}

export function localBounds(h) {
  const { left, right, tip } = hatOutline(h);
  const pts = [...left, ...right, { x: -h.w / 2, y: -h.w * 0.15 }, { x: h.w / 2, y: h.w * 0.15 }];
  const pr = h.w * 0.13 * h.pom * 1.1;
  pts.push({ x: tip.x - pr, y: tip.y - pr }, { x: tip.x + pr, y: tip.y + pr * 1.5 });
  return {
    x0: Math.min(...pts.map(p => p.x)), x1: Math.max(...pts.map(p => p.x)),
    y0: Math.min(...pts.map(p => p.y)), y1: Math.max(...pts.map(p => p.y)),
  };
}
export function toLocal(h, x, y) {
  const dx = x - h.x, dy = y - h.y, c = Math.cos(-h.angle), s = Math.sin(-h.angle);
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}
function tipWorld(h) {
  const { tip } = hatOutline(h), c = Math.cos(h.angle), s = Math.sin(h.angle);
  return { x: h.x + tip.x * c - tip.y * s, y: h.y + tip.x * s + tip.y * c };
}

// ---------- the funny part: placement styles ----------
export const STYLES = ["jaunty", "floppy", "sliding", "tiny", "tower", "eyepatch", "stack", "giant", "backwards"];

function baseHat(x, y, w, angle) {
  return {
    x, y, w, angle, dir: sign(), ctrl: [0.05, -0.75], tip: [0.55, -1.15],
    color: pick(COLORS), stripes: Math.random() < 0.22, bell: Math.random() < 0.18,
    pom: rand(0.9, 1.25), seed: Math.floor(Math.random() * 1e9),
  };
}

export function hatsForHead(head, style) {
  const up = { x: Math.sin(head.roll), y: -Math.cos(head.roll) };
  const right = { x: Math.cos(head.roll), y: Math.sin(head.roll) };
  const lift = head.kind === "face" ? head.fh * 0.88 : head.fh * 0.5;
  let x = head.cx + up.x * lift, y = head.cy + up.y * lift;
  let w = head.fw * (head.kind === "face" ? 1.35 : 1.05);
  const h = baseHat(x, y, w, head.roll);
  const d = h.dir;
  const shift = (r, u) => { h.x += right.x * r + up.x * u; h.y += right.y * r + up.y * u; };

  switch (style) {
    case "jaunty":    // classic, cheeky tilt with a drooping tail
      h.angle += d * deg(rand(12, 22));
      h.tip = [rand(0.6, 0.95), rand(-1.0, -0.75)]; h.ctrl = [0.1, -1.05];
      shift(d * w * 0.08, 0);
      break;
    case "floppy":    // extra long tail flopping down beside the face
      h.angle += d * deg(rand(4, 10));
      h.ctrl = [0.2, -1.25]; h.tip = [rand(0.95, 1.15), rand(-0.1, 0.35)];
      break;
    case "sliding":   // about to slide off the head
      h.angle += d * deg(rand(30, 42));
      shift(d * w * 0.25, -w * 0.06);
      h.tip = [0.35, -1.25]; h.ctrl = [0, -0.8];
      break;
    case "tiny":      // comically small hat perched on one side
      h.w = w * rand(0.38, 0.48);
      h.angle += d * deg(rand(15, 28));
      shift(d * w * 0.22, -w * 0.02);
      h.tip = [0.15, -1.7]; h.ctrl = [0, -1.0];
      break;
    case "tower":     // ridiculously tall, slightly wobbly
      h.angle += d * deg(rand(3, 9));
      h.ctrl = [-0.25, -1.6]; h.tip = [rand(0.3, 0.6), rand(-2.9, -2.4)];
      h.stripes = Math.random() < 0.6;
      break;
    case "eyepatch":  // pulled down over one eye
      if (head.kind !== "face") return hatsForHead(head, "jaunty");
      shift(d * w * 0.06, -head.fh * 0.3);
      h.angle += d * deg(rand(22, 30)); h.w = w * 1.08;
      h.tip = [0.75, -0.85]; h.ctrl = [0.1, -1.0];
      break;
    case "stack": {   // hat-ception: a tiny hat on the tip of a hat
      h.angle += d * deg(rand(6, 14));
      h.tip = [0.25, -1.3]; h.ctrl = [0, -0.8]; h.bell = false;
      const t = tipWorld(h);
      const top = baseHat(t.x, t.y + w * 0.04, w * 0.42, h.angle - d * deg(rand(18, 30)));
      top.tip = [0.6, -1.0]; top.ctrl = [0.1, -1.0];
      return [h, top];
    }
    case "giant":     // way too big for this head
      h.w = w * rand(1.45, 1.7);
      shift(0, -w * 0.05);
      h.angle += d * deg(rand(6, 12));
      h.ctrl = [0.25, -1.15]; h.tip = [rand(0.85, 1.05), rand(-0.45, -0.2)];
      break;
    case "backwards": // tilted back on the head, tail pointing behind
      h.angle -= d * deg(rand(18, 26));
      h.ctrl = [-0.5, -0.9]; h.tip = [rand(-1.1, -0.85), rand(-0.6, -0.3)];
      shift(-d * w * 0.1, 0);
      break;
  }
  return [h];
}

function topOf(h) {
  const b = localBounds(h), c = Math.cos(h.angle), s = Math.sin(h.angle);
  return Math.min(...[[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]].map(([x, y]) => h.y + x * s + y * c));
}

export function keepVisible(list) {
  // Close-ups (a face filling the whole photo) would get a hat bigger than the picture.
  const maxW = Math.min(canvasSize.width, canvasSize.height) * 0.5;
  if (list[0].w > maxW) {
    const k = maxW / list[0].w, ax = list[0].x, ay = list[0].y;
    list.forEach(o => { o.w *= k; o.x = ax + (o.x - ax) * k; o.y = ay + (o.y - ay) * k; });
  }
  // A tall hat poking out of the top of the photo looks like a bucket, so let it flop over instead.
  if (list.length === 1 && topOf(list[0]) < 0) {
    const h = list[0];
    h.ctrl = [0.25, -1.0]; h.tip = [rand(0.95, 1.1), rand(-0.15, 0.2)];
  }
  for (const h of list) {
    const minY = h.w * 0.3;
    if (h.y < minY) { const dy = minY - h.y; list.forEach(o => { o.y += dy; }); }
  }
  return list;
}

