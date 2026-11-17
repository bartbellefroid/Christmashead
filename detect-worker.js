// Runs face/animal detection off the main thread so animations never freeze.
import { loadDetectors, detectHeads } from "./engine.js";

// MediaPipe loads its WASM glue with importScripts(), which module workers don't have.
// Provide it: fetch synchronously (allowed in workers) and run in the global scope.
if (typeof self.importScripts !== "function" || !(() => { try { self.importScripts(); return true; } catch { return false; } })()) {
  self.importScripts = (...urls) => {
    for (const url of urls) {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", url, false);
      xhr.send();
      if (xhr.status >= 400) throw new Error(`Could not load ${url}`);
      (0, eval)(`${xhr.responseText}\n//# sourceURL=${url}`);
    }
  };
}

self.onmessage = async ({ data }) => {
  try {
    // CPU in the worker: its own thread, so it never competes with the page's animations for the GPU.
    await loadDetectors(undefined, false);
    if (data.type === "warm") return self.postMessage({ id: data.id, ok: true });
    const c = new OffscreenCanvas(data.bitmap.width, data.bitmap.height);
    c.getContext("2d").drawImage(data.bitmap, 0, 0);
    data.bitmap.close();
    const heads = await detectHeads(c);
    self.postMessage({ id: data.id, ok: true, heads });
  } catch (err) {
    self.postMessage({ id: data.id, ok: false, error: String(err?.message || err) });
  }
};
