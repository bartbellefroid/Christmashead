# Mutsify 🎅

Drop a photo and get a funny Christmas version of it: every person and animal gets a funhouse-mirror
head (stretched or squashed, big grin, natural eyes) and a Santa hat placed in a silly way. Never the same twice.

While the AI works (10–30 seconds), a reindeer walks onto your photo and eats it bite by bite, then burps
and reveals the result with confetti.

## Design

Soft, blurred photo of fluffy plush reindeer in Santa hats behind frosted-glass panels, a small app icon,
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

Every upload (and every 🎲 Again) is one paid Replicate prediction, and anyone who can open the site can use it,
so keep an eye on your Replicate usage or set a spending limit there.

Known limitation: the small model sometimes still adds an extra head or hat (seen on a grazing horse whose head
is hidden in the grass). 🎲 Again gives a new attempt.

## Run locally

```sh
REPLICATE_API_TOKEN=r8_your_token node server.mjs
# open http://localhost:8787
```

## Deploy on Netlify

Connect the repository (branch `main`); `netlify.toml` publishes the site and the function. Set the environment
variable `REPLICATE_API_TOKEN` in the site settings.
