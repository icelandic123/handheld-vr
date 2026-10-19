import type { EmulatorHand, TheatreSystem } from './theatre.js';

/**
 * Drives the IWER emulator's hands through the play so a laptop visitor (or
 * the CI video recorder) can watch the whole show. Hands rest on the table,
 * rise into each puppet shape, hold while it comes alive, and wave goodnight
 * at the curtain call. Only used with the emulator, never on a headset.
 */
interface EmuHand {
  position: { set(x: number, y: number, z: number): void };
  quaternion: { set(x: number, y: number, z: number, w: number): void };
  poseId: string;
  connected: boolean;
}
interface EmuDevice {
  controlMode: 'manual' | 'programmatic';
  primaryInputMode: 'controller' | 'hand';
  hands: { left: EmuHand; right: EmuHand };
}

/** IWER shares one pose table between both hands, so each hand needs its own slot. */
const POSE_SLOT = { left: 'autopilot-left', right: 'autopilot-right' } as const;

/**
 * What the watch-mode performer tries first in each scene before getting it
 * right, so a viewer sees the shadow searching for the shape (and, for the
 * rabbit, the look-alike warning) instead of an instant pass.
 */
const FIRST_TRY: Record<string, { id: string; amount: number }> = {
  hello: { id: 'hello', amount: 0.3 },
  dog: { id: 'dog', amount: 0.25 },
  rabbit: { id: 'hello', amount: 1 },
  bird: { id: 'bird', amount: 0.3 },
};
/** Seconds of each act: resting while the narration is read, then the first try. */
const REST_UNTIL = 3;
const FIRST_TRY_UNTIL = 8.5;

export class Autopilot {
  /** 'watch' runs the whole play; 'snap' holds whatever puppet was requested. */
  mode: 'off' | 'watch' | 'snap' = 'off';
  private current: string | null = null;
  private requested: string | null = null;
  private blend = 0;

  constructor(private readonly theatre: TheatreSystem) {}

  private get device(): EmuDevice | null {
    return (window as unknown as { IWER_DEVICE?: EmuDevice }).IWER_DEVICE ?? null;
  }

  /** In snap mode: shape the emulated hands into a puppet (null = rest). */
  snapTo(id: string | null): void {
    this.mode = 'snap';
    this.requested = id;
  }

  /** The shape the performer is going for right now, and how far. */
  private wanted(): { id: string | null; amount: number; sway: number } {
    if (this.mode === 'snap') return { id: this.requested, amount: 1, sway: 0 };
    const th = this.theatre;
    const s = th.act;
    const t = th.phaseTime;
    if (th.phase === 'playing' && s.kind === 'puppet') {
      if (t < REST_UNTIL) return { id: null, amount: 0, sway: 0 };
      if (t < FIRST_TRY_UNTIL) {
        const first = FIRST_TRY[s.puppet] ?? { id: s.puppet, amount: 1 };
        return { ...first, sway: 0 };
      }
      return { id: s.puppet, amount: 1, sway: 0 };
    }
    if (th.phase === 'alive') return { id: this.current, amount: 1, sway: 0 };
    if (th.phase === 'bow' && t > 4.5) return { id: 'hello', amount: 1, sway: 1 };
    return { id: null, amount: 0, sway: 0 };
  }

  update(dt: number): void {
    const dev = this.device;
    if (this.mode === 'off' || !dev) return;
    const want = this.wanted();
    if (want.id !== this.current) {
      // Lower the hands before changing shape.
      this.blend -= dt / 0.7;
      if (this.blend <= 0) {
        this.blend = 0;
        this.current = want.id;
      }
    } else if (want.id) {
      const step = dt / 2.2;
      this.blend += Math.max(-step, Math.min(step, want.amount - this.blend));
    }
    const b = Math.max(0, Math.min(1, this.blend));
    const t = b * b * (3 - 2 * b);
    this.apply(dev, this.theatre.emulatorPlacement(this.current, t, want.sway * t));
  }

  private apply(dev: EmuDevice, placement: Record<'left' | 'right', EmulatorHand>): void {
    dev.controlMode = 'programmatic';
    dev.primaryInputMode = 'hand';
    for (const h of ['left', 'right'] as const) {
      const hand = dev.hands[h];
      const p = placement[h];
      const sym = Object.getOwnPropertySymbols(hand).find((s) => s.description === '@iwer/xr-hand-input');
      if (!sym) continue;
      const internal = (hand as unknown as Record<symbol, { poses: Record<string, unknown> }>)[sym];
      internal.poses[POSE_SLOT[h]] = p.pose;
      hand.poseId = POSE_SLOT[h];
      hand.position.set(p.position[0], p.position[1], p.position[2]);
      hand.quaternion.set(p.quaternion[0], p.quaternion[1], p.quaternion[2], p.quaternion[3]);
      hand.connected = true;
    }
  }
}
