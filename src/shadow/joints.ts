/**
 * WebXR hand joint layout (order matches XRHand iteration order).
 */
export const JOINT_NAMES = [
  'wrist',
  'thumb-metacarpal',
  'thumb-phalanx-proximal',
  'thumb-phalanx-distal',
  'thumb-tip',
  'index-finger-metacarpal',
  'index-finger-phalanx-proximal',
  'index-finger-phalanx-intermediate',
  'index-finger-phalanx-distal',
  'index-finger-tip',
  'middle-finger-metacarpal',
  'middle-finger-phalanx-proximal',
  'middle-finger-phalanx-intermediate',
  'middle-finger-phalanx-distal',
  'middle-finger-tip',
  'ring-finger-metacarpal',
  'ring-finger-phalanx-proximal',
  'ring-finger-phalanx-intermediate',
  'ring-finger-phalanx-distal',
  'ring-finger-tip',
  'pinky-finger-metacarpal',
  'pinky-finger-phalanx-proximal',
  'pinky-finger-phalanx-intermediate',
  'pinky-finger-phalanx-distal',
  'pinky-finger-tip',
] as const;

export type JointName = (typeof JOINT_NAMES)[number];
export const JOINT_COUNT = 25;

export const J = {
  wrist: 0,
  thumbMeta: 1,
  thumbProx: 2,
  thumbDist: 3,
  thumbTip: 4,
  indexMeta: 5,
  indexProx: 6,
  middleMeta: 10,
  middleProx: 11,
  ringMeta: 15,
  ringProx: 16,
  pinkyMeta: 20,
  pinkyProx: 21,
} as const;

/** Capsule bones drawn between joints (pairs of joint indices). */
export const BONES: ReadonlyArray<readonly [number, number]> = [
  // thumb
  [0, 1], [1, 2], [2, 3], [3, 4],
  // fingers: metacarpal -> proximal -> intermediate -> distal -> tip
  [5, 6], [6, 7], [7, 8], [8, 9],
  [10, 11], [11, 12], [12, 13], [13, 14],
  [15, 16], [16, 17], [17, 18], [18, 19],
  [20, 21], [21, 22], [22, 23], [23, 24],
  // palm edges for thickness when the palm is edge-on to the lamp
  [0, 5], [0, 20],
];

/**
 * Palm fan polygon (ordered loop). The web between thumb and index is
 * approximated by including the thumb proximal joint.
 */
export const PALM_LOOP: ReadonlyArray<number> = [0, 1, 2, 6, 11, 16, 21, 20];
