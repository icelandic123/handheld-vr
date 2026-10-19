// Records the demo video from the production build in the IWER emulator.
//
// The show runs in fixed 1/24 s steps (the theatre's step mode), and every
// step is screenshotted, so the video is smooth however slow the machine's
// software GPU is. Captions are an overlay in the page. Sound cues are logged
// on the story clock and rendered offline to soundtrack.wav.
//
// Usage: node scripts/record-demo.mjs <site url> <out dir>
//   then: ffmpeg -framerate 24 -i <out>/frames/f%05d.jpg -i <out>/soundtrack.wav ...
// Needs Playwright (PW_DIR=<dir with node_modules/playwright>, or installed here).
import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(join(process.env.PW_DIR ?? process.cwd(), 'noop.js'));
const { chromium } = require('playwright');

const url = process.argv[2] ?? 'https://icelandic123.github.io/handheld-vr/';
const out = process.argv[3] ?? 'demo-video';
const FPS = 24;
const INTRO_S = 4;
const END_S = 5;
const MAX_SHOW_S = 150;
const framesDir = join(out, 'frames');
rmSync(framesDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME || undefined,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

let frame = 0;
const framePath = (i) => join(framesDir, `f${String(i).padStart(5, '0')}.jpg`);
const shot = () => page.screenshot({ path: framePath(frame++), type: 'jpeg', quality: 90 });
/** One screenshot held for `seconds`. */
async function hold(seconds) {
  const first = frame;
  await shot();
  for (let i = 1; i < Math.round(seconds * FPS); i++) copyFileSync(framePath(first), framePath(frame++));
}

const CAPTION_CSS = `
#demo-caption{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:5000;max-width:1060px;
  background:rgba(20,10,5,.88);color:#f8e8cc;padding:12px 24px;border-radius:14px;text-align:center;
  font:500 25px/1.35 Georgia,"Times New Roman",serif;box-shadow:0 8px 24px rgba(0,0,0,.4)}
#demo-caption:empty{display:none}
#helpbar{display:none!important}`;
const setCaption = (text) =>
  page.evaluate(
    ([t, css]) => {
      let el = document.getElementById('demo-caption');
      if (!el) {
        const st = document.createElement('style');
        st.textContent = css;
        document.head.appendChild(st);
        el = document.createElement('div');
        el.id = 'demo-caption';
        document.body.appendChild(el);
      }
      if (el.textContent !== t) el.textContent = t;
    },
    [text, CAPTION_CSS],
  );

/** Caption for the current moment of the play. */
function captionFor({ scene, phase, phaseTime: t }) {
  if (phase === 'closing' || phase === 'closed') return 'Seated, hands only, no controllers. Built with Meta’s Immersive Web SDK.';
  if (scene === 6) return 'Curtain call: the cast takes a bow. Wave goodnight to close the curtain.';
  const alive = phase === 'alive';
  switch (scene) {
    case 0:
      if (alive) return 'Hold the shape for half a second and the scene comes alive.';
      return t < 6
        ? 'Recorded in an emulated Quest, with an autopilot playing the hands. On a headset, these are your own hands.'
        : 'Your tracked hands cast live shadows. Match the faint outline: an open hand wakes the lamp.';
    case 1:
      if (alive) return 'Woof! The dog has found his bark.';
      return t < 6
        ? 'Act I. Hand sideways, thumb up for an ear, little finger dropped for the jaw.'
        : 'The card shows what your shadow should become. As you get close, your shadow opens an eye.';
    case 2:
      if (alive) return 'The rabbit hops toward the moon.';
      return t < 6
        ? 'Act II. Two fingers up for ears, the rest curled under the thumb.'
        : 'An open hand looks close, so every shape is checked against the other puppets before it passes.';
    case 3:
      if (alive) return 'Up they fly, over the rooftops.';
      return t < 6
        ? 'Act III. Cross your wrists and hook your thumbs for the head. Your fingers are the wings.'
        : 'Two hands, one bird. The arm’s shadow is drawn soft, the way a real lamp blurs it.';
    case 4:
      if (alive) return 'The swan glides across the silver water.';
      return t < 6
        ? 'Act IV. Hand on its side, fingers bent over together: a swan\u2019s head and beak.'
        : 'Every target is rendered from a posed hand model, so every shape is one a real hand can make.';
    case 5:
      if (alive) return 'Just in time for the bow.';
      return t < 6
        ? 'Act V. One hand flat for the snail\u2019s body, a fist on top for its shell.'
        : 'Settings on the table: subtitles, larger text, screen distance, and which hand makes the puppets.';
    default:
      return '';
  }
}

const sep = url.includes('?') ? '&' : '?';
await page.goto(`${url}${sep}emulator=1`, { waitUntil: 'load' });
await page.waitForSelector('#lt-watch', { timeout: 90000 });
await page.waitForFunction(() => window.__shadowplay?.state().targetReady, null, { timeout: 120000 });
await page.waitForTimeout(800);

// Opening: the laptop landing page.
await setCaption('The Little Lamp Theatre: a hand-shadow puppet play for Meta Quest hand tracking.');
await hold(INTRO_S);

// From here on the show only moves when we step it.
await page.evaluate((intro) => {
  const sp = window.__shadowplay;
  sp.setStepMode(true, 24);
  sp.setScoreEvery(1);
  sp.recordSound(true, intro);
}, INTRO_S);
await page.click('#lt-watch');
await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && window.IWER_DEVICE.appCanvas, null, { timeout: 30000 });
// A narrower lens than the headset's 90 degrees, so the paper screen fills the video frame.
await page.evaluate(() => (window.IWER_DEVICE.fovy = 1.05));
await page.waitForTimeout(1500);

