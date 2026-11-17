# Mutsify 🎅

Drop a photo and get a Christmas version of it: every person and animal gets exactly one Santa hat, worn in a funny way
(cheekily tilted, tiny, extra tall and floppy, backwards…), always above the eyes. Faces stay exactly as they are. Never the same twice.

While the AI works (10–30 seconds), a reindeer walks onto your photo and eats it bite by bite, then burps
and reveals the result with confetti.

## Design

Plush snowflakes drift down the whole time over a soft, blurred photo of fluffy plush reindeer in Santa hats behind frosted-glass panels, a small app icon,
a thin-line icon toolbar (new photo · again · save) and colour dots that tint the page
(Frosty Blue, Cranberry, Pine, Gingerbread, Sugarplum). The images in `assets/` were generated with the same
Replicate model; the photo-eating reindeer was generated on a green screen and cut out.

## How it works

- `index.html` — the page (upload, reindeer animation, toolbar, colour dots).
- `detect-worker.js` + `engine.js` — find faces and animals in the browser with MediaPipe, in a Web Worker
  so the animation never stutters. The result ("one horse", "two people") goes into the AI prompt, because
  without it the model tends to invent extra (human) faces.
- `netlify/functions/funhouse.mjs` — server function at `/api/funhouse` that calls Replicate
  ([FLUX.2 klein 4B](https://replicate.com/black-forest-labs/flux-2-klein-4b)). The Replicate token stays on
  the server (`REPLICATE_API_TOKEN`).

Every upload (and every ↻ Again) is one paid Replicate prediction. To prevent abuse each visitor can make
**10 pictures per 5 hours** (`lib/rate-limit.mjs`). Visitors are told when they can try again.

- Counted per IP address; only a salted hash of the IP is stored, in Netlify Blobs (store `mutsify-rate-limit`).
  Locally the counts are kept in memory.
- A generation that fails to start doesn't count.
- Limits: people sharing one network (office, school, family wifi) share one counter, and someone who switches
  networks (e.g. wifi → mobile data) gets a new one. It stops casual abuse, not a determined attacker, so a
  spending limit in your Replicate account is still a good idea.
- Optional environment variables: `RATE_LIMIT` (default 10), `RATE_LIMIT_HOURS` (default 5), `RATE_LIMIT_SALT`.

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
