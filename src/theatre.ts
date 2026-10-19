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
  SessionMode,
  ShaderMaterial,
  SphereGeometry,
  SpotLight,
  Vector2,
  Vector3,
  Vector4,
  VisibilityState,
  WebGLRenderTarget,
} from '@iwsdk/core';
import { TheatreAudio } from './audio.js';
import { FONT, INK, INK_SOFT, TextBand, wrapText } from './hud.js';
import { createScreenMaterial, MAX_EYES } from './screen-material.js';
import { drawSketchCard } from './sketches.js';
import { HandProxy } from './shadow/hand-proxy.js';
import {
  applyRoot,
  chainLength,
  HandShape,
  lerpPlaced,
  lerpShape,
  PlacedHand,
  REST_CHAIN_LENGTH,
  rootFromWrist,
  solveHand,
  toIwerHandPose,
  wristPlacement,
} from './shadow/hand-rig.js';
import { J, JOINT_COUNT } from './shadow/joints.js';
import { mirrorPuppet, PUPPETS, PuppetPose, REST_PLACEMENT, RESTING } from './shadow/poses.js';
import { cycled, getSettings, onSettingsChange, SCREEN_SCALE, updateSettings } from './settings.js';
import { SettingsCard } from './settings-card.js';
import { ScoreResult, SilhouetteScorer } from './shadow/score.js';
import { ShadowLight } from './shadow/shadow-light.js';
import { Cue, Scene, SCENES } from './story.js';

/** Stage layout, stage-local metres. Origin = the seated player's eyes, -Z forward. */
const GILT = '#f4d9a6';
const GILT_SOFT = '#e2c08e';

export const STAGE = {
  screenCenter: new Vector3(0, 0.02, -1.35),
  screenW: 1.5,
  screenH: 1.0,
  light: new Vector3(0, -0.42, -0.12),
  /** Comfortable seated hand position whose shadow lands mid-screen. */
  handPoint: new Vector3(0, -0.33, -0.53),
  tableTop: -0.48,
  skipButton: new Vector3(0.3, -0.455, -0.36),
  exitButton: new Vector3(-0.3, -0.455, -0.36),
  shoulderL: new Vector3(-0.19, -0.27, 0.08),
  shoulderR: new Vector3(0.19, -0.27, 0.08),
};

/** How long a puppet performs after the player lands its shape. */
export const ALIVE_SECONDS = 6;

const params = new URLSearchParams(location.search);
const NATIVE_SHADOWS = params.get('native') === '1';

type Hand = 'left' | 'right';
const HANDS: Hand[] = ['left', 'right'];
/** WebXR Hand Input bulk APIs (not in every lib.dom version). */
type XRFrameWithJoints = XRFrame & {
  fillPoses?: (spaces: XRSpace[], base: XRSpace, out: Float32Array) => boolean;
  fillJointRadii?: (spaces: XRJointSpace[], out: Float32Array) => boolean;
};

export type Phase = 'playing' | 'alive' | 'bow' | 'closing' | 'closed';

interface Mask {
  rt: WebGLRenderTarget;
  buf: Uint8Array;
  scorer: SilhouetteScorer;
}

interface GhostActor {
  puppet: PuppetPose;
  aliveT: number;
  dx: number;
  scale: number;
  bow: number;
}

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

export interface EmulatorHand {
  pose: ReturnType<typeof toIwerHandPose>;
  position: number[];
  quaternion: number[];
}

export class TheatreSystem extends createSystem({}) {
  private stage!: Group;
  private anchored = false;
  private anchorFrames = 0;
  private light!: ShadowLight;
  private hands!: Record<Hand, HandProxy>;
  private readonly ghosts: HandProxy[] = [];
  private screenMesh!: Mesh<PlaneGeometry, Material>;
  private screenShader: ShaderMaterial | null = null;
  private title!: TextBand;
  private footer!: TextBand;
  /** Everything on the paper screen; scaled about the eyes for the screen-distance setting. */
  private screenGroup!: Group;
  private table!: Mesh;
  private settingsCard!: SettingsCard;
  /** Puppets as the player makes them (mirrored for right-handed play). */
  private puppetDefs = new Map<string, PuppetPose>();
  /** Ink drawing of the character the player is making. */
  private card!: TextBand;
  /** "Woof!" when a puppet comes alive. */
  private callout!: TextBand;
  /** Eyes of the posed ghosts this frame: (u, v, radius m, unused). */
  private readonly eyes: Vector4[] = Array.from({ length: MAX_EYES }, () => new Vector4());
  private eyeCount = 0;
  private readonly eyeShift = new Vector2();
  private bulb!: Mesh<SphereGeometry, MeshBasicMaterial>;
  private glow!: PointLight;
  readonly audio = new TheatreAudio();

  private readonly mats = new Float32Array(JOINT_COUNT * 16);
  private readonly radii = new Float32Array(JOINT_COUNT);
  private readonly ghostLocal = new Float32Array(JOINT_COUNT * 16);
  private readonly ghostWorld = new Float32Array(JOINT_COUNT * 16);
  private readonly ghostRadii = new Float32Array(JOINT_COUNT);
  private readonly jointSpaceCache = new WeakMap<XRHand, XRJointSpace[]>();
  readonly tracked: Record<Hand, boolean> = { left: false, right: false };

  // Masks: one per puppet, rendered from the ghost hand at the player's hand size.
  private readonly masks = new Map<string, Mask>();
  private masksReady = false;
  private masksDirty = true;
  private masksBuilding = false;
  /** Puppets whose silhouettes are close enough to the current target to matter. */
  private rivals: string[] = [];

  private frameNo = 0;
  private readbackPending = false;
  private readbackBuf!: Uint8Array;
  private targetDisplayDirty = true;
  private result: ScoreResult = { score: 0, iou: 0, precision: 0, recall: 0, shadowArea: 0, targetArea: 0, dx: 0, dy: 0, scale: 1 };
  private readonly rivalResult: ScoreResult = { ...this.result };

