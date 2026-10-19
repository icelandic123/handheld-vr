import {
  BoxGeometry,
  Color,
  createSystem,
  CylinderGeometry,
  Group,
  Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PlaneGeometry,
  PointLight,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  SpotLight,
  Vector2,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { TheatreAudio } from './audio.js';
import { FONT, INK, INK_SOFT, TextBand, wrapText } from './hud.js';
import { createScreenMaterial } from './screen-material.js';
import { HandProxy } from './shadow/hand-proxy.js';
import { applyRoot, HandShape, rootFromWrist, solveHand, toIwerHandPose, wristPlacement } from './shadow/hand-rig.js';
import { J, JOINT_COUNT } from './shadow/joints.js';
import { PUPPETS, PuppetPose } from './shadow/poses.js';
import { ScoreResult, SilhouetteScorer } from './shadow/score.js';
import { ShadowLight } from './shadow/shadow-light.js';

/** Stage layout, stage-local metres. Origin = the seated player's eyes, -Z forward. */
export const STAGE = {
  screenCenter: new Vector3(0, 0.02, -1.35),
  screenW: 1.5,
  screenH: 1.0,
  light: new Vector3(0, -0.42, -0.12),
  /** Comfortable seated hand position whose shadow lands mid-screen. */
  handPoint: new Vector3(0, -0.33, -0.53),
  tableTop: -0.48,
  skipButton: new Vector3(0.3, -0.455, -0.38),
  shoulderL: new Vector3(-0.19, -0.27, 0.08),
  shoulderR: new Vector3(0.19, -0.27, 0.08),
};

const params = new URLSearchParams(location.search);
const NATIVE_SHADOWS = params.get('native') === '1';

type Hand = 'left' | 'right';
/** WebXR Hand Input bulk APIs (not in every lib.dom version). */
type XRFrameWithJoints = XRFrame & {
  fillPoses?: (spaces: XRSpace[], base: XRSpace, out: Float32Array) => boolean;
  fillJointRadii?: (spaces: XRJointSpace[], out: Float32Array) => boolean;
};
const HANDS: Hand[] = ['left', 'right'];

interface PerfStats {
  frames: number;
  avgFrameMs: number;
  avgUpdateMs: number;
  avgDisplayRenderMs: number;
  avgScoreRenderMs: number;
  avgScoreCpuMs: number;
  avgReadbackMs: number;
  avgReadbackFrames: number;
  samples: number;
}

export class TheatreSystem extends createSystem({}) {
  private stage!: Group;
  private anchored = false;
  private anchorFrames = 0;
  private light!: ShadowLight;
  private hands!: Record<Hand, HandProxy>;
  private ghosts!: Record<Hand, HandProxy>;
  private scorer!: SilhouetteScorer;
  private screenMesh!: Mesh<PlaneGeometry, Material>;
  private screenShader: ShaderMaterial | null = null;
  private title!: TextBand;
  private footer!: TextBand;
  private skipMesh!: Mesh;
  private readonly audio = new TheatreAudio();

  private readonly mats = new Float32Array(JOINT_COUNT * 16);
  private readonly radii = new Float32Array(JOINT_COUNT);
  private readonly ghostLocal = new Float32Array(JOINT_COUNT * 16);
  private readonly ghostWorld = new Float32Array(JOINT_COUNT * 16);
  private readonly jointSpaceCache = new WeakMap<XRHand, XRJointSpace[]>();
  private readonly tracked: Record<Hand, boolean> = { left: false, right: false };

  private frameNo = 0;
  private readbackPending = false;
  private readbackBuf!: Uint8Array;
  private targetBuf!: Uint8Array;
  private targetReady = false;
  private targetDirty = true;
  private result: ScoreResult = { score: 0, iou: 0, precision: 0, recall: 0, shadowArea: 0, targetArea: 0, dx: 0, dy: 0, scale: 1 };

  beat = 0;
  phase: 'playing' | 'alive' = 'playing';
  smoothScore = 0;
  threshold = 0.85;
  /** Score every Nth frame (3 = ~24 Hz at 72 fps). */
  scoreEvery = 3;
  private holdTime = 0;
  private aliveTime = 0;
  private lastSkip = -10;
  private elapsed = 0;

  private readonly stageInv = new Matrix4();
  private readonly tmpM = new Matrix4();
  private readonly tmpM2 = new Matrix4();
  private readonly tmpV = new Vector3();
  private readonly tmpV2 = new Vector3();
  private readonly tmpQ = new Quaternion();
  private readonly ikU = new Vector3();
  private readonly ikPole = new Vector3();
  private readonly perf: PerfStats = {
    frames: 0, avgFrameMs: 0, avgUpdateMs: 0, avgDisplayRenderMs: 0, avgScoreRenderMs: 0,
    avgScoreCpuMs: 0, avgReadbackMs: 0, avgReadbackFrames: 0, samples: 0,
  };

  init(): void {
    this.buildStage();
    this.light = new ShadowLight({
      center: STAGE.screenCenter,
      width: STAGE.screenW,
      height: STAGE.screenH,
      light: STAGE.light,
    });
    this.readbackBuf = new Uint8Array(this.light.scoreW * this.light.scoreH * 4);
    this.targetBuf = new Uint8Array(this.light.scoreW * this.light.scoreH * 4);
    this.scorer = new SilhouetteScorer(this.light.scoreW, this.light.scoreH, { tolerancePx: 2 });

    const handMat = new MeshStandardMaterial({ color: new Color(0.62, 0.45, 0.36), roughness: 0.75 });
    this.hands = {
      left: new HandProxy(handMat, this.light.casterMaterial),
      right: new HandProxy(handMat, this.light.casterMaterial),
    };
    this.ghosts = {
      left: new HandProxy(null, this.light.casterMaterial),
      right: new HandProxy(null, this.light.casterMaterial),
    };
    for (const h of HANDS) {
      this.light.liveScene.add(this.hands[h].casterRoot);
      this.world.createTransformEntity(this.hands[h].visibleRoot, { parent: this.playerEntity, persistent: true });
      this.hands[h].setTracked(false, true);
      this.light.ghostScene.add(this.ghosts[h].casterRoot);
      if (NATIVE_SHADOWS) {
        this.hands[h].visibleRoot.traverse((o) => (o.castShadow = true));
      }
    }

    this.cleanupFuncs.push(
      this.visibilityState.subscribe((v) => {
        if (v !== VisibilityState.NonImmersive) {
          this.audio.start();
          this.anchored = false;
          this.anchorFrames = 0;
        } else {
          this.anchored = false;
        }
      }),
    );

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'n') this.nextBeat();
    };
    window.addEventListener('keydown', onKey);
    this.cleanupFuncs.push(() => window.removeEventListener('keydown', onKey));

    this.startBeat(0);
    this.installDebugApi();
  }

  // ---------------------------------------------------------------- stage
  private buildStage(): void {
    const stage = new Group();
    stage.name = 'Stage';
    this.stage = stage;
    const { screenCenter: c, screenW: w, screenH: h } = STAGE;

    // Screen frame (dark wood).
    const wood = new MeshStandardMaterial({ color: new Color(0.16, 0.08, 0.04), roughness: 0.8 });
    const bar = 0.05;
    const frame = new Group();
    const mk = (sx: number, sy: number, x: number, y: number) => {
      const m = new Mesh(new BoxGeometry(sx, sy, 0.04), wood);
      m.position.set(x, y, 0);
      frame.add(m);
    };
    mk(w + bar * 2, bar, 0, h / 2 + bar / 2);
    mk(w + bar * 2, bar, 0, -h / 2 - bar / 2);
    mk(bar, h, -w / 2 - bar / 2, 0);
    mk(bar, h, w / 2 + bar / 2, 0);
    frame.position.copy(c);
    stage.add(frame);

    // Paper screen.
    const screen: Mesh<PlaneGeometry, Material> = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial());
    screen.name = 'PaperScreen';
    screen.position.copy(c);
    stage.add(screen);
    this.screenMesh = screen;

    // Text bands printed on the paper.
    this.title = new TextBand(w * 0.96, 0.17);
    this.title.mesh.position.set(c.x, c.y + h / 2 - 0.1, c.z + 0.003);
    stage.add(this.title.mesh);
    this.footer = new TextBand(w * 0.96, 0.09);
    this.footer.mesh.position.set(c.x, c.y - h / 2 + 0.06, c.z + 0.003);
    stage.add(this.footer.mesh);

    // Table.
    const table = new Mesh(
      new BoxGeometry(1.1, 0.04, 0.7),
      new MeshStandardMaterial({ color: new Color(0.22, 0.12, 0.07), roughness: 0.9 }),
    );
    table.position.set(0, STAGE.tableTop - 0.02, -0.45);
    table.receiveShadow = true;
    stage.add(table);

    // Lamp: brass base + glowing bulb + real point light for the room.
    const lamp = new Group();
    const brass = new MeshStandardMaterial({ color: new Color(0.55, 0.38, 0.15), metalness: 0.6, roughness: 0.35 });
    const base = new Mesh(new CylinderGeometry(0.035, 0.045, 0.03, 24), brass);
    base.position.set(0, STAGE.tableTop + 0.015, 0);
    lamp.add(base);
    const stem = new Mesh(new CylinderGeometry(0.006, 0.006, STAGE.light.y - STAGE.tableTop - 0.02, 8), brass);
    stem.position.set(0, (STAGE.light.y + STAGE.tableTop) / 2, 0);
    lamp.add(stem);
    const bulb = new Mesh(new SphereGeometry(0.02, 20, 14), new MeshBasicMaterial({ color: new Color(1.0, 0.85, 0.55) }));
    bulb.position.set(0, STAGE.light.y, 0);
    lamp.add(bulb);
    lamp.position.set(STAGE.light.x, 0, STAGE.light.z);
    stage.add(lamp);
    const glow = new PointLight(new Color(1.0, 0.75, 0.45), 1.2, 4, 2);
    glow.position.copy(STAGE.light);
    stage.add(glow);

    // Skip bell: poke it with a fingertip.
    this.skipMesh = new Mesh(
      new SphereGeometry(0.022, 20, 12),
      new MeshStandardMaterial({ color: new Color(0.7, 0.5, 0.2), emissive: new Color(0.25, 0.12, 0.02), metalness: 0.5, roughness: 0.3 }),
    );
    this.skipMesh.position.copy(STAGE.skipButton);
    stage.add(this.skipMesh);

    if (NATIVE_SHADOWS) {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = PCFSoftShadowMap;
      const spot = new SpotLight(new Color(1, 0.85, 0.6), 6, 4, Math.PI / 3.2, 0.4, 1.2);
      spot.position.copy(STAGE.light);
      spot.target.position.copy(STAGE.screenCenter);
      spot.castShadow = true;
      spot.shadow.mapSize.set(1024, 1024);
      spot.shadow.camera.near = 0.05;
      spot.shadow.camera.far = 3;
      spot.shadow.bias = -0.0005;
      stage.add(spot, spot.target);
      const paper = new MeshStandardMaterial({ color: new Color(1, 0.86, 0.62), roughness: 1 });
      screen.material = paper;
      screen.receiveShadow = true;
    }

    this.world.createTransformEntity(stage, { persistent: true });
  }

  private attachScreenShader(): void {
    if (NATIVE_SHADOWS || this.screenShader) return;
    const rt = this.light.displayRT;
    this.screenShader = createScreenMaterial(
      rt.texture,
      this.light.targetDisplayRT.texture,
      new Vector2(1 / rt.width, 1 / rt.height),
    );
    this.screenMesh.material = this.screenShader;
  }

  /** Place the stage relative to the viewer (seated: eyes at origin, yaw only). */
  private anchorStage(): void {
    const cam = this.camera;
    cam.updateMatrixWorld(true);
    cam.getWorldPosition(this.tmpV);
    cam.getWorldQuaternion(this.tmpQ);
    const fwd = this.tmpV2.set(0, 0, -1).applyQuaternion(this.tmpQ);
    const yaw = Math.atan2(-fwd.x, -fwd.z);
    this.stage.position.copy(this.tmpV);
    this.stage.rotation.set(0, yaw, 0);
    this.stage.updateMatrixWorld(true);
    this.targetDirty = true;
  }

  recenter(): void {
    this.anchored = false;
    this.anchorFrames = 0;
  }

  // ---------------------------------------------------------------- beats
  get puppet(): PuppetPose {
    return PUPPETS[this.beat % PUPPETS.length];
  }

  startBeat(i: number): void {
    this.beat = ((i % PUPPETS.length) + PUPPETS.length) % PUPPETS.length;
    this.phase = 'playing';
    this.holdTime = 0;
    this.aliveTime = 0;
    this.smoothScore = 0;
    this.targetDirty = true;
    this.targetReady = false;
    this.audio.pageTurn();
  }

  nextBeat(): void {
    this.startBeat(this.beat + 1);
  }

  /** Pose the ghost hands (stage-local) for a puppet, optionally animated. */
  private poseGhost(p: PuppetPose, aliveT: number): void {
    for (const h of HANDS) {
      const placed = p.hands[h];
      const g = this.ghosts[h];
      if (!placed) {
        g.setTracked(false, false);
        continue;
      }
      const shape = aliveT > 0 ? animateShape(p.id, placed.shape, aliveT) : placed.shape;
      solveHand(shape, h, this.ghostLocal, this.radii);
      wristPlacement(placed, STAGE.handPoint, this.tmpM);
      if (aliveT > 0) wiggle(p.id, h, aliveT, this.tmpM);
      rootFromWrist(this.tmpM, this.ghostLocal, this.tmpM2);
      applyRoot(this.tmpM2, this.ghostLocal, this.ghostWorld);
      g.setFromMatrices(this.ghostWorld, this.radii);
      g.elbow.copy(this.estimateElbow(g.joints[J.wrist], h, this.tmpV));
      g.hasForearm = true;
      g.rebuild();
      g.casterRoot.matrix.copy(this.stage.matrixWorld);
      g.setTracked(true, false);
    }
  }

  /** Two-bone IK for a plausible forearm (stage-local). */
  private estimateElbow(wrist: Vector3, h: Hand, out: Vector3): Vector3 {
    const s = h === 'left' ? STAGE.shoulderL : STAGE.shoulderR;
    const a = 0.3;
    const b = 0.27;
    const u = this.ikU.subVectors(wrist, s);
    let d = u.length();
    if (d < 1e-4) return out.copy(s);
    u.multiplyScalar(1 / d);
    d = Math.min(d, a + b - 1e-3);
    const x = (a * a - b * b + d * d) / (2 * d);
    const hh = Math.sqrt(Math.max(0, a * a - x * x));
    // Pole: elbows hang down and slightly out.
    const pole = this.ikPole.set(h === 'left' ? -0.5 : 0.5, -1, 0.15);
    pole.addScaledVector(u, -pole.dot(u)).normalize();
    return out.copy(s).addScaledVector(u, x).addScaledVector(pole, hh);
  }

  // ---------------------------------------------------------------- frame
  update(delta: number): void {
    const t0 = performance.now();
    this.elapsed += delta;
    this.frameNo++;
    const renderer = this.renderer;
    this.attachScreenShader();

    // Anchor the stage a few frames into the session (pose settles).
    if (!this.anchored) {
      this.anchorFrames++;
      if (this.anchorFrames > 3) {
        this.anchorStage();
        this.anchored = true;
      }
    }
    this.stage.updateMatrixWorld(true);
    this.stageInv.copy(this.stage.matrixWorld).invert();
    this.light.setStageMatrix(this.stage.matrixWorld);

    // Player hands from the live XR frame.
    this.readHands();

    // Target ghost (re-rendered when stale or when the puppet is alive).
    if (this.targetDirty || this.phase === 'alive') {
      this.poseGhost(this.puppet, this.phase === 'alive' ? this.aliveTime + 0.0001 : 0);
      this.light.renderGhost(renderer);
      if (this.targetDirty) {
        this.targetDirty = false;
        void renderer
          .readRenderTargetPixelsAsync(this.light.targetScoreRT, 0, 0, this.light.scoreW, this.light.scoreH, this.targetBuf)
          .then(() => {
            this.scorer.setTarget(this.targetBuf);
            this.targetReady = true;
          });
      }
    }

    // Live shadow: display every frame, score every 3rd frame (~24 Hz at 72 fps).
    const wantScore = this.targetReady && !this.readbackPending && this.frameNo % this.scoreEvery === 0 && this.phase === 'playing';
    this.light.renderLive(renderer, wantScore);
    if (wantScore) this.kickReadback();

    // Game state.
    if (this.phase === 'playing') {
      if (this.smoothScore >= this.threshold) this.holdTime += delta;
      else this.holdTime = Math.max(0, this.holdTime - delta * 2);
      if (this.holdTime > 0.5) {
        this.phase = 'alive';
        this.aliveTime = 0;
        this.audio.success();
      }
    } else {
      this.aliveTime += delta;
      if (this.aliveTime > 4.0) this.nextBeat();
    }
    this.checkSkip();

    if (this.screenShader) {
      const u = this.screenShader.uniforms;
      u.uTime.value = this.elapsed;
      u.uMatch.value = this.phase === 'alive' ? 1 : Math.max(0, (this.smoothScore - 0.4) / (this.threshold - 0.4));
      u.uAlive.value = this.phase === 'alive' ? Math.min(1, this.aliveTime * 3) : 0;
      u.uTargetAlpha.value = 1;
    }
    this.drawHud();

    const dt = performance.now() - t0;
    const p = this.perf;
    p.frames++;
    const k = 1 / Math.min(p.frames, 120);
    p.avgUpdateMs += (dt - p.avgUpdateMs) * k;
    p.avgFrameMs += (delta * 1000 - p.avgFrameMs) * k;
    p.avgDisplayRenderMs += (this.light.timings.displayMs - p.avgDisplayRenderMs) * k;
  }

  private kickReadback(): void {
    const renderer = this.renderer;
    this.readbackPending = true;
    const t0 = performance.now();
    const f0 = this.frameNo;
    const scoreRenderMs = this.light.timings.scoreMs;
    renderer
      .readRenderTargetPixelsAsync(this.light.scoreRT, 0, 0, this.light.scoreW, this.light.scoreH, this.readbackBuf)
      .then(() => {
        const t1 = performance.now();
        this.scorer.score(this.readbackBuf, 4, this.result);
        const cpu = performance.now() - t1;
        const p = this.perf;
        p.samples++;
        const k = 1 / Math.min(p.samples, 60);
        p.avgScoreCpuMs += (cpu - p.avgScoreCpuMs) * k;
        p.avgReadbackMs += (t1 - t0 - p.avgReadbackMs) * k;
        p.avgReadbackFrames += (this.frameNo - f0 - p.avgReadbackFrames) * k;
        p.avgScoreRenderMs += (scoreRenderMs - p.avgScoreRenderMs) * k;
        const target = this.result.score;
        this.smoothScore += (target - this.smoothScore) * 0.35;
        this.audio.progress(this.smoothScore);
      })
      .catch(() => undefined)
      .finally(() => {
        this.readbackPending = false;
      });
  }

  private readHands(): void {
    const frame = this.xrFrame as XRFrameWithJoints | undefined;
    const session = this.renderer.xr.getSession();
    const ref = this.renderer.xr.getReferenceSpace();
    this.tracked.left = false;
    this.tracked.right = false;
    if (frame && session && ref) {
      for (const src of session.inputSources) {
        if (!src.hand || (src.handedness !== 'left' && src.handedness !== 'right')) continue;
        let spaces = this.jointSpaceCache.get(src.hand);
        if (!spaces) {
          spaces = Array.from(src.hand.values());
          this.jointSpaceCache.set(src.hand, spaces);
        }
        let ok = false;
        if (frame.fillPoses && frame.fillJointRadii) {
          ok = frame.fillPoses(spaces, ref, this.mats) && frame.fillJointRadii(spaces, this.radii);
        } else {
          ok = true;
          for (let i = 0; i < JOINT_COUNT; i++) {
            const pose = frame.getJointPose?.(spaces[i], ref);
            if (!pose) {
              ok = false;
              break;
            }
            this.mats.set(pose.transform.matrix, i * 16);
            this.radii[i] = pose.radius ?? 0.01;
          }
        }
        if (!ok) continue;
        const h = src.handedness;
        const proxy = this.hands[h];
        proxy.setFromMatrices(this.mats, this.radii);
        // Forearm: estimate elbow in stage space, convert to player space.
        this.player.updateMatrixWorld(true);
        this.tmpV.copy(proxy.joints[J.wrist]).applyMatrix4(this.player.matrixWorld).applyMatrix4(this.stageInv);
        this.estimateElbow(this.tmpV, h, proxy.elbow);
        proxy.elbow.applyMatrix4(this.stage.matrixWorld);
        this.tmpM.copy(this.player.matrixWorld).invert();
        proxy.elbow.applyMatrix4(this.tmpM);
        proxy.hasForearm = true;
        proxy.rebuild();
        this.tracked[h] = true;
      }
    }
    for (const h of HANDS) {
      const proxy = this.hands[h];
      proxy.setTracked(this.tracked[h], true);
      proxy.casterRoot.matrix.copy(this.player.matrixWorld);
    }
  }

  private checkSkip(): void {
    if (this.elapsed - this.lastSkip < 1.2) return;
    this.tmpV2.copy(STAGE.skipButton).applyMatrix4(this.stage.matrixWorld);
    for (const h of HANDS) {
      if (!this.tracked[h]) continue;
      this.tmpV.copy(this.hands[h].joints[9]).applyMatrix4(this.player.matrixWorld);
      if (this.tmpV.distanceTo(this.tmpV2) < 0.035) {
        this.lastSkip = this.elapsed;
        this.nextBeat();
        return;
      }
    }
  }

  private drawHud(): void {
    const p = this.puppet;
    this.title.draw(`${p.id}|${this.phase}`, (ctx, w, h) => {
      ctx.fillStyle = INK;
      ctx.textAlign = 'center';
      ctx.font = `bold ${Math.round(h * 0.42)}px ${FONT}`;
      ctx.fillText(this.phase === 'alive' ? `${p.name} comes alive!` : p.name, w / 2, h * 0.45);
      ctx.fillStyle = INK_SOFT;
      ctx.font = `${Math.round(h * 0.24)}px ${FONT}`;
      const lines = wrapText(ctx, p.hint, w * 0.92);
      ctx.fillText(lines[0] ?? '', w / 2, h * 0.82);
    });
    const pct = Math.round(this.smoothScore * 50) * 2;
    const anyHand = this.tracked.left || this.tracked.right;
    this.footer.draw(`${pct}|${this.beat}|${anyHand}|${this.phase}`, (ctx, w, h) => {
      ctx.fillStyle = INK_SOFT;
      ctx.font = `${Math.round(h * 0.4)}px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.fillText(`Scene ${this.beat + 1} of ${PUPPETS.length}`, w * 0.02, h * 0.62);
      ctx.textAlign = 'right';
      ctx.fillText(anyHand ? `${pct}%` : 'Raise your hands into the lamplight', w * 0.98, h * 0.62);
      // progress bar
      const bx = w * 0.3;
      const bw = w * 0.45;
      const by = h * 0.35;
      const bh = h * 0.3;
      ctx.strokeStyle = INK_SOFT;
      ctx.lineWidth = 3;
      ctx.strokeRect(bx, by, bw, bh);
      ctx.fillStyle = this.phase === 'alive' ? 'rgba(170,90,20,0.9)' : INK;
      ctx.fillRect(bx, by, bw * Math.min(1, this.smoothScore / this.threshold), bh);
    });
  }

  // ---------------------------------------------------------------- debug
  private installDebugApi(): void {
    const api = {
      puppets: PUPPETS.map((p) => p.id),
      setBeat: (i: number) => this.startBeat(i),
      next: () => this.nextBeat(),
      recenter: () => this.recenter(),
      setTolerance: (px: number) => this.scorer.setOptions({ tolerancePx: px }),
      setThreshold: (t: number) => (this.threshold = t),
      setScoreEvery: (n: number) => (this.scoreEvery = Math.max(1, Math.round(n))),
      setScoreOptions: (o: Record<string, unknown>) => this.scorer.setOptions(o),
      state: () => ({
        beat: this.beat,
        puppet: this.puppet.id,
        phase: this.phase,
        smoothScore: this.smoothScore,
        result: { ...this.result },
        tracked: { ...this.tracked },
        targetReady: this.targetReady,
        stage: this.stage.matrixWorld.toArray(),
        perf: { ...this.perf },
        scoreGrid: [this.light.scoreW, this.light.scoreH],
        displayRT: [this.light.displayRT.width, this.light.displayRT.height],
      }),
      /** IWER-ready hand poses + root placements (world) for a puppet. */
      emulatorPose: (id: string, jitter = 0) => {
        const p = PUPPETS.find((x) => x.id === id);
        if (!p) return null;
        const out: Record<string, unknown> = {};
        for (const h of HANDS) {
          const placed = p.hands[h];
          if (!placed) continue;
          const shape = jitter > 0 ? jitterShape(placed.shape, jitter) : placed.shape;
          solveHand(shape, h, this.ghostLocal, this.radii);
          wristPlacement(placed, STAGE.handPoint, this.tmpM);
          rootFromWrist(this.tmpM, this.ghostLocal, this.tmpM2);
          this.tmpM2.premultiply(this.stage.matrixWorld);
          const pos = new Vector3();
          const q = new Quaternion();
          const s = new Vector3();
          this.tmpM2.decompose(pos, q, s);
          out[h] = { pose: toIwerHandPose(shape), position: pos.toArray(), quaternion: q.toArray() };
        }
        return out;
      },
      /** Raw RGBA of the last score readback (for contact sheets). */
      scoreBuffers: () => ({ w: this.light.scoreW, h: this.light.scoreH, live: Array.from(this.readbackBuf), target: Array.from(this.targetBuf) }),
    };
    (window as unknown as { __shadowplay: typeof api }).__shadowplay = api;
  }
}

/** Puppet-specific "alive" animation: tweak the shape over time. */
function animateShape(id: string, s: HandShape, t: number): HandShape {
  const osc = Math.sin(t * 9) * 0.5 + 0.5;
  switch (id) {
    case 'dog':
      return { ...s, pinky: { ...s.pinky, mcp: 15 + 50 * osc } };
    case 'rabbit':
      return {
        ...s,
        index: { ...s.index, mcp: 15 * osc, spread: (s.index.spread ?? 0) + 6 * osc },
        middle: { ...s.middle, mcp: 15 * (1 - osc) },
      };
    case 'bird': {
      const f = 25 * Math.sin(t * 7);
      const w = (c: HandShape['index']) => ({ ...c, mcp: c.mcp + f, pip: c.pip + Math.max(0, f) * 0.5 });
      return { ...s, index: w(s.index), middle: w(s.middle), ring: w(s.ring), pinky: w(s.pinky) };
    }
    default: {
      const f = 10 * Math.sin(t * 6);
      return { ...s, index: { ...s.index, mcp: f }, middle: { ...s.middle, mcp: f }, ring: { ...s.ring, mcp: f }, pinky: { ...s.pinky, mcp: f } };
    }
  }
}

/** Whole-hand motion while alive (a hop, a wave). Mutates the wrist placement. */
function wiggle(id: string, _h: Hand, t: number, m: Matrix4): void {
  const e = m.elements;
  if (id === 'rabbit') e[13] += Math.abs(Math.sin(t * 5)) * 0.03;
  else if (id === 'bird') e[13] += Math.sin(t * 3.5) * 0.02;
  else if (id === 'hello') e[12] += Math.sin(t * 6) * 0.03;
}

function jitterShape(s: HandShape, deg: number): HandShape {
  const r = () => (Math.random() * 2 - 1) * deg;
  const f = (c: HandShape['index']) => ({ mcp: c.mcp + r(), pip: Math.max(0, c.pip + r()), dip: Math.max(0, c.dip + r()), spread: (c.spread ?? 0) + r() * 0.5 });
  return {
    thumb: { ...s.thumb, mcp: s.thumb.mcp + r(), ip: s.thumb.ip + r(), cmcAbd: (s.thumb.cmcAbd ?? 0) + r(), cmcFlex: (s.thumb.cmcFlex ?? 0) + r() },
    index: f(s.index),
    middle: f(s.middle),
    ring: f(s.ring),
    pinky: f(s.pinky),
  };
}
