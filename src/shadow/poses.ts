import type { FingerCurl, HandShape, PlacedHand } from './hand-rig.js';

export interface PuppetPose {
  id: string;
  name: string;
  /** Short instruction shown on the HUD. */
  hint: string;
  /** One hand or two. */
  hands: { left?: PlacedHand; right?: PlacedHand };
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
  index: curl(0, 0, 0, -3),
  middle: curl(0, 0, 0, 0),
  ring: curl(0, 0, 0, 2),
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
  thumb: { cmcAbd: 30, mcp: 0, ip: 0 },
  index: curl(5, 10, 5, 8),
  middle: curl(5, 10, 5, 2),
  ring: curl(5, 10, 5, -4),
  pinky: curl(5, 10, 5, -10),
};

export const PUPPETS: PuppetPose[] = [
  {
    id: 'hello',
    name: 'Hello, lamp',
    hint: 'Hold up an open hand, fingers spread.',
    hands: {
      left: { shape: OPEN_SPREAD, offset: [0, 0, 0], point: [0, 1, 0], back: [0, 0, -1] },
    },
  },
  {
    id: 'dog',
    name: 'The Dog',
    hint: 'Hand sideways, thumb up for an ear, drop your little finger for the jaw.',
    hands: {
      left: { shape: DOG, offset: [-0.04, 0, 0], point: [1, 0.05, 0], back: [0, 0, -1] },
    },
  },
  {
    id: 'rabbit',
    name: 'The Rabbit',
    hint: 'Two fingers up for ears, curl the rest under your thumb.',
    hands: {
      left: { shape: RABBIT, offset: [0, -0.03, 0], point: [0.15, 1, 0], back: [0, 0, -1] },
    },
  },
  {
    id: 'bird',
    name: 'The Bird',
    hint: 'Cross your wrists, hook your thumbs together, spread your fingers as wings.',
    hands: {
      left: { shape: WING, offset: [0.025, 0, 0], point: [-1, 0.6, 0], back: [0, 0, -1] },
      right: { shape: WING, offset: [-0.025, 0, 0], point: [1, 0.6, 0], back: [0, 0, -1] },
    },
  },
];

export const STRAIGHT = straight;
