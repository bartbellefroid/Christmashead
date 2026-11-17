// Abuse protection for the paid AI generations.
//
// 1. Per visitor: at most LIMIT generations per WINDOW. Visitors are identified by IP address; IPv6
//    addresses are grouped per /64 network (one home connection usually owns a whole /64, so
//    rotating addresses inside it must not give a fresh counter).
// 2. For everyone together: at most GLOBAL_DAILY_LIMIT generations per UTC day, so many different
//    addresses (VPNs, botnets) can't run up unlimited costs either.
//
// Counts are updated with compare-and-swap (write only if nothing changed since we read it, else
// retry), so a burst of simultaneous requests can't all slip through. On Netlify the counts live in
// Netlify Blobs; locally they live in memory. IPs are only stored as a salted SHA-256 hash; set a
// secret RATE_LIMIT_SALT in the hosting environment so those hashes can't be reversed.
import { createHash } from "node:crypto";

export const LIMIT = Number(process.env.RATE_LIMIT) || 10;
export const WINDOW_MS = (Number(process.env.RATE_LIMIT_HOURS) || 5) * 60 * 60 * 1000;
export const GLOBAL_DAILY_LIMIT = Number(process.env.GLOBAL_DAILY_LIMIT) || 300;
const SALT = process.env.RATE_LIMIT_SALT || "mutsify-reindeer";
const MAX_ATTEMPTS = 12;

// ---------- storage with compare-and-swap ----------
// read(key)  -> { data, etag } | null
// write(key, data, etag|null) -> true if written, false if someone else wrote first

function memoryStore() {
  const entries = new Map();          // key -> { data, version }
  return {
    async read(key) {
      const e = entries.get(key);
      return e ? { data: structuredClone(e.data), etag: String(e.version) } : null;
    },
    async write(key, data, etag) {
      const e = entries.get(key);     // check-and-set happens synchronously: atomic in one process
      if (etag === null ? e : !e || String(e.version) !== etag) return false;
      entries.set(key, { data: structuredClone(data), version: (e?.version || 0) + 1 });
      return true;
    },
  };
}

let storePromise = null;
function getStoreOnce() {
  storePromise ??= (async () => {
    try {
      const { getStore } = await import("@netlify/blobs");
      const store = getStore({ name: "mutsify-rate-limit", consistency: "strong" });
      return {
        async read(key) {
          const r = await store.getWithMetadata(key, { type: "json" });
          return r ? { data: r.data, etag: r.etag } : null;
        },
        async write(key, data, etag) {
          const r = await store.setJSON(key, data, etag === null ? { onlyIfNew: true } : { onlyIfMatch: etag });
          return r.modified;
        },
      };
    } catch {
      return memoryStore();            // @netlify/blobs missing or no Netlify environment: local dev
    }
  })();
  return storePromise;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Atomically update one entry. `change(data)` gets the current value (or null) and returns
 * { data, result } to write, or { result } to leave it alone. Retries when another request wrote
 * in between. Fails closed: if it can't get a clean write it throws, so the request is refused.
 */
async function update(key, change) {
  const store = await getStoreOnce();
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const current = await store.read(key);
    const out = change(current ? current.data : null);
    if (!("data" in out)) return out.result;
    if (await store.write(key, out.data, current ? current.etag : null)) return out.result;
    await sleep(15 + Math.random() * 40 * (attempt + 1));
  }
  throw Object.assign(new Error("Mutsify is very busy right now, please try again in a moment."), { status: 503 });
}

// ---------- who is the visitor ----------
export function clientIp(req, context) {
  return context?.ip
    || req.headers.get("x-nf-client-connection-ip")
    || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim()
    || "unknown";
}

/** IPv4 as-is; IPv6 reduced to its /64 network (the part a single connection usually owns). */
export function networkOf(ip) {
  let a = String(ip).trim().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return mapped[1];
  if (!a.includes(":")) return a;
  const [head, tail = ""] = a.split("::");
  const h = head ? head.split(":") : [], t = tail ? tail.split(":") : [];
  const full = a.includes("::") ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  return full.slice(0, 4).map(x => (parseInt(x, 16) || 0).toString(16)).join(":") + "::/64";
}

const visitorKey = ip => "v-" + createHash("sha256").update(`${SALT}:${networkOf(ip)}`).digest("hex").slice(0, 40);
const dayOf = t => new Date(t).toISOString().slice(0, 10);
const nextUtcMidnight = t => { const d = new Date(t); d.setUTCHours(24, 0, 0, 0); return d.getTime(); };

// ---------- public API ----------

/**
 * Try to use one generation.
 * Returns { ok: true, remaining, stamp } or { ok: false, reason: "visitor" | "global", retryAt }.
 */
export async function takeSlot(ip) {
  const now = Date.now(), key = visitorKey(ip);

  const mine = await update(key, data => {
    const times = (Array.isArray(data?.times) ? data.times : []).filter(t => typeof t === "number" && t > now - WINDOW_MS);
    if (times.length >= LIMIT) return { result: { ok: false, reason: "visitor", retryAt: Math.min(...times) + WINDOW_MS } };
    return { data: { times: [...times, now] }, result: { ok: true, remaining: LIMIT - times.length - 1 } };
  });
  if (!mine.ok) return mine;

  let global;
  try {
    global = await update(`global-${dayOf(now)}`, data => {
      const count = Number(data?.count) || 0;
      if (count >= GLOBAL_DAILY_LIMIT) return { result: false };
      return { data: { count: count + 1 }, result: true };
    });
  } catch (err) {
    await removeStamp(key, now).catch(() => {});
    throw err;
  }

  if (!global) {
    await removeStamp(key, now);       // not the visitor's fault: don't count it against them
    return { ok: false, reason: "global", retryAt: nextUtcMidnight(now) };
  }
  return { ok: true, remaining: mine.remaining, stamp: now };
}

async function removeStamp(key, stamp) {
  await update(key, data => {
    const times = Array.isArray(data?.times) ? data.times : [];
    const i = times.indexOf(stamp);
    if (i < 0) return { result: false };
    return { data: { times: times.filter((_, k) => k !== i) }, result: true };
  });
}

/** Give a slot back when the generation could not even be started. */
export async function giveBack(ip, stamp) {
  await removeStamp(visitorKey(ip), stamp);
  await update(`global-${dayOf(stamp)}`, data => {
    const count = Number(data?.count) || 0;
    return count > 0 ? { data: { count: count - 1 }, result: true } : { result: false };
  });
}
