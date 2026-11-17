# Mutsify 🎅

A single-page website: upload a photo and **Mutsify** puts a Christmas hat on every face it can find — humans, cats, dogs, cows, horses, sheep, birds and more.

Every run is different: each head gets a randomly chosen placement style (jaunty tilt, floppy tail, sliding off, tiny perched hat, ridiculous tower, pulled over one eye, hat-on-a-hat, way-too-big, worn backwards) with random colours, stripes and pom-poms or bells.

## AI funhouse version

Below the hat editor there is a **✨ Make funhouse version** button. It sends the photo to
[Replicate](https://replicate.com/black-forest-labs/flux-2-klein-4b) (FLUX.2 klein 4B by Black Forest Labs),
which redraws it with every face stretched like in a funhouse mirror and a silly Santa hat on each head.

- The Replicate token never reaches the browser: the page talks to a small server function,
  `netlify/functions/funhouse.mjs` (path `/api/funhouse`), which reads `REPLICATE_API_TOKEN`.
- The page tells the function what the detector found (e.g. "one horse", "two people"), so the prompt can
  say exactly who is in the picture. Without that the model tends to invent extra human faces.
- The prompt picks three random hat ideas each time, so every run is different.
- Each click costs a Replicate prediction. Anyone who can reach the deployed page can use it, so keep an
  eye on your Replicate usage or add a spending limit there.

### While you wait

The funny version takes 10–30 seconds. Meanwhile a reindeer walks onto the photo and eats it, bite by bite
(crumbs in the photo's own colours, speech bubbles, a burp and confetti when the result arrives).
Face detection runs in a Web Worker (`detect-worker.js`) so the animation never stutters.

### Run locally

```sh
REPLICATE_API_TOKEN=r8_your_token node server.mjs
# open http://localhost:8787
```

Opening `index.html` directly as a file still works for the hat editor, but not for the AI version.

### Deploy on Netlify

Connect the repository to Netlify (the included `netlify.toml` publishes the site and the function) and set the
environment variable `REPLICATE_API_TOKEN` in the site settings.

## Use it

Choose, drop or paste a photo. You get two pictures: **Muts** (hats drawn in your browser — drag them if one
lands wrong) and **Funny** (the AI version). Each has 🎲 Again and ⬇ Save.

## How it works

The hat editor runs entirely in the browser; the photo only leaves your device when you click the AI funhouse button.

- Human faces: MediaPipe Face Detector (BlazeFace short-range), also run on overlapping tiles to find smaller faces in group shots.
- Animals and people seen from behind: MediaPipe Object Detector (EfficientDet-Lite2, COCO classes).
- Animal heads: first the face model is tried on a crop of the animal; otherwise the head is *estimated* as the most detailed region of the animal's box. That estimate can be wrong (e.g. a grazing horse), which is why every hat can be dragged.

Models and the MediaPipe library are loaded from cdn.jsdelivr.net and storage.googleapis.com (~13 MB on first use).
