import {
  Color,
  DoubleSide,
  LinearFilter,
  Matrix4,
  MeshBasicMaterial,
  NearestFilter,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from '@iwsdk/core';
import { LAYER_DISPLAY_ONLY, LAYER_SCORED } from './hand-proxy.js';

export interface ScreenSpec {
  /** Screen centre in stage-local coordinates (screen faces +Z). */
  center: Vector3;
  width: number;
  height: number;
  /** Lamp position in stage-local coordinates (must have z > center.z). */
  light: Vector3;
}

export interface ShadowTimings {
  displayMs: number;
  scoreMs: number;
  readbackMs: number;
  readbackFrames: number;
  scoreCpuMs: number;
}

/**
 * Point-light shadow projector.
 *
 * For a point light and a planar screen, the shadow of an object is exactly
 * its perspective projection from the light onto the screen plane. So instead
 * of a shadow map, we render the casters from the lamp with an off-axis
 * frustum whose image plane IS the screen rectangle. The resulting texture
 * maps 1:1 onto the screen's UVs, is used directly for display (soft-edged in
 * the screen shader), and a tiny copy is read back for scoring. What the
 * player sees is exactly what is scored.
 */
export class ShadowLight {
  readonly cam = new PerspectiveCamera();
  readonly casterMaterial = new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide });
  readonly liveScene = new Scene();
  readonly ghostScene = new Scene();

  readonly displayRT: WebGLRenderTarget;
  readonly scoreRT: WebGLRenderTarget;
  readonly targetDisplayRT: WebGLRenderTarget;
  readonly targetScoreRT: WebGLRenderTarget;
  readonly scoreW: number;
  readonly scoreH: number;

  readonly timings: ShadowTimings = { displayMs: 0, scoreMs: 0, readbackMs: 0, readbackFrames: 0, scoreCpuMs: 0 };

  private spec: ScreenSpec;
  private readonly lightLocal = new Matrix4();
  private readonly prevClear = new Color();

  constructor(spec: ScreenSpec, displayW = 384, scoreW = 128) {
    this.spec = spec;
    const aspect = spec.width / spec.height;
    const displayH = Math.round(displayW / aspect);
    this.scoreW = scoreW;
    this.scoreH = Math.round(scoreW / aspect);
    const mk = (w: number, h: number, nearest: boolean) => {
      const rt = new WebGLRenderTarget(w, h, {
        depthBuffer: true,
        minFilter: nearest ? NearestFilter : LinearFilter,
        magFilter: nearest ? NearestFilter : LinearFilter,
        generateMipmaps: false,
      });
      return rt;
    };
    this.displayRT = mk(displayW, displayH, false);
    this.targetDisplayRT = mk(displayW, displayH, false);
    this.scoreRT = mk(this.scoreW, this.scoreH, true);
    this.targetScoreRT = mk(this.scoreW, this.scoreH, true);
    this.cam.matrixAutoUpdate = false;
    this.cam.matrixWorldAutoUpdate = true;
    this.configure(spec);
  }

  configure(spec: ScreenSpec): void {
    this.spec = spec;
    const { center, width, height, light } = spec;
    const d = light.z - center.z;
    const near = 0.02;
    const far = d + 0.05;
    const k = near / d;
    const left = (center.x - width / 2 - light.x) * k;
    const right = (center.x + width / 2 - light.x) * k;
    const bottom = (center.y - height / 2 - light.y) * k;
    const top = (center.y + height / 2 - light.y) * k;
    this.cam.projectionMatrix.makePerspective(left, right, top, bottom, near, far);
    this.cam.projectionMatrixInverse.copy(this.cam.projectionMatrix).invert();
    this.lightLocal.makeTranslation(light.x, light.y, light.z);
  }

  /** Call each frame with the stage's world matrix. */
  setStageMatrix(stageWorld: Matrix4): void {
    this.cam.matrix.multiplyMatrices(stageWorld, this.lightLocal);
    this.cam.matrixWorldNeedsUpdate = true;
  }

  renderLive(renderer: WebGLRenderer, score: boolean): void {
    let t = performance.now();
    this.cam.layers.set(LAYER_SCORED);
    this.cam.layers.enable(LAYER_DISPLAY_ONLY);
    this.renderTo(renderer, this.liveScene, this.displayRT);
    this.timings.displayMs = performance.now() - t;
    if (score) {
      t = performance.now();
      this.cam.layers.set(LAYER_SCORED);
      this.renderTo(renderer, this.liveScene, this.scoreRT);
      this.timings.scoreMs = performance.now() - t;
    }
  }

  /** A render target sized like the scoring grid (for per-puppet masks). */
  makeScoreRT(): WebGLRenderTarget {
    return new WebGLRenderTarget(this.scoreW, this.scoreH, {
      depthBuffer: true,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      generateMipmaps: false,
    });
  }

  /** Render the ghost casters' scored shadow (no forearm) into `rt`. */
  renderGhostScore(renderer: WebGLRenderer, rt: WebGLRenderTarget): void {
    this.cam.layers.set(LAYER_SCORED);
    this.renderTo(renderer, this.ghostScene, rt);
  }

  /** Render only the display version of the ghost (for animated puppets). */
  renderGhostDisplay(renderer: WebGLRenderer): void {
    this.cam.layers.set(LAYER_SCORED);
    this.cam.layers.enable(LAYER_DISPLAY_ONLY);
    this.renderTo(renderer, this.ghostScene, this.targetDisplayRT);
  }

  renderGhost(renderer: WebGLRenderer): void {
    this.cam.layers.set(LAYER_SCORED);
    this.cam.layers.enable(LAYER_DISPLAY_ONLY);
    this.renderTo(renderer, this.ghostScene, this.targetDisplayRT);
    this.cam.layers.set(LAYER_SCORED);
    this.renderTo(renderer, this.ghostScene, this.targetScoreRT);
  }

  private renderTo(renderer: WebGLRenderer, scene: Scene, rt: WebGLRenderTarget): void {
    const xrEnabled = renderer.xr.enabled;
    const prevRT = renderer.getRenderTarget();
    const prevAlpha = renderer.getClearAlpha();
    renderer.getClearColor(this.prevClear);
    const prevShadowAuto = renderer.shadowMap.autoUpdate;
    renderer.xr.enabled = false; // otherwise render() swaps in the XR camera
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, false);
    renderer.render(scene, this.cam);
    renderer.setRenderTarget(prevRT);
    renderer.setClearColor(this.prevClear, prevAlpha);
    renderer.shadowMap.autoUpdate = prevShadowAuto;
    renderer.xr.enabled = xrEnabled;
  }
}
