// Headless proof run: drives the IWER XR emulator with Playwright, enters the
// immersive session, poses the emulated hands into puppet shapes and captures
// screenshots + scores + timings.
//
// Usage: PW_DIR=<dir containing node_modules/playwright> CHROME=<chrome path> \
//        node tools/xr-proof.mjs <baseUrl> <outDir>
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(join(process.env.PW_DIR ?? process.cwd(), 'noop.js'));
const { chromium } = require('playwright');
const base = process.argv[2] ?? 'https://localhost:8081/';
const out = process.argv[3] ?? 'proof-out';
const query = process.argv[4] ?? '';
const prefix = process.argv[5] ?? '';
const QUICK = process.env.QUICK === '1';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME,
  headless: true,
  args: ['--ignore-certificate-errors', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(base + query, { waitUntil: 'load' });
await page.waitForFunction(() => window.IWER_DEVICE && window.__shadowplay, null, { timeout: 60000 });
const sleep = (ms) => page.waitForTimeout(ms);

// Seated user: eyes at 1.2 m. Hands mode.
await page.evaluate(() => {
  const d = window.IWER_DEVICE;
  d.position.set(0, 1.2, 0);
  d.primaryInputMode = 'hand';
});
await sleep(500);
await page.screenshot({ path: join(out, `${prefix}00-browser-2d.png`) });
// Headless SwiftShader runs at a few fps, so score every frame here.
await page.evaluate(() => window.__shadowplay.setScoreEvery(1));

// Enter immersive session (IWSDK offers it; IWER grants like the Quest browser button).
await page.waitForFunction(() => window.IWER_DEVICE.sessionOffered, null, { timeout: 20000 });
await page.evaluate(() => window.IWER_DEVICE.grantOfferedSession());
await page.waitForFunction(() => !!window.IWER_DEVICE.activeSession, null, { timeout: 20000 });
await sleep(1500);
await page.screenshot({ path: join(out, `${prefix}00-xr-with-emulator-ui.png`) });
// Hide IWER's DevUI overlays so screenshots show only the app's rendering.
await page.evaluate(() => {
  const app = window.IWER_DEVICE.appCanvas;
  for (const el of Array.from(app.parentElement.children)) if (el !== app) el.style.visibility = 'hidden';
});

const setHands = async (id, jitter = 0, hideOthers = true) =>
  page.evaluate(({ id, jitter, hideOthers }) => {
    const d = window.IWER_DEVICE;
    d.controlMode = 'programmatic'; // stop the DevUI from driving the hands
    const sp = window.__shadowplay;
    const placement = sp.emulatorPose(id, jitter);
    for (const h of ['left', 'right']) {
      const hand = d.hands[h];
      const sym = Object.getOwnPropertySymbols(hand).find((s) => s.description === '@iwer/xr-hand-input');
      const p = placement[h];
      if (p) {
        // IWER shares one pose table between both hands: one slot per hand.
        hand[sym].poses[`puppet-${h}`] = p.pose;
        hand.poseId = `puppet-${h}`;
        hand.position.set(...p.position);
        hand.quaternion.set(...p.quaternion);
        hand.connected = true;
      } else if (hideOthers) {
        // park the unused hand low and out of the lamp's cone
        hand.poseId = 'default';
        hand.position.set(h === 'left' ? -0.35 : 0.35, 0.55, -0.25);
      }
    }
    return Object.keys(placement);
  }, { id, jitter, hideOthers });

const relaxed = async () =>
  page.evaluate(() => {
    const d = window.IWER_DEVICE;
    d.controlMode = 'programmatic';
    for (const h of ['left', 'right']) {
      d.hands[h].poseId = 'default';
      d.hands[h].connected = true;
    }
    d.hands.left.position.set(-0.08, 0.92, -0.47);
    d.hands.right.position.set(0.12, 0.88, -0.5);
    d.hands.left.quaternion.set(0, 0, 0, 1);
    d.hands.right.quaternion.set(0, 0, 0, 1);
  });

const state = () => page.evaluate(() => window.__shadowplay.state());
const results = { puppets: {}, relaxed: {}, jitter: {} };

const puppets = await page.evaluate(() => window.__shadowplay.puppets);
for (let i = 0; i < puppets.length; i++) {
  const id = puppets[i];
  await page.evaluate((i) => { window.__shadowplay.setThreshold(2); window.__shadowplay.setBeat(i); }, i);
  // 1) relaxed/default hands under the lamp (should score low)
  await relaxed();
  await sleep(2500);
  results.relaxed[id] = (await state()).smoothScore;
  await page.screenshot({ path: join(out, `${prefix}${String(i + 1).padStart(2, '0')}-${id}-a-relaxed.png`) });
  // 2) hands posed into the target puppet (should score ~1)
  await setHands(id);
  await sleep(3000);
  const s = await state();
  results.puppets[id] = { smooth: s.smoothScore, ...s.result };
  await page.screenshot({ path: join(out, `${prefix}${String(i + 1).padStart(2, '0')}-${id}-b-matched.png`) });
  // 3) noisy attempts: +-12 deg per joint (a human approximating the pose)
  const jit = [];
  for (let k = 0; k < (QUICK ? 0 : 6); k++) {
    await setHands(id, 12);
    await sleep(1200);
    jit.push((await state()).result.score);
  }
  results.jitter[id] = jit;
}

// Export binary masks for offline scorer evaluation (tools/eval-scorer.mjs):
// the clean target mask of every puppet and live shadows of jittered attempts.
const pack = (rgba) => { const o = []; for (let i = 0; i < rgba.length; i += 4) o.push(rgba[i] > 127 ? 1 : 0); return o.join(''); };
results.masks = { targets: {}, attempts: {} };
for (let i = 0; i < (QUICK ? 0 : puppets.length); i++) {
  const id = puppets[i];
  await page.evaluate((i) => { window.__shadowplay.setThreshold(2); window.__shadowplay.setBeat(i); }, i);
  await page.waitForFunction(() => window.__shadowplay.state().targetReady);
  await sleep(300);
  const b = await page.evaluate(() => window.__shadowplay.scoreBuffers());
  results.masks.w = b.w; results.masks.h = b.h;
  results.masks.targets[id] = pack(b.target);
  results.masks.attempts[id] = [];
  for (const [deg, n] of [[10, 4], [20, 4], [30, 4]]) {
    for (let k = 0; k < n; k++) {
      await setHands(id, deg);
      await sleep(1500);
      const lb = await page.evaluate(() => window.__shadowplay.scoreBuffers());
      results.masks.attempts[id].push({ deg, mask: pack(lb.live) });
    }
  }
}

// Discriminability: hold puppet j while the target is puppet i.
results.confusion = {};
for (let i = 0; i < (QUICK ? 0 : puppets.length); i++) {
  await page.evaluate((i) => { window.__shadowplay.setThreshold(2); window.__shadowplay.setBeat(i); }, i);
  const row = {};
  for (const id of puppets) {
    await setHands(id);
    await sleep(2200);
    row[id] = Math.round((await state()).result.score * 1000) / 1000;
  }
  results.confusion[puppets[i]] = row;
}

// Success path: let a puppet come alive with the normal threshold.
await page.evaluate(() => { window.__shadowplay.setThreshold(0.85); window.__shadowplay.setBeat(1); });
await setHands('dog');
await sleep(5000);
const alive = await state();
results.alivePhase = alive.phase;
await page.screenshot({ path: join(out, `${prefix}10-dog-alive.png`) });

results.perf = (await state()).perf;
results.renderer = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  const gl = c.getContext('webgl2');
  const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
  return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
results.logs = logs.filter((l) => !l.includes('[debug]')).slice(-40);
writeFileSync(join(out, `${prefix}results.json`), JSON.stringify(results, null, 2));
console.log(JSON.stringify({ ...results, masks: undefined, logs: results.logs.slice(-15) }, null, 1));
await browser.close();
