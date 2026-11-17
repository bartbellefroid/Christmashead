// Per-visitor limit: at most LIMIT generations per WINDOW, counted per IP address.
// On Netlify the counts live in Netlify Blobs (so they survive cold starts and are shared by all
// function instances); elsewhere (local dev) they live in memory.
// IP addresses are never stored as-is: only a salted SHA-256 hash is used as the key.
import { createHash } from "node:crypto";

export const LIMIT = Number(process.env.RATE_LIMIT) || 10;
export const WINDOW_MS = (Number(process.env.RATE_LIMIT_HOURS) || 5) * 60 * 60 * 1000;
const SALT = process.env.RATE_LIMIT_SALT || "mutsify-reindeer";

const memory = new Map();
const memoryStore = {
  async get(key) { return memory.get(key) ?? null; },
  async setJSON(key, value) { memory.set(key, value); },
};

let storePromise = null;
function getStoreOnce() {
  storePromise ??= (async () => {
    try {
      const { getStore } = await import("@netlify/blobs");
      const store = getStore({ name: "mutsify-rate-limit", consistency: "strong" });
      return {
        get: key => store.get(key, { type: "json" }),
        setJSON: (key, value) => store.setJSON(key, value),
      };
    } catch {
      return memoryStore;   // not on Netlify (or Blobs unavailable): in-memory fallback
    }
  })();
  return storePromise;
}

export function clientIp(req, context) {
  return context?.ip
    || req.headers.get("x-nf-client-connection-ip")
    || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim()
    || "unknown";
}

const keyFor = ip => createHash("sha256").update(`${SALT}:${ip}`).digest("hex").slice(0, 40);

async function load(store, key, now) {
  const data = await store.get(key).catch(() => null);
  return (Array.isArray(data?.times) ? data.times : []).filter(t => typeof t === "number" && t > now - WINDOW_MS);
}

/** Try to use one generation. Returns { ok, remaining, retryAt, stamp }. */
export async function takeSlot(ip) {
  const store = await getStoreOnce(), key = keyFor(ip), now = Date.now();
  const times = await load(store, key, now);
  if (times.length >= LIMIT) {
    return { ok: false, remaining: 0, retryAt: Math.min(...times) + WINDOW_MS };
  }
  times.push(now);
  await store.setJSON(key, { times });
  return { ok: true, remaining: LIMIT - times.length, stamp: now };
}

/** Give a slot back, e.g. when the generation could not even be started. */
export async function giveBack(ip, stamp) {
  const store = await getStoreOnce(), key = keyFor(ip);
  const times = await load(store, key, Date.now());
  const i = times.indexOf(stamp);
  if (i >= 0) { times.splice(i, 1); await store.setJSON(key, { times }); }
}