// One round trip per frame: set the caption, advance one step, and resolve
// once the theatre has run that step and the next frame is drawn.
await page.evaluate(() => {
  window.__demoStep = (caption) =>
    new Promise((resolve) => {
      const cap = document.getElementById('demo-caption');
      if (cap.textContent !== caption) cap.textContent = caption;
      const sp = window.__shadowplay;
      const target = sp.state().stepCount + 1;
      sp.step(1);
      const tick = () => {
        const s = sp.state();
        if (s.stepCount >= target) requestAnimationFrame(() => resolve({ scene: s.scene, phase: s.phase, phaseTime: s.phaseTime }));
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
});

let lastLog = '';
let st = { scene: 0, phase: 'playing', phaseTime: 0 };
const limit = Number(process.env.MAX_FRAMES ?? MAX_SHOW_S * FPS);
for (let i = 0; i < limit; i++) {
  st = await page.evaluate((c) => window.__demoStep(c), captionFor(st));
  await shot();
  const log = `${st.scene} ${st.phase}`;
  if (log !== lastLog) {
    console.log(`${(frame / FPS).toFixed(1)}s  scene ${log}`);
    lastLog = log;
  }
  if (st.phase === 'closed' && st.phaseTime > 3) break;
}
const showSeconds = frame / FPS - INTRO_S;

// End card.
await setCaption('Play it: icelandic123.github.io/handheld-vr in Meta Quest Browser. Built by Claude Code for bladoi.');
await hold(END_S);

const seconds = frame / FPS;
const wav = await page.evaluate((s) => window.__shadowplay.renderSoundtrack(s), seconds);
writeFileSync(join(out, 'soundtrack.wav'), Buffer.from(wav, 'base64'));
const cues = await page.evaluate(() => window.__shadowplay.soundEvents().filter((e) => e.cue !== 'progress').map((e) => `${e.t.toFixed(1)} ${e.cue}`));
writeFileSync(join(out, 'info.json'), JSON.stringify({ frames: frame, fps: FPS, seconds, showSeconds, cues, errors }, null, 1));
console.log(JSON.stringify({ frames: frame, seconds, showSeconds, cues: cues.length, errors }));
await browser.close();
if (errors.length) process.exitCode = 1;