  // Story state.
  sceneIndex = 0;
  phase: Phase = 'playing';
  phaseTime = 0;
  smoothScore = 0;
  smoothRunner = 0;
  runnerId = '';
  /** Forgiving on purpose: thresholds are not yet tuned on a real headset. */
  threshold = 0.8;
  margin = 0.03;
  /** Score every Nth frame (3 = ~24 Hz at 72 fps). */
  scoreEvery = 3;
  private holdTime = 0;
  private lastPoke = -10;
  elapsed = 0;
  lamp = 0.25;
  private lampTarget = 0.25;
  curtain = 0;

  // Hand size fitting.
  handScale = 1;
  private measuredScale = 1;

  /** Fixed-step mode for deterministic video capture. */
  stepMode = false;
  stepDt = 1 / 24;
  private pendingSteps = 0;
  /** Steps consumed so far (lets a recorder know a stepped frame has run). */
  stepCount = 0;
  /** Called every frame with the story clock (used by the demo autopilot). */
  onFrame: ((dt: number) => void) | null = null;

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
    this.rebuildPuppets();
    this.buildStage();
    this.light = new ShadowLight(this.screenSpec());
    this.readbackBuf = new Uint8Array(this.light.scoreW * this.light.scoreH * 4);
    for (const p of PUPPETS) {
      const scorer = new SilhouetteScorer(this.light.scoreW, this.light.scoreH, { tolerancePx: 1 });
      this.masks.set(p.id, { rt: this.light.makeScoreRT(), buf: new Uint8Array(this.light.scoreW * this.light.scoreH * 4), scorer });
    }

    const handMat = new MeshStandardMaterial({ color: new Color(0.62, 0.45, 0.36), roughness: 0.75 });
    this.hands = {
      left: new HandProxy(handMat, this.light.casterMaterial),
      right: new HandProxy(handMat, this.light.casterMaterial),
    };
    for (const h of HANDS) {
      this.light.liveScene.add(this.hands[h].casterRoot);
      this.world.createTransformEntity(this.hands[h].visibleRoot, { parent: this.playerEntity, persistent: true });
      this.hands[h].setTracked(false, true);
      if (NATIVE_SHADOWS) this.hands[h].visibleRoot.traverse((o) => (o.castShadow = true));
    }
    for (let i = 0; i < 8; i++) {
      const g = new HandProxy(null, this.light.casterMaterial);
      g.setTracked(false, false);
      this.light.ghostScene.add(g.casterRoot);
      this.ghosts.push(g);
    }

