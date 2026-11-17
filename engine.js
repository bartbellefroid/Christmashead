// Mutsify engine: finds human faces and animals (MediaPipe) so the AI prompt can name who is in the photo.
const TV = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const FACE_MODEL = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";
const OBJ_MODEL = "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/float16/1/efficientdet_lite2.tflite";
const ANIMALS = new Set(["bird","cat","dog","horse","sheep","cow","elephant","bear","zebra","giraffe","teddy bear"]);

let detectors = null;
// Works on the page and inside a Web Worker (where there is no document).
const mkCanvas = (w = 1, h = 1) => {
  if (typeof document !== "undefined") { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  return new OffscreenCanvas(w, h);
};

// ---------- random helpers ----------
const deg = d => d * Math.PI / 180;

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
    // If the face detector already found this animal's face, use it, and remember it is an
    // animal (the face model happily finds dog faces, which must not be counted as people).
    const face = out.find(h => !h.label && centerIn(h.box, a) && !people.some(p => centerIn(h.box, p)));
    if (face) { face.label = a.label; continue; }
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
