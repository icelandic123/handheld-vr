import { Euler, Matrix4, Quaternion, Vector3 } from '@iwsdk/core';
import { JOINT_COUNT, JOINT_NAMES } from './joints.js';
import { REST_JOINT_MATRICES, REST_JOINT_RADII } from './rest-hand.js';

/**
 * Forward-kinematics hand rig used to author puppet target poses.
 *
 * Angles are degrees. Finger flexion: 0 = straight, positive = curl toward the
 * palm. Spread: positive = toward the thumb side. Thumb CMC values are deltas
 * from the rest (relaxed) thumb.
 *
 * Joint frames follow WebXR: -Z points along the bone toward the fingertip,
 * +Y points out of the back of the hand. The rig is authored as a LEFT hand
 * (IWER convention); right hands are mirrored across the target-ray X axis.
 */
export interface FingerCurl {
  mcp: number;
  pip: number;
  dip: number;
  spread?: number;
}
export interface ThumbCurl {
  cmcFlex?: number;
  cmcAbd?: number;
  cmcTwist?: number;
  mcp: number;
  ip: number;
}
export interface HandShape {
  thumb: ThumbCurl;
  index: FingerCurl;
  middle: FingerCurl;
  ring: FingerCurl;
  pinky: FingerCurl;
}
export interface PlacedHand {
  shape: HandShape;
  /** Wrist offset (m) from the stage's canonical hand point, stage-local. */
  offset: [number, number, number];
  /** Direction the fingers point (stage-local). */
  point: [number, number, number];
  /** Direction the back of the hand faces (stage-local). */
  back: [number, number, number];
}

const DEG = Math.PI / 180;
const FINGERS: Array<[keyof Omit<HandShape, 'thumb'>, number]> = [
  ['index', 5],
  ['middle', 10],
  ['ring', 15],
  ['pinky', 20],
];

const rest = REST_JOINT_MATRICES.map((a) => new Matrix4().fromArray(a));
/** Rest transform of each joint relative to its parent joint. */
const restLocal: Matrix4[] = [];
const restPos: Vector3[] = [];
const restYaw: number[] = [];
const PARENT = [-1, 0, 1, 2, 3, 0, 5, 6, 7, 8, 0, 10, 11, 12, 13, 0, 15, 16, 17, 18, 0, 20, 21, 22, 23];
{
  const inv = new Matrix4();
  const p = new Vector3();
  const q = new Quaternion();
  const s = new Vector3();
  const e = new Euler();
  for (let i = 0; i < JOINT_COUNT; i++) {
    const par = PARENT[i];
    const local = par < 0 ? rest[i].clone() : inv.copy(rest[par]).invert().multiply(rest[i]).clone();
    restLocal.push(local);
    local.decompose(p, q, s);
    restPos.push(p.clone());
    e.setFromQuaternion(q, 'YXZ');
    restYaw.push(e.y);
  }
}

const MIRROR = new Matrix4().makeScale(-1, 1, 1);
const tmpA = new Matrix4();
const tmpR = new Matrix4();
const tmpQ = new Quaternion();
const tmpE = new Euler();

function bend(out: Matrix4, parent: Matrix4, pos: Vector3, yawRad: number, flexDeg: number, twistRad = 0): void {
  tmpE.set(-flexDeg * DEG, yawRad, twistRad, 'YXZ');
  tmpQ.setFromEuler(tmpE);
  tmpR.makeRotationFromQuaternion(tmpQ);
  tmpR.setPosition(pos);
  out.multiplyMatrices(parent, tmpR);
}

/**
 * Compute 25 joint matrices (column-major, 25*16) in the hand's target-ray
 * frame for the given shape. Writes radii (25) too.
 */
