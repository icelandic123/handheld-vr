import type { FingerCurl, HandShape, PlacedHand } from './hand-rig.js';
import { J } from './joints.js';

/**
 * The puppet's eye: a gap of lamplight in the shadow, as real shadow puppeteers
 * make with a bent finger. Placed in one joint's frame of the ghost hand
 * (metres; -Z along the bone, +Y out of the back of the hand, +X toward the
 * thumb for a left hand) and projected onto the screen.
 */
export interface EyeSpec {
  hand: 'left' | 'right';
  joint: number;
  offset: [number, number, number];
  /** Radius on the screen, metres. */
  r: number;
}

export interface PuppetPose {
  id: string;
  name: string;
  /** Short instruction shown on the HUD. */
  hint: string;
  /** Caption on the character card. */
  caption: string;
  /** One hand or two. */
  hands: { left?: PlacedHand; right?: PlacedHand };
  eye?: EyeSpec;
  /** What the puppet says when it comes alive, and where (screen metres from the eye). */
  say?: { text: string; dx: number; dy: number };
}

const straight: FingerCurl = { mcp: 0, pip: 0, dip: 0 };
const fist: FingerCurl = { mcp: 85, pip: 100, dip: 60 };
const curl = (mcp: number, pip: number, dip: number, spread = 0): FingerCurl => ({ mcp, pip, dip, spread });

const OPEN_SPREAD: HandShape = {
  thumb: { cmcAbd: 20, mcp: 0, ip: 0 },
  index: curl(0, 0, 0, 12),
  middle: curl(0, 0, 0, 2),
  ring: curl(0, 0, 0, -8),
  pinky: curl(0, 0, 0, -18),
};

/** Fingers together, pinky dropped as a jaw, thumb up as an ear. */
const DOG: HandShape = {
  thumb: { cmcAbd: 35, cmcFlex: -10, mcp: -10, ip: 0 },
  index: curl(0, 0, 0, 8),
  middle: curl(0, 0, 0, 3),
  ring: curl(0, 0, 0, -3),
  pinky: curl(55, 10, 0, 4),
};

/** Index + middle up in a V for ears, others curled under the thumb. */
const RABBIT: HandShape = {
  thumb: { cmcAbd: -15, cmcFlex: 25, mcp: 30, ip: 20 },
  index: curl(0, 0, 0, 10),
  middle: curl(0, 0, 0, -8),
  ring: fist,
  pinky: fist,
};

/** Wing: fingers spread and slightly curved. */
const WING: HandShape = {
  thumb: { cmcAbd: 45, cmcFlex: -10, mcp: 0, ip: 10 },
  index: curl(5, 10, 5, 8),
  middle: curl(5, 10, 5, 2),
  ring: curl(5, 10, 5, -4),
  pinky: curl(5, 10, 5, -10),
};

/** Swan: hand on its side, fingers together and bent over for the head and beak. */
const SWAN: HandShape = {
  thumb: { cmcAbd: -10, cmcFlex: 20, mcp: 20, ip: 10 },
  index: curl(65, 35, 10, -2),
  middle: curl(65, 35, 10, -1),
  ring: curl(65, 35, 10, 1),
  pinky: curl(65, 35, 10, 3),
};

/** Snail shell: a loose fist. */
const SHELL: HandShape = {
  thumb: { cmcAbd: -10, cmcFlex: 30, mcp: 40, ip: 30 },
  index: fist,
  middle: fist,
  ring: fist,
  pinky: fist,
};

/** Snail body: a flat hand, fingers together. */
const FOOT: HandShape = {
  thumb: { cmcAbd: -25, cmcFlex: 35, mcp: 35, ip: 20 },
  index: curl(0, 5, 0, -4),
  middle: curl(0, 5, 0, 0),
  ring: curl(0, 5, 0, 3),
  pinky: curl(0, 5, 0, 6),
};

