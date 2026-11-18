# Mutsify 🎅

Drop a photo and get a Christmas version of it: every person and animal gets exactly one Santa hat, worn in a funny way
(cheekily tilted, tiny, extra tall and floppy, backwards…), always above the eyes. Faces stay exactly as they are. Never the same twice.

While the AI works (10–30 seconds), a reindeer walks along the bottom edge of your photo and eats it strip by strip, then burps
and reveals the result with confetti.

## Design

Plush snowflakes drift down the whole time over a soft, blurred photo of fluffy plush reindeer in Santa hats behind frosted-glass panels, a small app icon,
a thin-line icon toolbar (new photo · again · save) and colour dots that tint the page
(Frosty Blue, Cranberry, Pine, Gingerbread, Sugarplum). The images in `assets/` were generated with the same
Replicate model; the photo-eating reindeer was generated on a green screen and cut out.

## Saving

The result gets a small badge in the bottom-left corner: a QR code to https://mutsify.netlify.app and the word
"Mutsify" (`assets/qr.png`, drawn onto the photo in the browser). On phones, Save opens the share sheet so the
picture can go straight into Photos / the gallery; on computers it downloads as a JPEG.

## Privacy

Photos are only sent to Replicate to add the hats; Mutsify itself doesn't store them, and Replicate deletes them
after 60 minutes. The page says so in one line under the colour dots.

## How it works

- `index.html` — the page (upload, reindeer animation, toolbar, colour dots).
- `detect-worker.js` + `engine.js` — find faces and animals in the browser with MediaPipe, in a Web Worker
  so the animation never stutters. The result ("one horse", "two people") goes into the AI prompt, because
  without it the model tends to invent extra (human) faces.
- `netlify/functions/funhouse.mjs` — server function at `/api/funhouse` that calls Replicate
  ([FLUX.2 klein 4B](https://replicate.com/black-forest-labs/flux-2-klein-4b)). The Replicate token stays on
  the server (`REPLICATE_API_TOKEN`).

Every upload (and every ↻ Again) is one paid Replicate prediction. Abuse protection (`lib/rate-limit.mjs`):

- **Per visitor: 10 pictures per 5 hours.** Visitors are identified by IP address; IPv6 addresses are grouped per
  /64 network, so hopping between addresses of one connection doesn't give a fresh counter.
- **For everyone together: 300 pictures per UTC day**, so many different addresses (VPNs, botnets) can't run up
  unlimited costs either.
- Counts are updated with compare-and-swap (Netlify Blobs conditional writes, store `mutsify-rate-limit`), so a burst
  of simultaneous requests can't slip past the limit. If the counter can't be updated cleanly the request is refused.
- A generation that fails to start doesn't count. Visitors are told when they can try again.
- Only a salted hash of the IP is stored. **Set a secret `RATE_LIMIT_SALT`** in the Netlify environment variables;
  the default salt is public in this repository, so without your own salt the hashes could be traced back to IPs.
- Limits: people sharing one network share one counter, and someone switching networks (wifi → mobile data) gets a
  new one. Also set a spending limit in your Replicate account as the final safety net.
- Optional environment variables: `RATE_LIMIT` (default 10), `RATE_LIMIT_HOURS` (default 5),
  `GLOBAL_DAILY_LIMIT` (default 300), `RATE_LIMIT_SALT`.

The prompt names how many heads the detector found and asks for exactly that many hats. Image models don't
always obey; if a picture comes out wrong, ↻ Again gives a new attempt.

## Run locally

```sh
REPLICATE_API_TOKEN=r8_your_token node server.mjs
# open http://localhost:8787
```

## Deploy on Netlify

Connect the repository (branch `main`); `netlify.toml` publishes the site and the function, and Netlify installs
`@netlify/blobs` from `package.json` for the rate limit. Set the environment
variable `REPLICATE_API_TOKEN` in the site settings.