export function solveHand(shape: HandShape, handedness: 'left' | 'right', outMats: Float32Array, outRadii: Float32Array, scale = 1): void {
  const M: Matrix4[] = solveScratch;
  M[0].copy(rest[0]);
  for (const [name, base] of FINGERS) {
    const f = shape[name];
    M[base].multiplyMatrices(M[0], restLocal[base]);
    bend(M[base + 1], M[base], restPos[base + 1], restYaw[base + 1] + (f.spread ?? 0) * DEG, f.mcp);
    bend(M[base + 2], M[base + 1], restPos[base + 2], 0, f.pip);
    bend(M[base + 3], M[base + 2], restPos[base + 3], 0, f.dip);
    bend(M[base + 4], M[base + 3], restPos[base + 4], 0, 0);
  }
  const t = shape.thumb;
  // Thumb CMC: rest orientation, then deltas.
  tmpA.multiplyMatrices(M[0], restLocal[1]);
  tmpE.set(-(t.cmcFlex ?? 0) * DEG, (t.cmcAbd ?? 0) * DEG, (t.cmcTwist ?? 0) * DEG, 'YXZ');
  tmpQ.setFromEuler(tmpE);
  tmpR.makeRotationFromQuaternion(tmpQ);
  M[1].multiplyMatrices(tmpA, tmpR);
  bend(M[2], M[1], restPos[2], restYaw[2], t.mcp);
  bend(M[3], M[2], restPos[3], 0, t.ip);
  bend(M[4], M[3], restPos[4], 0, 0);

  if (scale !== 1) {
    // Uniform hand-size scaling about the wrist (for matching player size).
    const w = new Vector3().setFromMatrixPosition(M[0]);
    for (let i = 1; i < JOINT_COUNT; i++) {
      const p = new Vector3().setFromMatrixPosition(M[i]).sub(w).multiplyScalar(scale).add(w);
      M[i].setPosition(p);
    }
  }

  for (let i = 0; i < JOINT_COUNT; i++) {
    if (handedness === 'right') {
      tmpA.multiplyMatrices(MIRROR, M[i]).multiply(MIRROR);
      tmpA.toArray(outMats, i * 16);
    } else {
      M[i].toArray(outMats, i * 16);
    }
    outRadii[i] = REST_JOINT_RADII[i] * scale;
  }
}
const solveScratch: Matrix4[] = Array.from({ length: JOINT_COUNT }, () => new Matrix4());

/**
 * Build the wrist placement matrix (stage-local) from a point/back spec.
 */
export function wristPlacement(placed: PlacedHand, canonical: Vector3, out: Matrix4): Matrix4 {
  const z = new Vector3(...placed.point).normalize().negate();
  const yRaw = new Vector3(...placed.back);
  const y = yRaw.sub(z.clone().multiplyScalar(yRaw.dot(z))).normalize();
  const x = new Vector3().crossVectors(y, z);
  out.makeBasis(x, y, z);
  out.setPosition(new Vector3(...placed.offset).add(canonical));
  return out;
}

/**
 * Returns the target-ray ("root") pose that puts the wrist joint at the given
 * wrist placement. Used for both the ghost hand and IWER injection.
 */
export function rootFromWrist(wristWorld: Matrix4, jointMats: Float32Array, out: Matrix4): Matrix4 {
  tmpA.fromArray(jointMats, 0).invert();
  return out.multiplyMatrices(wristWorld, tmpA);
}

/** Transform joint matrices in-place by a root matrix. */
export function applyRoot(root: Matrix4, jointMats: Float32Array, out: Float32Array): void {
  for (let i = 0; i < JOINT_COUNT; i++) {
    tmpA.fromArray(jointMats, i * 16);
    tmpA.premultiply(root);
    tmpA.toArray(out, i * 16);
  }
}

/**
 * Export a shape as an IWER HandPose (left-hand authoring convention).
 * IWER mirrors it for the right hand itself.
 */
export function toIwerHandPose(shape: HandShape): { jointTransforms: Record<string, { offsetMatrix: number[]; radius: number }> } {
  const mats = new Float32Array(JOINT_COUNT * 16);
  const radii = new Float32Array(JOINT_COUNT);
  solveHand(shape, 'left', mats, radii);
  return { jointTransforms: toJointRecord(mats, radii) };
}

function toJointRecord(mats: Float32Array, radii: Float32Array): Record<string, { offsetMatrix: number[]; radius: number }> {
  const rec: Record<string, { offsetMatrix: number[]; radius: number }> = {};
  JOINT_NAMES.forEach((n, i) => {
    rec[n] = { offsetMatrix: Array.from(mats.subarray(i * 16, i * 16 + 16)), radius: radii[i] };
  });
  return rec;
}
