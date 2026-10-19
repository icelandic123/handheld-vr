// Offline scorer evaluation on masks exported by tools/xr-proof.mjs.
// Usage: node tools/eval-scorer.mjs <results.json>
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
const res = await build({ entryPoints: [new URL('../src/shadow/score.ts', import.meta.url).pathname], bundle: true, format: 'esm', write: false, platform: 'node' });
const { SilhouetteScorer } = await import('data:text/javascript;base64,' + Buffer.from(res.outputFiles[0].text).toString('base64'));
const data = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const { w, h, targets, attempts } = data.masks;
const toArr = (s) => Uint8Array.from(s, (c) => (c === '1' ? 255 : 0));
const ids = Object.keys(targets);
const variants = [
  { name: 'tol0', tolerancePx: 0 },
  { name: 'tol1', tolerancePx: 1 },
  { name: 'tol2', tolerancePx: 2 },
  { name: 'tol3', tolerancePx: 3 },
  { name: 'tol1-noscale', tolerancePx: 1, alignScale: false },
];
const t0 = performance.now();
let evals = 0;
for (const v of variants) {
  const sc = new SilhouetteScorer(w, h, v);
  console.log(`\n== ${v.name}  (grid ${w}x${h})`);
  let worstGap = Infinity;
  for (const tid of ids) {
    sc.setTarget(toArr(targets[tid]), 1);
    const own = {};
    for (const a of attempts[tid]) (own[a.deg] ??= []).push(sc.score(toArr(a.mask), 1).score), evals++;
    const others = ids.filter((x) => x !== tid).map((o) => [o, sc.score(toArr(targets[o]), 1).score]);
    const bestOther = Math.max(...others.map((x) => x[1]));
    const ownMin = Math.min(...Object.values(own).flat().filter((_, i) => true));
    const fmt = (a) => a.map((x) => x.toFixed(2)).join(' ');
    console.log(`${tid.padEnd(7)} own±10:${fmt(own[10])} ±20:${fmt(own[20])} ±30:${fmt(own[30])} | others: ${others.map(([o, s]) => `${o}=${s.toFixed(2)}`).join(' ')}`);
    worstGap = Math.min(worstGap, Math.min(...own[10], ...own[20]) - bestOther);
  }
  console.log(`worst margin (min own@<=20deg - best wrong puppet): ${worstGap.toFixed(3)}`);
}
// timing of score() on this grid
const sc = new SilhouetteScorer(w, h, { tolerancePx: 1 });
sc.setTarget(toArr(targets[ids[0]]), 1);
const live = toArr(attempts[ids[0]][0].mask);
const rgba = new Uint8Array(w * h * 4); for (let i = 0; i < w * h; i++) rgba[i * 4] = live[i];
for (let i = 0; i < 200; i++) sc.score(rgba, 4);
const N = 2000; const s0 = performance.now(); for (let i = 0; i < N; i++) sc.score(rgba, 4); const per = (performance.now() - s0) / N;
console.log(`\nscore() on ${w}x${h} RGBA: ${(per * 1000).toFixed(1)} us/call (Node, x86)`);
