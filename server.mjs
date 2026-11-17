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
    const response = await handler(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }
  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(await readFile(new URL("./index.html", import.meta.url)));
    return;
  }
  res.writeHead(404).end("Not found");
}).listen(PORT, () => console.log(`Mutsify running at http://localhost:${PORT}`));
