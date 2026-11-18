// Local development server: serves index.html and the /api/funhouse function.
//   REPLICATE_API_TOKEN=r8_... node server.mjs   then open http://localhost:8787
import http from "node:http";
import { readFile } from "node:fs/promises";
import handler from "./netlify/functions/funhouse.mjs";

const PORT = Number(process.env.PORT) || 8787;

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/api/funhouse") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const request = new Request(url, {
      method: req.method,
      headers: req.headers,
      body: req.method === "POST" ? Buffer.concat(chunks) : undefined,
    });
    const response = await handler(request, { ip: req.socket.remoteAddress });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }
  // static files: index.html, engine.js, detect-worker.js and assets/*
  const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
  const name = ["/", "/robin", "/robin/", "/ridder", "/ridder/"].includes(url.pathname) ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  const ext = name.slice(name.lastIndexOf("."));
  const allowed = /^(index\.html|engine\.js|detect-worker\.js|assets\/[\w.-]+)$/.test(name);
  if (allowed && TYPES[ext]) {
    try {
      const body = await readFile(new URL(`./${name}`, import.meta.url));
      res.writeHead(200, { "content-type": TYPES[ext] });
      res.end(body);
      return;
    } catch {}
  }
  res.writeHead(404).end("Not found");
}).listen(PORT, () => console.log(`Mutsify running at http://localhost:${PORT}`));
