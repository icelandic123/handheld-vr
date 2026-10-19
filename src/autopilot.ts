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

  update(dt: number): void {
    const dev = this.device;
    if (this.mode === 'off' || !dev) return;
    const th = this.theatre;
    let want: string | null = this.requested;
    let sway = 0;
    if (this.mode === 'watch') {
      want = null;
      const s = th.act;
      if (th.phase === 'playing' && s.kind === 'puppet' && th.phaseTime > 1.6) want = s.puppet;
      else if (th.phase === 'alive') want = this.current;
      else if (th.phase === 'bow' && th.phaseTime > 4.5) {
        want = 'hello';
        sway = 1;
      }
    }
    if (want !== this.current) {
      this.blend -= dt / 0.7;
      if (this.blend <= 0) {
        this.blend = 0;
        this.current = want;
      }
    } else if (want) {
      this.blend = Math.min(1, this.blend + dt / 2.0);
    }
    const t = this.blend * this.blend * (3 - 2 * this.blend);
    this.apply(dev, th.emulatorPlacement(this.current, t, sway * t));
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
