# The Little Lamp Theatre

A hand-shadow puppet play for WebXR on Meta Quest. Sit at a small table, raise
your hands into the lamplight, and shape a dog, a rabbit, a bird, a swan and a
snail on a glowing paper screen. Get the shape right and the shadow comes alive.

**Play:** https://icelandic123.github.io/handheld-vr/ (open it in Meta Quest
Browser). On a laptop the same link plays the show in an emulated headset.

Entry for the Meta VR Start Developer Competition 2026. Built with Meta's
Immersive Web SDK (IWSDK).

## How to play

- Seated, hands only. No controllers are needed.
- **Prologue:** hold up an open hand to wake the lamp.
- **I. The Dog Who Lost His Bark:** hand sideways, thumb up for an ear, little
  finger dropped for a jaw.
- **II. The Rabbit Who Wanted the Moon:** two fingers up for ears, the rest
  curled under the thumb.
- **III. The Bird Who Gave a Ride:** cross your wrists, hook your thumbs, spread
  your fingers as wings.
- **IV. The Swan on the Silver Lake:** hand on its side, fingers together and
  bent over for the head and beak.
- **V. The Snail Who Was Nearly Late:** one hand flat and sideways for the body,
  a fist on top for the shell.
- **Curtain call:** the cast bows. Wave goodnight to close the curtain.

A faint outline shows each target, with a little ink drawing of the character
in the corner. As your shadow gets close, it opens an eye. Hold the shape for
half a second and the puppet comes alive: the dog barks, the rabbit hops toward
the moon, the bird flies, the swan glides. If you get
stuck, poke the brass bell on the right of the table to skip a scene. The bell on
the left leaves the theatre.

**Settings** are on the card standing on the left of the table: poke a row to
change it. The same settings are on the start page. They cover subtitles,
larger text, screen distance (near, normal or far) and which hand makes the
one-hand puppets (right by default; left mirrors every puppet). On headsets
that support passthrough, "Play in your room" opens the same play with the
paper screen floating in your own room.

**On a laptop:** "Watch the play" runs the whole show with emulated hands. "Try
it with emulated hands" lets you press 1 to 4 to snap the hands into each shape,
0 to rest them, N to skip and Esc to leave. (Keys 5 and 6 are the swan and the
snail.) Add `?emulator=1` to force the
emulator, or `?emulator=0` to turn it off.

## How it works

- **Hands become capsules** (`src/shadow/hand-proxy.ts`). The 25 WebXR joint
  poses and radii drive instanced spheres and cylinders, a palm fan and an IK
  forearm. Hands cast into one colour channel and the forearm into another, so
  the arm is drawn as a soft blurred sleeve (as a real lamp blurs anything held
  close to it) and is never scored.
- **A shadow is a projection from the lamp** (`src/shadow/shadow-light.ts`). For
  a point light and a flat screen, a shadow is the perspective projection of the
  hands from the light onto that plane. The hands are rendered from the lamp
  with an off-axis frustum whose image plane is the screen. The screen shader
  shows the result with a soft penumbra. A 128x85 copy is read back
  asynchronously for scoring, so what you see is what is scored.
- **Targets come from a posed ghost hand** (`src/shadow/hand-rig.ts`,
  `src/shadow/poses.ts`). Each puppet is a set of joint angles on a
  forward-kinematics rig built from a real tracked-hand skeleton. It is rendered
  through the same pipeline at the player's measured hand size, so every target
  can be reached by a real hand.
- **Scoring** (`src/shadow/score.ts`) aligns centroid and scale, then computes a
  symmetric tolerant F1: the shadow inside the target and the target covered by
  the shadow. It costs about 0.06 ms per call. A pose passes when it scores at
  least 0.8 *and* beats every look-alike puppet by 0.03, so an open hand can't
  pass as the rabbit. The threshold is deliberately forgiving.
- **Characters** (`src/sketches.ts`, `EyeSpec` in `src/shadow/poses.ts`). Each
  puppet's eye is a point on one finger joint, projected from the lamp onto the
  screen and drawn as a gap of lamplight, the way puppeteers make eyes with a
  bent finger. The ink drawings on the cards are hand-written canvas paths.
- **Sound** is synthesised with WebAudio (`src/audio.ts`): bark, boing, chirp,
  applause and the curtain. There are no audio files.
- **Laptop fallback** (`src/emulator.ts`, `src/landing.ts`, `src/autopilot.ts`).
  When the browser reports no immersive-vr support, the IWER emulator is loaded
  on demand and an autopilot performs the show. On a headset the emulator is
  never loaded.

## Run locally

```sh
npm ci
IWSDK_DEV_OPEN=false npx vite --port 8081   # https://localhost:8081/
npm run build                               # dist/ works from any subpath
```

The headless proof runs the IWER emulator under Playwright, poses every puppet
and records scores, cross-scores and timings:

```sh
PW_DIR=<dir with node_modules/playwright> CHROME=<chromium path> \
  node tools/xr-proof.mjs https://localhost:8081/ <outDir>
node tools/eval-scorer.mjs <outDir>/results.json
```

Debug hooks live on `window.__shadowplay`.

## Checks

`.github/workflows/checks.yml` builds the site, poses every puppet in the
emulator under headless Chromium, and runs `tools/eval-scorer.mjs --check`. The
check fails if, with the game's own threshold and margin, any puppet's shape
passes as another, or fewer than 90% of jittered correct poses pass.
`tools/pose-preview.mjs` takes screenshots of each puppet (target, matched,
alive) for tuning.

## Demo video

`.github/workflows/demo.yml` (run it by hand) records "Watch the play" from the
production build with `scripts/record-demo.mjs`. The show runs in fixed 1/24 s
steps with one screenshot per step, so the video is smooth on a slow software
GPU. Captions are a page overlay. Sound cues are logged on the story clock and
rendered offline with the same WebAudio code. ffmpeg encodes a 1280x720 MP4,
which is published on the `demo-video` branch.

## Deploy

`.github/workflows/pages.yml` builds on every push to `main` and publishes
`dist/` with GitHub Pages. To use it, set the repository's Pages source to
"GitHub Actions".

## How it was built (AI disclosure)

This project was built end to end by Claude Code (Anthropic's coding agent) for
bladoi (icelandic123). That covers the code, the puppet poses, the story text,
the synthesised sound and the tests. bladoi set the brief, made the decisions
and reviewed the results.

## Credits and licence

MIT, see `LICENSE`.

- The rest-hand skeleton in `src/shadow/rest-hand.ts` is derived from the
  relaxed hand pose in IWER (MIT, Meta Platforms).
- The hand models in `public/hands/generic-hand/` come from
  `@webxr-input-profiles/assets` (MIT, Amazon). See
  `public/hands/LICENSE-webxr-input-profiles.md`.
- Everything else (the stage, shadows, puppets and sound) is procedural.
