/**
 * Silhouette overlap scoring. Pure functions over small binary grids so it can
 * be unit-tested in Node and run on the CPU every few frames on Quest.
 *
 * Inputs are RGBA8 pixel buffers read back from the light camera's low-res
 * render targets (R channel = coverage).
 */

export interface ScoreOptions {
  /**
   * Tolerance in grid pixels. A shadow pixel counts as "inside" when it is
   * within this distance of the target, and a target pixel counts as
   * "covered" when it is within this distance of the shadow (symmetric).
   */
  tolerancePx: number;
  /** Translate the shadow so its centroid matches the target's. */
  alignCentroid: boolean;
  /** Rescale the shadow about its centroid to match the target's area. */
  alignScale: boolean;
  /** Clamp for the scale alignment factor. */
  maxScale: number;
}

export const DEFAULT_SCORE_OPTIONS: ScoreOptions = {
  tolerancePx: 1,
  alignCentroid: true,
  alignScale: true,
  maxScale: 1.5,
};

export interface ScoreResult {
  /** Combined 0..1 score: harmonic mean of tolerant precision and recall. */
  score: number;
  /** Plain IoU of (aligned) shadow vs target, no tolerance. */
  iou: number;
  precision: number;
  recall: number;
  shadowArea: number;
  targetArea: number;
  dx: number;
  dy: number;
  scale: number;
}

export class SilhouetteScorer {
  readonly w: number;
  readonly h: number;
  private target: Uint8Array;
  private targetDilated: Uint8Array;
  private aligned: Uint8Array;
  private alignedDilated: Uint8Array;
  private scratch: Uint8Array;
  private tCx = 0;
  private tCy = 0;
  private tArea = 0;
  private opts: ScoreOptions;

  constructor(w: number, h: number, opts: Partial<ScoreOptions> = {}) {
    this.w = w;
    this.h = h;
    const n = w * h;
    this.target = new Uint8Array(n);
    this.targetDilated = new Uint8Array(n);
    this.aligned = new Uint8Array(n);
    this.alignedDilated = new Uint8Array(n);
    this.scratch = new Uint8Array(n);
    this.opts = { ...DEFAULT_SCORE_OPTIONS, ...opts };
  }

  get options(): ScoreOptions {
    return this.opts;
  }

  setOptions(opts: Partial<ScoreOptions>): void {
    const tolChanged = opts.tolerancePx !== undefined && opts.tolerancePx !== this.opts.tolerancePx;
    this.opts = { ...this.opts, ...opts };
    if (tolChanged) this.prepareTarget();
  }

  /** Set the target from an RGBA8 buffer (or a 1-byte-per-pixel mask). */
  setTarget(pixels: ArrayLike<number>, stride = 4): void {
    const n = this.w * this.h;
    for (let i = 0; i < n; i++) this.target[i] = pixels[i * stride] > 127 ? 1 : 0;
    this.prepareTarget();
  }

  private prepareTarget(): void {
    const { w, h } = this;
    let sx = 0;
    let sy = 0;
    let a = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (this.target[y * w + x]) {
          sx += x;
          sy += y;
          a++;
        }
      }
    }
    this.tArea = a;
    this.tCx = a ? sx / a : w / 2;
    this.tCy = a ? sy / a : h / 2;
    const r = Math.max(0, Math.round(this.opts.tolerancePx));
    morph(this.target, this.targetDilated, this.scratch, w, h, r, true);
  }

  /** Score an RGBA8 shadow buffer against the current target. */
  score(pixels: ArrayLike<number>, stride = 4, out?: ScoreResult): ScoreResult {
    const { w, h } = this;
    const res: ScoreResult = out ?? {
      score: 0, iou: 0, precision: 0, recall: 0, shadowArea: 0, targetArea: 0, dx: 0, dy: 0, scale: 1,
    };
    let sx = 0;
    let sy = 0;
    let a = 0;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        if (pixels[(row + x) * stride] > 127) {
          sx += x;
          sy += y;
          a++;
        }
      }
    }
    res.shadowArea = a;
    res.targetArea = this.tArea;
    if (a === 0 || this.tArea === 0) {
      res.score = res.iou = res.precision = res.recall = 0;
      res.dx = res.dy = 0;
      res.scale = 1;
      return res;
    }
    const cx = sx / a;
    const cy = sy / a;
    let scale = 1;
    if (this.opts.alignScale) {
      scale = Math.sqrt(this.tArea / a);
      const m = this.opts.maxScale;
      scale = Math.min(m, Math.max(1 / m, scale));
    }
    const ox = this.opts.alignCentroid ? this.tCx : cx;
    const oy = this.opts.alignCentroid ? this.tCy : cy;
    res.dx = ox - cx;
    res.dy = oy - cy;
    res.scale = scale;

    // Inverse-map each destination pixel to the source (nearest neighbour).
    const al = this.aligned;
    const inv = 1 / scale;
    let alignedArea = 0;
    for (let y = 0; y < h; y++) {
      const syf = (y - oy) * inv + cy;
      const syi = Math.round(syf);
      const inY = syi >= 0 && syi < h;
      for (let x = 0; x < w; x++) {
        let v = 0;
        if (inY) {
          const sxi = Math.round((x - ox) * inv + cx);
          if (sxi >= 0 && sxi < w && pixels[(syi * w + sxi) * stride] > 127) v = 1;
        }
        al[y * w + x] = v;
        alignedArea += v;
      }
    }

    const rad = Math.max(0, Math.round(this.opts.tolerancePx));
    morph(al, this.alignedDilated, this.scratch, w, h, rad, true);
    let inter = 0;
    let union = 0;
    let insideDilated = 0;
    let covered = 0;
    const n = w * h;
    const t = this.target;
    const td = this.targetDilated;
    const ad = this.alignedDilated;
    for (let i = 0; i < n; i++) {
      const s = al[i];
      const tv = t[i];
      inter += s & tv;
      union += s | tv;
      insideDilated += s & td[i];
      covered += tv & ad[i];
    }
    res.iou = union ? inter / union : 0;
    res.precision = alignedArea ? insideDilated / alignedArea : 0;
    res.recall = this.tArea ? covered / this.tArea : 0;
    const p = res.precision;
    const r = res.recall;
    res.score = p + r > 0 ? (2 * p * r) / (p + r) : 0;
    return res;
  }
}

/** Square-structuring-element dilation/erosion via separable passes. */
function morph(src: Uint8Array, dst: Uint8Array, tmp: Uint8Array, w: number, h: number, r: number, dilate: boolean): void {
  if (r <= 0) {
    dst.set(src);
    return;
  }
  // horizontal
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = dilate ? 0 : 1;
      for (let k = -r; k <= r; k++) {
        const xx = x + k;
        const s = xx >= 0 && xx < w ? src[y * w + xx] : 0;
        if (dilate ? s : !s) {
          v = dilate ? 1 : 0;
          break;
        }
      }
      tmp[y * w + x] = v;
    }
  }
  // vertical
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = dilate ? 0 : 1;
      for (let k = -r; k <= r; k++) {
        const yy = y + k;
        const s = yy >= 0 && yy < h ? tmp[yy * w + x] : 0;
        if (dilate ? s : !s) {
          v = dilate ? 1 : 0;
          break;
        }
      }
      dst[y * w + x] = v;
    }
  }
}