    this.cleanupFuncs.push(
      this.visibilityState.subscribe((v) => {
        if (v !== VisibilityState.NonImmersive) this.audio.start();
        this.anchored = false;
        this.anchorFrames = 0;
      }),
    );

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'n') this.nextScene();
    };
    window.addEventListener('keydown', onKey);
    this.cleanupFuncs.push(() => window.removeEventListener('keydown', onKey));

    this.cleanupFuncs.push(
      onSettingsChange((_s, changed) => {
        if (changed.includes('hand')) {
          this.rebuildPuppets();
          this.masksDirty = true;
        }
        if (changed.includes('screen')) this.applyScreenDistance();
        this.targetDisplayDirty = true;
      }),
    );
    this.applyScreenDistance();

    this.startScene(0);
    this.installDebugApi();
  }

  private rebuildPuppets(): void {
    const right = getSettings().hand === 'right';
    this.puppetDefs = new Map(PUPPETS.map((p) => [p.id, right ? mirrorPuppet(p) : p]));
  }

  puppetDef(id: string): PuppetPose {
    const p = this.puppetDefs.get(id);
    if (!p) throw new Error(`Unknown puppet ${id}`);
    return p;
  }

  /** The screen as the shadow projector sees it (stage-local, after the distance setting). */
  private screenSpec(): { center: Vector3; width: number; height: number; light: Vector3 } {
    const k = SCREEN_SCALE[getSettings().screen];
    return {
      center: STAGE.screenCenter.clone().multiplyScalar(k),
      width: STAGE.screenW * k,
      height: STAGE.screenH * k,
      light: STAGE.light,
    };
  }

  private applyScreenDistance(): void {
    const k = SCREEN_SCALE[getSettings().screen];
    this.screenGroup.scale.setScalar(k);
    this.screenGroup.updateMatrixWorld(true);
    this.light.configure(this.screenSpec());
    this.masksDirty = true;
    this.targetDisplayDirty = true;
  }

  // ---------------------------------------------------------------- stage
  private buildStage(): void {
    const stage = new Group();
    stage.name = 'Stage';
    this.stage = stage;
    const { screenCenter: c, screenW: w, screenH: h } = STAGE;

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
    const screenGroup = new Group();
    screenGroup.name = 'ScreenGroup';
    this.screenGroup = screenGroup;
    stage.add(screenGroup);
    screenGroup.add(frame);

    const screen: Mesh<PlaneGeometry, Material> = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial());
    screen.name = 'PaperScreen';
    screen.position.copy(c);
    screenGroup.add(screen);
    this.screenMesh = screen;

    this.title = new TextBand(w * 0.96, 0.2);
    this.title.mesh.position.set(c.x, c.y + h / 2 - 0.12, c.z + 0.003);
    screenGroup.add(this.title.mesh);
    this.footer = new TextBand(w * 0.96, 0.1);
    this.footer.mesh.position.set(c.x, c.y - h / 2 + 0.065, c.z + 0.003);
    screenGroup.add(this.footer.mesh);
    this.card = new TextBand(0.26, 0.24, 384);
    this.card.mesh.position.set(c.x - w / 2 + 0.17, c.y + h / 2 - 0.37, c.z + 0.003);
    screenGroup.add(this.card.mesh);
    this.callout = new TextBand(0.3, 0.12, 512);
    this.callout.mesh.visible = false;
    this.callout.mesh.renderOrder = 3;
    screenGroup.add(this.callout.mesh);

    const table = new Mesh(
      new BoxGeometry(1.1, 0.04, 0.7),
      new MeshStandardMaterial({ color: new Color(0.22, 0.12, 0.07), roughness: 0.9 }),
    );
    table.position.set(0, STAGE.tableTop - 0.02, -0.45);
    table.receiveShadow = true;
    stage.add(table);
    this.table = table;
    this.settingsCard = new SettingsCard();
    this.settingsCard.mesh.position.set(-0.44, STAGE.tableTop + 0.07, -0.33);
    this.settingsCard.mesh.rotation.set(-0.75, 0.55, 0, 'YXZ');
    stage.add(this.settingsCard.mesh);

    const lamp = new Group();
    const brass = new MeshStandardMaterial({ color: new Color(0.55, 0.38, 0.15), metalness: 0.6, roughness: 0.35 });
    const base = new Mesh(new CylinderGeometry(0.035, 0.045, 0.03, 24), brass);
    base.position.set(0, STAGE.tableTop + 0.015, 0);
    lamp.add(base);
    const stem = new Mesh(new CylinderGeometry(0.006, 0.006, STAGE.light.y - STAGE.tableTop - 0.02, 8), brass);
    stem.position.set(0, (STAGE.light.y + STAGE.tableTop) / 2, 0);
    lamp.add(stem);
    this.bulb = new Mesh(new SphereGeometry(0.02, 20, 14), new MeshBasicMaterial({ color: new Color(1.0, 0.85, 0.55) }));
    this.bulb.position.set(0, STAGE.light.y, 0);
    lamp.add(this.bulb);
    lamp.position.set(STAGE.light.x, 0, STAGE.light.z);
    stage.add(lamp);
    this.glow = new PointLight(new Color(1.0, 0.75, 0.45), 1.2, 4, 2);
    this.glow.position.copy(STAGE.light);
    stage.add(this.glow);

    // Two pokeable bells on the table: right = skip / replay, left = leave.
    const bell = (pos: Vector3, color: Color, label: string) => {
      const m = new Mesh(
        new SphereGeometry(0.022, 20, 12),
        new MeshStandardMaterial({ color, emissive: color.clone().multiplyScalar(0.35), metalness: 0.5, roughness: 0.3 }),
      );
      m.position.copy(pos);
      stage.add(m);
      const tag = new TextBand(0.12, 0.035, 256);
      tag.draw(label, (ctx, tw, th) => {
        ctx.fillStyle = 'rgba(255, 220, 170, 0.95)';
        ctx.font = `${Math.round(th * 0.62)}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText(label, tw / 2, th * 0.72);
      });
      tag.mesh.position.set(pos.x, STAGE.tableTop + 0.002, pos.z + 0.05);
      tag.mesh.rotation.x = -Math.PI / 2;
      stage.add(tag.mesh);
    };
    bell(STAGE.skipButton, new Color(0.7, 0.5, 0.2), 'skip');
    bell(STAGE.exitButton, new Color(0.55, 0.12, 0.1), 'leave');

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
      screen.material = new MeshStandardMaterial({ color: new Color(1, 0.86, 0.62), roughness: 1 });
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
      new Vector2(STAGE.screenW, STAGE.screenH),
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
    this.masksDirty = true;
    this.targetDisplayDirty = true;
  }

  recenter(): void {
    this.anchored = false;
    this.anchorFrames = 0;
  }

  // ---------------------------------------------------------------- story
  get act(): Scene {
    return SCENES[this.sceneIndex];
  }

  get puppet(): PuppetPose | null {
    const s = this.act;
    return s.kind === 'puppet' ? this.puppetDef(s.puppet) : null;
  }

  startScene(i: number): void {
    this.sceneIndex = ((i % SCENES.length) + SCENES.length) % SCENES.length;
    const s = this.act;
    this.phase = s.kind === 'puppet' ? 'playing' : 'bow';
    this.phaseTime = 0;
    this.holdTime = 0;
    this.smoothScore = 0;
    this.smoothRunner = 0;
    this.runnerId = '';
    this.targetDisplayDirty = true;
    if (this.sceneIndex === 0) {
      this.lampTarget = 0.25;
      this.curtain = 0;
    }
    if (s.kind === 'curtain') this.audio.applause();
    else this.audio.pageTurn();
    this.updateRivals();
  }

  nextScene(): void {
    this.startScene(this.sceneIndex + 1);
  }

  /** Back to the opening scene with the lamp dimmed and the curtain open. */
  restart(): void {
    this.lamp = 0.25;
    this.startScene(0);
  }

  /** The puppet a player must make right now (null while nothing is scored). */
  get activeTargetId(): string | null {
    if (this.phase === 'playing') return this.puppet?.id ?? null;
    if (this.phase === 'bow') return 'hello'; // wave goodnight
    return null;
  }

  private updateRivals(): void {
    const id = this.activeTargetId;
    this.rivals = [];
    if (!id || !this.masksReady) return;
    const target = this.masks.get(id)!;
    for (const [other, m] of this.masks) {
      if (other === id) continue;
      // How well would the other puppet's silhouette pass for this target?
      const cross = target.scorer.score(m.buf, 4, this.rivalResult).score;
      if (cross > 0.55) this.rivals.push(other);
    }
  }

  private playCue(c: Cue): void {
    switch (c) {
      case 'lamp':
        this.audio.lampOn();
        break;
      case 'bark':
        this.audio.bark();
        break;
      case 'boing':
        this.audio.boing();
        break;
      case 'chirp':
        this.audio.chirp();
        break;
      case 'honk':
        this.audio.honk();
        break;
      case 'bloop':
        this.audio.bloop();
        break;
      case 'applause':
        this.audio.applause();
        break;
      default:
        this.audio.success();
    }
  }

  // ---------------------------------------------------------------- ghosts
  /** Pose the ghost pool (stage-local) for a set of actors. */
  private poseGhosts(actors: GhostActor[]): void {
    let k = 0;
    this.eyeCount = 0;
    for (const a of actors) {
      for (const h of HANDS) {
        const placed = a.puppet.hands[h];
        if (!placed || k >= this.ghosts.length) continue;
        const g = this.ghosts[k++];
        const shape = a.aliveT > 0 ? animateShape(a.puppet.id, placed.shape, a.aliveT) : placed.shape;
        solveHand(shape, h, this.ghostLocal, this.ghostRadii, this.handScale * a.scale);
        wristPlacement(placed, STAGE.handPoint, this.tmpM);
        if (a.aliveT > 0) wiggle(a.puppet.id, a.aliveT, this.tmpM);
        if (a.bow > 0) bowPlacement(this.tmpM, a.bow);
        this.tmpM.elements[12] += a.dx;
        rootFromWrist(this.tmpM, this.ghostLocal, this.tmpM2);
        applyRoot(this.tmpM2, this.ghostLocal, this.ghostWorld);
        const eye = a.puppet.eye;
        if (eye && eye.hand === h && this.eyeCount < MAX_EYES) {
          this.tmpM.fromArray(this.ghostWorld, eye.joint * 16);
          this.tmpV.set(eye.offset[0], eye.offset[1], eye.offset[2]).multiplyScalar(this.handScale * a.scale);
          this.tmpV.applyMatrix4(this.tmpM);
          this.projectToScreen(this.tmpV, this.eyes[this.eyeCount]);
          this.eyes[this.eyeCount].z = eye.r * a.scale;
          this.eyeCount++;
        }
        g.setFromMatrices(this.ghostWorld, this.ghostRadii);
        this.estimateElbow(g.joints[J.wrist], h, g.elbow);
        g.hasForearm = true;
        g.rebuild();
        g.casterRoot.matrix.copy(this.stage.matrixWorld);
        g.setTracked(true, false);
      }
    }
    for (; k < this.ghosts.length; k++) this.ghosts[k].setTracked(false, false);
  }

  /** Where the lamp throws a stage-local point onto the screen, as screen UV. */
  private projectToScreen(p: Vector3, out: Vector4): void {
    const { center: c, width: W, height: H, light: L } = this.light.spec;
    const t = (c.z - L.z) / Math.min(-1e-4, p.z - L.z);
    out.x = (L.x + (p.x - L.x) * t - (c.x - W / 2)) / W;
    out.y = (L.y + (p.y - L.y) * t - (c.y - H / 2)) / H;
  }

  /** Render every puppet's scored silhouette once and read the masks back. */
  private buildMasks(): void {
    if (this.masksBuilding) return;
    this.masksBuilding = true;
    this.masksDirty = false;
    const pending: Promise<unknown>[] = [];
    for (const p of this.puppetDefs.values()) {
      const m = this.masks.get(p.id)!;
      this.poseGhosts([{ puppet: p, aliveT: 0, dx: 0, scale: 1, bow: 0 }]);
      this.light.renderGhostScore(this.renderer, m.rt);
      pending.push(this.renderer.readRenderTargetPixelsAsync(m.rt, 0, 0, this.light.scoreW, this.light.scoreH, m.buf));
    }
    this.targetDisplayDirty = true;
    void Promise.all(pending)
      .then(() => {
        for (const m of this.masks.values()) m.scorer.setTarget(m.buf);
        this.masksReady = true;
        this.updateRivals();
      })
      .finally(() => {
        this.masksBuilding = false;
      });
  }

  private renderTargetDisplay(): void {
    const s = this.act;
    if (s.kind === 'puppet') {
      const aliveT = this.phase === 'alive' ? this.phaseTime + 1e-4 : 0;
      this.poseGhosts([{ puppet: this.puppetDef(s.puppet), aliveT, dx: 0, scale: 1, bow: 0 }]);
    } else {
      const n = s.cast.length;
      const t = this.phaseTime;
      const bowing = this.phase === 'bow' ? 1 : 0;
      this.poseGhosts(
        s.cast.map((id, i) => ({
          puppet: this.puppetDef(id),
          aliveT: 0,
          dx: (i - (n - 1) / 2) * (n > 3 ? 0.075 : 0.13),
          scale: n > 3 ? 0.5 : 0.72,
          bow: Math.max(0, Math.sin(Math.max(0, t - 0.6 - i * 0.25) * 1.6)) * bowing,
        })),
      );
    }
    this.light.renderGhostDisplay(this.renderer);
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
    const pole = this.ikPole.set(h === 'left' ? -0.5 : 0.5, -1, 0.15);
    pole.addScaledVector(u, -pole.dot(u)).normalize();
    return out.copy(s).addScaledVector(u, x).addScaledVector(pole, hh);
  }

  // ---------------------------------------------------------------- frame
  update(delta: number): void {
    const t0 = performance.now();
    let dt = delta;
    if (this.stepMode) {
      dt = this.pendingSteps > 0 ? this.stepDt : 0;
      if (this.pendingSteps > 0) {
        this.pendingSteps--;
        this.stepCount++;
      }
    }
    this.elapsed += dt;
    this.phaseTime += dt;
    this.frameNo++;
    const renderer = this.renderer;
    this.attachScreenShader();

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

    this.onFrame?.(dt);
    // In passthrough the player's own table is there; drop the virtual one.
    const blend = this.renderer.xr.getSession()?.environmentBlendMode;
    this.table.visible = blend !== 'alpha-blend' && blend !== 'additive';
    this.readHands();

    if (this.masksDirty && this.anchored) this.buildMasks();
    const animated = this.phase === 'alive' || this.phase === 'bow' || this.phase === 'closing';
    if (this.targetDisplayDirty || animated) {
      this.renderTargetDisplay();
      this.targetDisplayDirty = false;
    }

    const targetId = this.activeTargetId;
    const wantScore = this.masksReady && targetId != null && !this.readbackPending && this.frameNo % this.scoreEvery === 0;
    this.light.renderLive(renderer, wantScore);
    if (wantScore) this.kickReadback(targetId);

    this.advanceStory(dt);
    this.checkBells();
    this.updateLampAndUniforms(dt);
    this.drawHud();

    const ms = performance.now() - t0;
    const p = this.perf;
    p.frames++;
    const k = 1 / Math.min(p.frames, 120);
    p.avgUpdateMs += (ms - p.avgUpdateMs) * k;
    p.avgFrameMs += (delta * 1000 - p.avgFrameMs) * k;
    p.avgDisplayRenderMs += (this.light.timings.displayMs - p.avgDisplayRenderMs) * k;
  }

  /** True when the current shape is the target and clearly not a look-alike. */
  get passing(): boolean {
    return this.smoothScore >= this.threshold && this.smoothScore - this.smoothRunner >= this.margin;
  }

  private advanceStory(dt: number): void {
    const s = this.act;
    if (this.phase === 'playing' && s.kind === 'puppet') {
      if (this.passing && this.phaseTime > 1.5) this.holdTime += dt;
      else this.holdTime = Math.max(0, this.holdTime - dt * 2);
      if (this.holdTime > 0.5) {
        this.phase = 'alive';
        this.phaseTime = 0;
        this.playCue(s.cue);
        if (s.cue === 'lamp') this.lampTarget = 1;
      }
    } else if (this.phase === 'alive') {
      if (this.phaseTime > ALIVE_SECONDS) this.nextScene();
    } else if (this.phase === 'bow') {
      if (this.passing && this.phaseTime > 3) this.holdTime += dt;
      else this.holdTime = Math.max(0, this.holdTime - dt * 2);
      if (this.holdTime > 0.5 || this.phaseTime > 40) {
        this.phase = 'closing';
        this.phaseTime = 0;
        this.audio.curtain();
      }
    } else if (this.phase === 'closing') {
      this.curtain = Math.min(1, this.phaseTime / 2.2);
      if (this.curtain >= 1) {
        this.phase = 'closed';
        this.phaseTime = 0;
        this.lampTarget = 0.4;
        this.audio.success();
      }
    }
  }

  private updateLampAndUniforms(dt: number): void {
    this.lamp += (this.lampTarget - this.lamp) * Math.min(1, dt * 2.5);
    this.glow.intensity = 0.3 + this.lamp * 0.9;
    this.bulb.material.color.setRGB(0.5 + 0.5 * this.lamp, 0.4 + 0.45 * this.lamp, 0.25 + 0.3 * this.lamp);
    if (!this.screenShader) return;
    const u = this.screenShader.uniforms;
    u.uTime.value = this.elapsed;
    u.uLamp.value = this.lamp;
    u.uCurtain.value = this.curtain;
    const alive = this.phase === 'alive' || this.phase === 'bow' || this.phase === 'closing';
    u.uMatch.value = this.phase === 'alive' ? 1 : Math.max(0, (this.smoothScore - 0.4) / (this.threshold - 0.4));
    u.uAlive.value = alive ? Math.min(1, this.phaseTime * 3) : 0;
    u.uTargetAlpha.value = this.phase === 'playing' ? Math.min(1, this.phaseTime / 1.5) : this.phase === 'closed' ? 0 : 1;

    // Eyes: hinted in ink while playing, opened in the shadow once alive, and
    // they blink now and then.
    const eyes = u.uEyes.value as Vector4[];
    for (let i = 0; i < MAX_EYES; i++) {
      const e = this.eyes[i];
      if (i < this.eyeCount) eyes[i].set(e.x, e.y, e.z, blink(this.elapsed + i * 1.37));
      else eyes[i].set(0, 0, 0, 0);
    }
    const playing = this.phase === 'playing';
    u.uEyeInk.value = playing ? u.uTargetAlpha.value * (1 - this.smoothScore) : 0;
    u.uEyeHole.value = alive ? u.uAlive.value : 0;
    // The player's own shadow opens its eye as it nears the shape.
    const sx = -this.result.dx / this.light.scoreW;
    const sy = -this.result.dy / this.light.scoreH;
    this.eyeShift.x += (-sx - this.eyeShift.x) * Math.min(1, dt * 8);
    this.eyeShift.y += (-sy - this.eyeShift.y) * Math.min(1, dt * 8);
    (u.uEyeShift.value as Vector2).copy(this.eyeShift);
    const near = Math.min(1, Math.max(0, (this.smoothScore - 0.6) / Math.max(0.05, this.threshold - 0.6)));
    u.uLiveEye.value = playing ? near : 0;
    const s = this.act;
    const moonScene = s.kind === 'puppet' && s.puppet === 'rabbit';
    const moon = u.uMoon.value as Vector3;
    const moonTarget = moonScene ? (this.phase === 'alive' ? 1 : 0.45) : 0;
    moon.z += (moonTarget - moon.z) * Math.min(1, dt * 1.5);
  }

  private kickReadback(targetId: string): void {
    const renderer = this.renderer;
    this.readbackPending = true;
    const t0 = performance.now();
    const f0 = this.frameNo;
    const scoreRenderMs = this.light.timings.scoreMs;
    renderer
      .readRenderTargetPixelsAsync(this.light.scoreRT, 0, 0, this.light.scoreW, this.light.scoreH, this.readbackBuf)
      .then(() => {
        if (this.activeTargetId !== targetId) return; // scene changed meanwhile
        const t1 = performance.now();
        this.masks.get(targetId)!.scorer.score(this.readbackBuf, 4, this.result);
        let runner = 0;
        let runnerId = '';
        for (const id of this.rivals) {
          const r = this.masks.get(id)!.scorer.score(this.readbackBuf, 4, this.rivalResult).score;
          if (r > runner) {
            runner = r;
            runnerId = id;
          }
        }
        const cpu = performance.now() - t1;
        const p = this.perf;
        p.samples++;
        const k = 1 / Math.min(p.samples, 60);
        p.avgScoreCpuMs += (cpu - p.avgScoreCpuMs) * k;
        p.avgReadbackMs += (t1 - t0 - p.avgReadbackMs) * k;
        p.avgReadbackFrames += (this.frameNo - f0 - p.avgReadbackFrames) * k;
        p.avgScoreRenderMs += (scoreRenderMs - p.avgScoreRenderMs) * k;
        this.smoothScore += (this.result.score - this.smoothScore) * 0.35;
        this.smoothRunner += (runner - this.smoothRunner) * 0.35;
        this.runnerId = runnerId;
        if (this.phase === 'playing') this.audio.progress(this.smoothScore);
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
    this.player.updateMatrixWorld(true);
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
        this.tmpV.copy(proxy.joints[J.wrist]).applyMatrix4(this.player.matrixWorld).applyMatrix4(this.stageInv);
        this.estimateElbow(this.tmpV, h, proxy.elbow);
        proxy.elbow.applyMatrix4(this.stage.matrixWorld);
        this.tmpM.copy(this.player.matrixWorld).invert();
        proxy.elbow.applyMatrix4(this.tmpM);
        proxy.hasForearm = true;
        proxy.rebuild();
        this.tracked[h] = true;
        this.fitHandSize(proxy);
      }
    }
    for (const h of HANDS) {
      const proxy = this.hands[h];
      // When the SDK's own hand model is showing, keep our capsules invisible.
      const sdkVisual = this.input.xr.visualAdapters.hand[h].visual != null;
      proxy.setTracked(this.tracked[h], !sdkVisual);
      proxy.casterRoot.matrix.copy(this.player.matrixWorld);
    }
  }

  /** Fit target ghosts to the player's own hand size (curl-invariant). */
  private fitHandSize(proxy: HandProxy): void {
    const s = chainLength(proxy.joints) / REST_CHAIN_LENGTH;
    if (!Number.isFinite(s) || s < 0.6 || s > 1.6) return;
    this.measuredScale += (s - this.measuredScale) * 0.02;
    const clamped = Math.min(1.25, Math.max(0.8, this.measuredScale));
    if (Math.abs(clamped - this.handScale) > 0.04 && this.phase === 'playing' && this.phaseTime < 1.5) {
      this.handScale = clamped;
      this.masksDirty = true;
    }
  }

  private cardArmed = true;
  private readonly cardInv = new Matrix4();

  /** Poking the settings card on the table cycles the row under the fingertip. */
  private checkSettingsCard(): void {
    const card = this.settingsCard;
    this.cardInv.copy(card.mesh.matrixWorld).invert();
    let hit = -1;
    for (const h of HANDS) {
      if (!this.tracked[h]) continue;
      this.tmpV.copy(this.hands[h].joints[9]).applyMatrix4(this.player.matrixWorld).applyMatrix4(this.cardInv);
      const r = card.hitRow(this.tmpV);
      if (r >= 0) hit = r;
    }
    if (hit < 0) {
      this.cardArmed = true;
      return;
    }
    if (!this.cardArmed) return;
    this.cardArmed = false;
    const now = performance.now() / 1000;
    const key = card.keyOf(hit, getSettings());
    card.flash(hit, now);
    this.audio.pageTurn();
    updateSettings({ [key]: cycled(key) });
  }

  private checkBells(): void {
    this.checkSettingsCard();
    if (this.elapsed - this.lastPoke < 1.2) return;
    for (const [bell, action] of [
      [STAGE.skipButton, 'skip'],
      [STAGE.exitButton, 'exit'],
    ] as const) {
      this.tmpV2.copy(bell).applyMatrix4(this.stage.matrixWorld);
      for (const h of HANDS) {
        if (!this.tracked[h]) continue;
        this.tmpV.copy(this.hands[h].joints[9]).applyMatrix4(this.player.matrixWorld);
        if (this.tmpV.distanceTo(this.tmpV2) < 0.035) {
          this.lastPoke = this.elapsed;
          if (action === 'exit') void this.world.exitXR();
          else if (this.phase === 'closed') this.startScene(0);
          else this.nextScene();
          return;
        }
      }
    }
  }

  private drawHud(): void {
    const s = this.act;
    const pup = this.puppet;
    const prefs = getSettings();
    this.settingsCard.draw(prefs, performance.now() / 1000);
    const big = prefs.largeText ? 1.28 : 1;
    let title = s.title;
    let line = s.narration;
    if (s.kind === 'puppet' && this.phase === 'alive') line = s.success;
    if (this.phase === 'closed') {
      title = 'The End';
      line = 'Thank you for performing, and goodnight.';
    }
    // Once the curtain is drawn the text sits on dark velvet: switch to gilt.
    const onCurtain = this.phase === 'closing' || this.phase === 'closed';
    const ink = onCurtain ? GILT : INK;
    const inkSoft = onCurtain ? GILT_SOFT : INK_SOFT;
    if (!prefs.subtitles) line = '';
    this.title.draw(`${this.sceneIndex}|${this.phase}|${title}|${line}|${big}`, (ctx, w, h) => {
      ctx.fillStyle = ink;
      ctx.textAlign = 'center';
      ctx.font = `bold ${Math.round(h * 0.3 * Math.min(big, 1.1))}px ${FONT}`;
      ctx.fillText(title, w / 2, h * 0.32);
      ctx.fillStyle = inkSoft;
      ctx.font = `${Math.round(h * 0.19 * big)}px ${FONT}`;
      const lines = wrapText(ctx, line, w * 0.92);
      lines.slice(0, 2).forEach((l, i) => ctx.fillText(l, w / 2, h * (0.62 + i * 0.22 * big)));
    });

    // The character card: what this hand shape is meant to become.
    const cardPuppet = this.phase === 'playing' || this.phase === 'alive' ? pup : null;
    this.card.mesh.visible = cardPuppet != null;
    if (cardPuppet) {
      const mirror = prefs.hand === 'right';
      this.card.draw(`${cardPuppet.id}|${mirror}`, (ctx, w, h) =>
        drawSketchCard(ctx, w, h, cardPuppet.id, cardPuppet.caption, INK, FONT, mirror),
      );
    }
    this.drawCallout(pup);

    const pct = Math.round(this.smoothScore * 50) * 2;
    const anyHand = this.tracked.left || this.tracked.right;
    let status = '';
    if (this.phase === 'playing' && pup) {
      if (!anyHand) status = 'Raise your hands into the lamplight';
      else if (this.smoothRunner > this.smoothScore && this.smoothRunner > 0.8 && this.runnerId)
        status = this.runnerId === 'hello' ? 'Lovely wave! Now shape the ' + (pup.name.replace(/^The /u, '').toLowerCase()) + '.' : `Lovely, but that looks like the ${this.puppetDef(this.runnerId).name.replace(/^The /u, '').toLowerCase()}!`;
      else if (this.phaseTime > 25) status = 'Need a hand? Poke the bell to skip.';
      else status = this.phaseTime > 4 && s.kind === 'puppet' ? s.hint : '';
    } else if (this.phase === 'bow') status = 'Wave goodnight with an open hand';
    else if (this.phase === 'closed') status = 'Poke the bell to play again';
    const showBar = this.phase === 'playing' || this.phase === 'bow';
    this.footer.draw(`${pct}|${this.sceneIndex}|${this.phase}|${status}|${big}`, (ctx, w, h) => {
      ctx.fillStyle = inkSoft;
      ctx.textAlign = 'left';
      ctx.font = `${Math.round(h * 0.3)}px ${FONT}`;
      ctx.fillText(`${this.sceneIndex + 1} / ${SCENES.length}`, w * 0.015, h * 0.6);
      if (showBar) {
        const bx = w * 0.09;
        const bw = w * 0.16;
        ctx.strokeStyle = INK_SOFT;
        ctx.lineWidth = 3;
        ctx.strokeRect(bx, h * 0.33, bw, h * 0.3);
        ctx.fillStyle = INK;
        ctx.fillRect(bx, h * 0.33, bw * Math.min(1, this.smoothScore / this.threshold), h * 0.3);
      }
      ctx.textAlign = 'center';
      ctx.font = `${Math.round(h * 0.28 * big)}px ${FONT}`;
      const lines = wrapText(ctx, status, w * 0.7);
      const gap = 0.36 * big;
      lines.slice(0, 2).forEach((l, i) => ctx.fillText(l, w * 0.62, h * (lines.length > 1 ? 0.6 - gap / 2 + i * gap : 0.6)));
    });
  }

  /** Pop a "Woof!" next to the puppet's head while it is alive. */
  private drawCallout(pup: PuppetPose | null): void {
    const say = pup?.say;
    const t = this.phaseTime - 0.35;
    const show = this.phase === 'alive' && say != null && this.eyeCount > 0 && t > 0;
    this.callout.mesh.visible = show;
    if (!show || !say) return;
    const e = this.eyes[0];
    const c = STAGE.screenCenter;
    const left = c.x - STAGE.screenW / 2;
    const bottom = c.y - STAGE.screenH / 2;
    const x = Math.min(left + STAGE.screenW - 0.17, Math.max(left + 0.17, left + e.x * STAGE.screenW + say.dx));
    const y = Math.min(bottom + STAGE.screenH - 0.3, Math.max(bottom + 0.15, bottom + e.y * STAGE.screenH + say.dy));
    this.callout.mesh.position.set(x, y + Math.sin(t * 5) * 0.004, c.z + 0.004);
    this.callout.mesh.scale.setScalar(Math.max(0.01, easeOutBack(Math.min(1, t * 3.5))));
    this.callout.draw(say.text, (ctx, w, h) => {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `bold italic ${Math.round(h * 0.62)}px ${FONT}`;
      ctx.lineJoin = 'round';
      ctx.lineWidth = h * 0.14;
      ctx.strokeStyle = 'rgba(255, 232, 196, 0.95)';
      ctx.strokeText(say.text, w / 2, h / 2);
      ctx.fillStyle = INK;
      ctx.fillText(say.text, w / 2, h / 2);
    });
  }

  // ---------------------------------------------------------------- demo / debug
  /** Advance the story clock by n fixed steps (capture mode). */
  step(n = 1): void {
    this.pendingSteps += n;
  }

  /**
   * IWER placements for a puppet blended from a resting pose (t=0) to the
   * puppet (t=1). Hands the puppet does not use stay resting.
   */
  emulatorPlacement(id: string | null, t: number, sway = 0, jitterDeg = 0): Record<Hand, EmulatorHand> {
    const p = id ? this.puppetDef(id) : null;
    const out = {} as Record<Hand, EmulatorHand>;
    for (const h of HANDS) {
      const target: PlacedHand | undefined = p?.hands[h];
      const rest = REST_PLACEMENT[h];
      const k = target ? t : 0;
      let shape: HandShape = lerpShape(RESTING, target?.shape ?? RESTING, k);
      if (jitterDeg > 0) shape = jitterShape(shape, jitterDeg);
      const placed = lerpPlaced(rest, target ?? rest, k, shape);
      solveHand(shape, h, this.ghostLocal, this.ghostRadii, this.handScale);
      wristPlacement(placed, STAGE.handPoint, this.tmpM);
      const ph = h === 'left' ? 0 : 1.7;
      this.tmpM.elements[12] += Math.sin(this.elapsed * 0.9 + ph) * 0.006 + Math.sin(this.elapsed * 7) * 0.035 * sway;
      this.tmpM.elements[13] += Math.sin(this.elapsed * 1.3 + ph) * 0.004;
      rootFromWrist(this.tmpM, this.ghostLocal, this.tmpM2);
      this.tmpM2.premultiply(this.stage.matrixWorld);
      const pos = new Vector3();
      const q = new Quaternion();
      const sc = new Vector3();
      this.tmpM2.decompose(pos, q, sc);
      out[h] = { pose: toIwerHandPose(shape), position: pos.toArray(), quaternion: q.toArray() };
    }
    return out;
  }

  private installDebugApi(): void {
    const api = {
      puppets: PUPPETS.map((p) => p.id),
      scenes: SCENES.map((s) => (s.kind === 'puppet' ? s.puppet : 'curtain')),
      setScene: (i: number) => this.startScene(i),
      /** Jump straight to a phase (e.g. 'alive') to preview an animation. */
      setPhase: (p: Phase) => {
        this.phase = p;
        this.phaseTime = 0;
        this.targetDisplayDirty = true;
      },
      setBeat: (i: number) => this.startScene(i),
      next: () => this.nextScene(),
      recenter: () => this.recenter(),
      setTolerance: (px: number) => {
        for (const m of this.masks.values()) m.scorer.setOptions({ tolerancePx: px });
      },
      setThreshold: (t: number) => (this.threshold = t),
      setMargin: (m: number) => (this.margin = m),
      setScoreEvery: (n: number) => (this.scoreEvery = Math.max(1, Math.round(n))),
      setStepMode: (on: boolean, fps = 24) => {
        this.stepMode = on;
        this.stepDt = 1 / fps;
      },
      step: (n = 1) => this.step(n),
      state: () => ({
        scene: this.sceneIndex,
        beat: this.sceneIndex,
        puppet: this.activeTargetId,
        phase: this.phase,
        phaseTime: this.phaseTime,
        smoothScore: this.smoothScore,
        smoothRunner: this.smoothRunner,
        runnerId: this.runnerId,
        rivals: [...this.rivals],
        passing: this.passing,
        result: { ...this.result },
        tracked: { ...this.tracked },
        targetReady: this.masksReady,
        handScale: this.handScale,
        frameNo: this.frameNo,
        elapsed: this.elapsed,
        stepCount: this.stepCount,
        pendingSteps: this.pendingSteps,
        perf: { ...this.perf },
        scoreGrid: [this.light.scoreW, this.light.scoreH],
        displayRT: [this.light.displayRT.width, this.light.displayRT.height],
      }),
      /** Enter XR directly (tests): 'vr' or 'ar' (passthrough). */
      enterXR: (mode: 'vr' | 'ar' = 'vr') =>
        this.world.launchXR({ sessionMode: mode === 'ar' ? SessionMode.ImmersiveAR : SessionMode.ImmersiveVR }),
      tableVisible: () => this.table.visible,
      /** World position of a tracked index fingertip (tests). */
      fingertip: (h: Hand) => this.tmpV.copy(this.hands[h].joints[9]).applyMatrix4(this.player.matrixWorld).toArray(),
      settingsCardNormal: () => new Vector3(0, 0, 1).transformDirection(this.settingsCard.mesh.matrixWorld).toArray(),
      settings: () => ({ ...getSettings() }),
      setSettings: (patch: Record<string, unknown>) => updateSettings(patch),
      /** Where the settings card is, for poke tests: world position of a row's centre. */
      settingsRowWorld: (row: number) => {
        const v = new Vector3(0, 0.105 - 0.045 - (row + 0.5) * ((0.21 - 0.045) / 4), 0);
        return v.applyMatrix4(this.settingsCard.mesh.matrixWorld).toArray();
      },
      /** Log sound cues against the story clock, starting at `offset` seconds. */
      recordSound: (on: boolean, offset = 0) => {
        const e0 = this.elapsed;
        this.audio.recording = on ? { clock: () => this.elapsed - e0 + offset, events: [] } : null;
      },
      soundEvents: () => this.audio.recording?.events.slice() ?? [],
      /** Render the recorded cues to a 16-bit stereo WAV, base64. */
      renderSoundtrack: async (seconds: number) => {
        const buf = await TheatreAudio.render(this.audio.recording?.events ?? [], seconds);
        return wavBase64(buf);
      },
      emulatorPose: (id: string, jitter = 0) => this.emulatorPlacement(id, 1, 0, jitter),
      emulatorPlacement: (id: string | null, t: number, sway = 0) => this.emulatorPlacement(id, t, sway),
      /** Raw RGBA of the last live readback and the current target mask. */
      scoreBuffers: () => {
        const id = this.activeTargetId ?? PUPPETS[0].id;
        return { w: this.light.scoreW, h: this.light.scoreH, live: Array.from(this.readbackBuf), target: Array.from(this.masks.get(id)!.buf) };
      },
    };
    (window as unknown as { __shadowplay: typeof api }).__shadowplay = api;
  }
}

/** Puppet-specific "alive" animation: tweak the shape over time. */
function wavBase64(buf: AudioBuffer): string {
  const ch = buf.numberOfChannels;
  const n = buf.length;
  const bytes = new Uint8Array(44 + n * ch * 2);
  const v = new DataView(bytes.buffer);
  const str = (o: number, t: string) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * ch * 2, true);
  str(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, ch, true);
  v.setUint32(24, buf.sampleRate, true);
  v.setUint32(28, buf.sampleRate * ch * 2, true);
  v.setUint16(32, ch * 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * ch * 2, true);
  const data = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const x = Math.max(-1, Math.min(1, data[c][i]));
      v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true);
      o += 2;
    }
  }
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Eye openness over time: open, with a quick blink every few seconds. */
function blink(t: number): number {
  const k = (t % 3.4) / 0.16;
  return k < 1 ? Math.abs(Math.cos(k * Math.PI)) : 1;
}

function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

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
    case 'swan': {
      // The head dips and rises.
      const f = 12 * Math.sin(t * 2.2);
      const w = (c: HandShape['index']) => ({ ...c, mcp: c.mcp + f });
      return { ...s, index: w(s.index), middle: w(s.middle), ring: w(s.ring), pinky: w(s.pinky) };
    }
    case 'snail':
      return s;
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

/** Whole-hand motion while alive (a hop, a flight, a wave). Mutates the wrist placement. */
function wiggle(id: string, t: number, m: Matrix4): void {
  const e = m.elements;
  if (id === 'rabbit') e[13] += Math.abs(Math.sin(t * 5)) * 0.03;
  else if (id === 'bird') {
    e[13] += Math.sin(t * 3.5) * 0.02 + t * 0.012;
    e[12] += t * 0.02;
  } else if (id === 'hello') e[12] += Math.sin(t * 6) * 0.03;
  else if (id === 'dog') e[13] += Math.abs(Math.sin(t * 4.5)) * 0.008;
  else if (id === 'swan') {
    e[12] += Math.sin(t * 0.9) * 0.03;
    e[13] += Math.sin(t * 2.2) * 0.006;
  } else if (id === 'snail') e[12] += t * 0.008;
}

const bowRot = new Matrix4();
/** Tip the hand toward the screen (a bow), keeping the wrist in place. */
function bowPlacement(m: Matrix4, amount: number): void {
  const x = m.elements[12];
  const y = m.elements[13];
  const z = m.elements[14];
  bowRot.makeRotationX(-0.6 * amount);
  m.premultiply(bowRot);
  m.elements[12] = x;
  m.elements[13] = y - 0.015 * amount;
  m.elements[14] = z;
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
