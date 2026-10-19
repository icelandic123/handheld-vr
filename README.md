# Shadowplay (working title)

A shadow-puppet theatre for your hands. Built with Meta's Immersive Web SDK
(IWSDK) for WebXR on Meta Quest, for hands and seated play.

You sit at a small table with a warm lamp. Your tracked hands cast live
shadows onto a paper screen. Each scene shows a faint silhouette (open hand,
dog, rabbit, bird…). Shape your hands so your shadow fills it, and the puppet
comes alive.

## How it works

- **Hands → capsule proxy** (`src/shadow/hand-proxy.ts`): the 25 WebXR joint
  poses + radii drive instanced spheres/cylinders, a palm fan and an IK forearm.
  No hand model is downloaded.
- **Shadow = projection from the lamp** (`src/shadow/shadow-light.ts`): for a
  point light and a flat screen, a shadow is the perspective projection of the
  casters from the light onto that plane. We render the casters from the lamp
  with an off-axis frustum whose image plane *is* the screen, into a 384x256
  render target. The screen shader displays it with a soft penumbra. A 128x85
  copy is read back asynchronously (PBO + fence) for scoring. What you see is
  exactly what is scored. (`?native=1` switches to a three.js spot-light shadow
  map instead, for comparison.)
- **Targets come from a posed ghost hand** (`src/shadow/hand-rig.ts`,
  `src/shadow/poses.ts`): puppet shapes are joint angles on an FK rig built
  from a real tracked-hand skeleton. Each one is rendered through the same
  pipeline to make the mask, so every target can be reached by a hand.
- **Scoring** (`src/shadow/score.ts`): centroid and scale alignment, then a
  symmetric tolerant F1 (shadow inside dilated target, target covered by
  dilated shadow). Tolerance and threshold are tunable.
- **Sound** is synthesised with WebAudio (`src/audio.ts`). There are no asset
  files.

## Run

```sh
npm install
npm run dev            # IWSDK-managed dev server + emulator browser
# or, without the managed browser:
IWSDK_DEV_OPEN=false npx vite --port 8081
```

Headless proof run (IWER emulator driven by Playwright):

```sh
PW_DIR=<dir with node_modules/playwright> CHROME=<chromium path> \
  node tools/xr-proof.mjs https://localhost:8081/ <outDir>
node tools/eval-scorer.mjs <outDir>/results.json   # offline scorer evaluation
```

Debug hooks live on `window.__shadowplay` (state, setBeat, setTolerance,
setThreshold, emulatorPose…).

## Deploy (GitHub Pages project site)

`vite.config.ts` uses `base: './'`, so `npm run build` output works from
`https://<user>.github.io/handheld-vr/` (verified locally from a `/handheld-vr/`
subpath). Publish `dist/` with `npx gh-pages -d dist --dotfiles`
(`public/.nojekyll` is included).

## Credits

Rest hand skeleton in `src/shadow/rest-hand.ts` is derived from IWER's relaxed
hand pose (MIT, Meta Platforms). Everything else is procedural or our own.
