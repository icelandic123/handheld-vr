// Quick visual check of every puppet: matched shadow, then the "alive"
// animation, cropped to the paper screen. Used to tune eyes and callouts.
//
// Usage: PW_DIR=<dir containing node_modules/playwright> CHROME=<chrome path> \
//        node tools/pose-preview.mjs <url> <outDir>
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(join(process.env.PW_DIR ?? process.cwd(), 'noop.js'));
const { chromium } = require('playwright');
const url = process.argv[2] ?? 'https://localhost:8081/';
const out = process.argv[3] ?? 'preview-out';
const only = process.argv[4] ? process.argv[4].split(',') : null;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME,
  headless: true,
  args: ['--ignore-certificate-errors', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(url);
await page.waitForFunction(() => window.IWER_DEVICE && window.__shadowplay, null, { timeout: 60000 });
await page.evaluate(() => {
  window.IWER_DEVICE.position.set(0, 1.2, 0);
  window.IWER_DEVICE.primaryInputMode = 'hand';
  window.__shadowplay.setScoreEvery(1);
});
await page.waitForFunction(() => window.IWER_DEVICE.sessionOffered, null, { timeout: 20000 });
await page.evaluate(() => window.IWER_DEVICE.grantOfferedSession());
await page.waitForFunction(() => !!window.IWER_DEVICE.activeSession && !!window.IWER_DEVICE.appCanvas, null, { timeout: 20000 });
await page.evaluate(() => {
  const app = window.IWER_DEVICE.appCanvas;
  for (const el of Array.from(app.parentElement.children)) if (el !== app) el.style.visibility = 'hidden';
});
await page.waitForFunction(() => window.__shadowplay.state().targetReady, null, { timeout: 60000 });

const pose = (id) =>
  page.evaluate((id) => {
    const d = window.IWER_DEVICE;
    d.controlMode = 'programmatic';
    const placement = window.__shadowplay.emulatorPlacement(id, 1, 0);
    for (const h of ['left', 'right']) {
      const hand = d.hands[h];
      const sym = Object.getOwnPropertySymbols(hand).find((s) => s.description === '@iwer/xr-hand-input');
      const p = placement[h];
      hand[sym].poses[`preview-${h}`] = p.pose;
      hand.poseId = `preview-${h}`;
      hand.position.set(...p.position);
      hand.quaternion.set(...p.quaternion);
      hand.connected = true;
    }
  }, id);

const clip = { x: 400, y: 228, width: 480, height: 332 };
const scenes = await page.evaluate(() => window.__shadowplay.scenes);
for (let i = 0; i < scenes.length; i++) {
  const id = scenes[i];
  if (only && !only.includes(id)) continue;
  await page.evaluate((i) => {
    window.__shadowplay.setThreshold(2); // stay in 'playing' while we look
    window.__shadowplay.setScene(i);
  }, i);
  if (id === 'curtain') {
    await pose(null);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: join(out, `${i}-curtain-bow.png`), clip });
    continue;
  }
  await pose(null);
  await page.waitForTimeout(2200);
  await page.screenshot({ path: join(out, `${i}-${id}-a-target.png`), clip });
  await pose(id);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(out, `${i}-${id}-b-matched.png`), clip });
  await page.evaluate(() => window.__shadowplay.setPhase('alive'));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(out, `${i}-${id}-c-alive.png`), clip });
}
console.log(JSON.stringify({ errors: errors.slice(0, 10) }));
await browser.close();