export const PUPPETS: PuppetPose[] = [
  {
    id: 'hello',
    name: 'Hello, lamp',
    hint: 'Hold up an open hand, fingers spread.',
    caption: 'the lamp',
    hands: {
      left: { shape: OPEN_SPREAD, offset: [0, 0, 0], point: [0, 1, 0], back: [0, 0, -1] },
    },
  },
  {
    id: 'dog',
    name: 'The Dog',
    hint: 'Hand sideways, thumb up for an ear, drop your little finger for the jaw.',
    caption: 'the dog',
    hands: {
      left: { shape: DOG, offset: [-0.04, 0, 0], point: [1, 0.05, 0], back: [0, 0, -1] },
    },
    eye: { hand: 'left', joint: J.indexProx, offset: [-0.008, 0, -0.016], r: 0.026 },
    say: { text: 'Woof!', dx: 0.3, dy: 0.02 },
  },
  {
    id: 'rabbit',
    name: 'The Rabbit',
    hint: 'Two fingers up for ears, curl the rest under your thumb.',
    caption: 'the rabbit',
    eye: { hand: 'left', joint: J.indexProx, offset: [0.0, 0, 0.02], r: 0.02 },
    say: { text: 'Boing!', dx: 0.25, dy: -0.02 },
    hands: {
      left: { shape: RABBIT, offset: [0, -0.03, 0], point: [0.15, 1, 0], back: [0, 0, -1] },
    },
  },
  {
    id: 'bird',
    name: 'The Bird',
    hint: 'Cross your wrists, hook your thumbs together, spread your fingers as wings.',
    caption: 'the bird',
    eye: { hand: 'left', joint: J.thumbDist, offset: [0, 0, 0], r: 0.018 },
    say: { text: 'Tweet!', dx: 0.16, dy: 0.12 },
    hands: {
      // Wrists crossed, so each thumb points up; hooked together they make the head.
      left: { shape: WING, offset: [-0.03, 0, 0], point: [1, 0.5, 0], back: [0, 0, -1] },
      right: { shape: WING, offset: [0.03, 0, 0.012], point: [-1, 0.5, 0], back: [0, 0, -1] },
    },
  },
  {
    id: 'swan',
    name: 'The Swan',
    hint: 'Raise your hand on its side, fingers together, and bend them over for the head and beak.',
    caption: 'the swan',
    hands: {
      // Edge-on to the lamp: the palm makes a slim neck, the bent fingers the head.
      left: { shape: SWAN, offset: [0, -0.02, 0], point: [0.1, 1, 0], back: [-1, 0, 0] },
    },
    eye: { hand: 'left', joint: J.indexProx, offset: [0, 0.012, -0.01], r: 0.018 },
    say: { text: 'Honk!', dx: 0.2, dy: 0.08 },
  },
  {
    id: 'snail',
    name: 'The Snail',
    hint: 'One hand flat and sideways for the body, the other in a fist on top for the shell.',
    caption: 'the snail',
    hands: {
      left: { shape: SHELL, offset: [0.07, -0.02, 0.015], point: [0.25, 1, 0], back: [0, 0, -1] },
      right: { shape: FOOT, offset: [-0.02, -0.03, 0], point: [1, 0.05, 0], back: [0, 1, 0] },
    },
    eye: { hand: 'right', joint: J.middleProx, offset: [0, 0.01, -0.03], r: 0.016 },
    say: { text: 'Made it!', dx: 0.2, dy: 0.12 },
  },
];

export const STRAIGHT = straight;

/** A relaxed hand resting just above the table (used by the demo autopilot). */
export const RESTING: HandShape = {
  thumb: { cmcAbd: 5, mcp: 10, ip: 10 },
  index: curl(20, 25, 10, 4),
  middle: curl(22, 28, 10, 0),
  ring: curl(25, 30, 12, -4),
  pinky: curl(28, 32, 12, -8),
};
export const REST_PLACEMENT: Record<'left' | 'right', PlacedHand> = {
  left: { shape: RESTING, offset: [-0.2, -0.13, 0.16], point: [0.25, 0, -1], back: [0, 1, 0] },
  right: { shape: RESTING, offset: [0.2, -0.13, 0.16], point: [-0.25, 0, -1], back: [0, 1, 0] },
};

export function puppetById(id: string): PuppetPose {
  const p = PUPPETS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown puppet ${id}`);
  return p;
}

/**
 * The same puppet made with the other hand: placements, eye and callout
 * mirrored across the stage's centre line. Puppets are authored for the left
 * hand; right-handed players get the mirror (the dog then faces left).
 */
export function mirrorPuppet(p: PuppetPose): PuppetPose {
  const m = (v: [number, number, number]): [number, number, number] => [-v[0], v[1], v[2]];
  const mp = (h?: PlacedHand): PlacedHand | undefined => h && { ...h, offset: m(h.offset), point: m(h.point), back: m(h.back) };
  return {
    ...p,
    hands: { left: mp(p.hands.right), right: mp(p.hands.left) },
    eye: p.eye && { ...p.eye, hand: p.eye.hand === 'left' ? 'right' : 'left', offset: m(p.eye.offset) },
    say: p.say && { ...p.say, dx: -p.say.dx },
  };
}
