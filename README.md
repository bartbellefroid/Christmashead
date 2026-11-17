# Mutsify 🎅

A single-page website: upload a photo and **Mutsify** puts a Christmas hat on every face it can find — humans, cats, dogs, cows, horses, sheep, birds and more.

Every run is different: each head gets a randomly chosen placement style (jaunty tilt, floppy tail, sliding off, tiny perched hat, ridiculous tower, pulled over one eye, hat-on-a-hat, way-too-big, worn backwards) with random colours, stripes and pom-poms or bells.

## Use it

Open `index.html` in a browser (or host it on GitHub Pages / any static host). Then:

- Choose, drop or paste a photo.
- Click **Mutsify!** again for a new arrangement.
- Drag hats to move them; mouse wheel to resize, Shift + wheel to tilt; or use the sliders, Flip, Restyle and Delete buttons.
- Double-click / double-tap to add an extra hat.
- **Download** saves the result as a JPEG.

## How it works

Everything runs in the browser; the photo is never uploaded.

- Human faces: MediaPipe Face Detector (BlazeFace short-range), also run on overlapping tiles to find smaller faces in group shots.
- Animals and people seen from behind: MediaPipe Object Detector (EfficientDet-Lite2, COCO classes).
- Animal heads: first the face model is tried on a crop of the animal; otherwise the head is *estimated* as the most detailed region of the animal's box. That estimate can be wrong (e.g. a grazing horse), which is why every hat can be dragged.

Models and the MediaPipe library are loaded from cdn.jsdelivr.net and storage.googleapis.com (~13 MB on first use).
