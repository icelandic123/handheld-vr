import {
  AddEquation,
  BufferAttribute,
  CustomBlending,
  MaxEquation,
  OneFactor,
  ShaderMaterial,
  BufferGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  Quaternion,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import { BONES, JOINT_COUNT, PALM_LOOP } from './joints.js';

/** Layer used by the light camera for things that cast a scored shadow. */
export const LAYER_SCORED = 1;
/** Layer for display-only shadow casters (forearm). */
export const LAYER_DISPLAY_ONLY = 2;

const UP = new Vector3(0, 1, 0);

/**
 * Forearm caster: coverage fades from 1 at the wrist to 0 about a third of the
 * way to the elbow, and is MAX-blended so it never darkens the hand. This keeps
 * the arm from throwing a giant wedge across the screen (a real lamp's falloff
 * looks much the same) while the shadow still reads as "attached to an arm".
 */
let forearmCasterMaterial: ShaderMaterial | null = null;
function getForearmCasterMaterial(): ShaderMaterial {
  if (forearmCasterMaterial) return forearmCasterMaterial;
  forearmCasterMaterial = new ShaderMaterial({
    vertexShader: /* glsl */ `
      varying float vAlong;
      void main() {
        vAlong = uv.y; // fraction of the way from wrist (0) to elbow (1)
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlong;
      void main() {
        float f = 1.0 - smoothstep(0.05, 0.4, vAlong);
        gl_FragColor = vec4(vec3(f), 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
    blending: CustomBlending,
    blendEquation: MaxEquation,
    blendSrc: OneFactor,
    blendDst: OneFactor,
    blendEquationAlpha: AddEquation,
  });
  return forearmCasterMaterial;
}

/**
 * Procedural "capsule" hand built from the 25 WebXR joint poses and radii.
 * One instance of geometry drives two renderings: an optional visible hand in
 * the main scene and a caster copy in the light camera's scene. Because both
 * the player's hand and the target "ghost" hand use this same class, a
 * perfectly matched pose produces the exact same shadow as the target mask.
 */
export class HandProxy {
  readonly casterRoot = new Group();
  readonly visibleRoot = new Group();

  private readonly spheres: InstancedMesh;
  private readonly cylinders: InstancedMesh;
  private readonly casterSpheres: InstancedMesh;
  private readonly casterCylinders: InstancedMesh;
  private readonly palmGeometry: BufferGeometry;
  private readonly palmPositions: Float32Array;
  private readonly forearm: Mesh;
  private readonly casterForearm: Mesh;

  readonly joints: Vector3[] = [];
  readonly radii = new Float32Array(JOINT_COUNT);
  readonly elbow = new Vector3();
  hasForearm = false;

  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly s = new Vector3();
  private readonly mid = new Vector3();
  private readonly dir = new Vector3();
  private readonly centroid = new Vector3();

  constructor(visibleMaterial: Material | null, casterMaterial: Material) {
    for (let i = 0; i < JOINT_COUNT; i++) this.joints.push(new Vector3());

    const sphereGeo = new SphereGeometry(1, 14, 10);
    const cylGeo = new CylinderGeometry(1, 1, 1, 12, 1, true);

    const sphereCount = JOINT_COUNT;
    const cylCount = BONES.length;

    this.casterSpheres = new InstancedMesh(sphereGeo, casterMaterial, sphereCount);
    this.casterCylinders = new InstancedMesh(cylGeo, casterMaterial, cylCount);
    this.casterSpheres.instanceMatrix.setUsage(DynamicDrawUsage);
    this.casterCylinders.instanceMatrix.setUsage(DynamicDrawUsage);

    // Visible copies share the very same instance buffers.
    const vm = visibleMaterial ?? casterMaterial;
    this.spheres = new InstancedMesh(sphereGeo, vm, sphereCount);
    this.cylinders = new InstancedMesh(cylGeo, vm, cylCount);
    this.spheres.instanceMatrix = this.casterSpheres.instanceMatrix;
    this.cylinders.instanceMatrix = this.casterCylinders.instanceMatrix;

    // Palm fan: centroid + loop vertices, triangles around the centroid.
    const n = PALM_LOOP.length;
    this.palmPositions = new Float32Array((n + 1) * 3);
    this.palmGeometry = new BufferGeometry();
    const pos = new BufferAttribute(this.palmPositions, 3);
    pos.setUsage(DynamicDrawUsage);
    this.palmGeometry.setAttribute('position', pos);
    const idx: number[] = [];
    for (let i = 0; i < n; i++) idx.push(0, 1 + i, 1 + ((i + 1) % n));
    this.palmGeometry.setIndex(idx);
    const casterPalm = new Mesh(this.palmGeometry, casterMaterial);
    const palm = new Mesh(this.palmGeometry, vm);

    this.casterForearm = new Mesh(cylGeo, getForearmCasterMaterial());
    this.casterForearm.renderOrder = 10;
    this.forearm = new Mesh(cylGeo, vm);
    this.casterForearm.matrixAutoUpdate = false;
    this.forearm.matrixAutoUpdate = false;

    for (const o of [this.casterSpheres, this.casterCylinders, casterPalm]) {
      o.frustumCulled = false;
      o.layers.set(LAYER_SCORED);
      this.casterRoot.add(o);
    }
    this.casterForearm.frustumCulled = false;
    this.casterForearm.layers.set(LAYER_DISPLAY_ONLY);
    this.casterRoot.add(this.casterForearm);

    for (const o of [this.spheres, this.cylinders, palm, this.forearm]) {
      o.frustumCulled = false;
      this.visibleRoot.add(o);
    }
    this.visibleRoot.visible = visibleMaterial != null;
    this.casterRoot.matrixAutoUpdate = false;
  }

  setTracked(tracked: boolean, showVisible: boolean): void {
    this.casterRoot.visible = tracked;
    this.visibleRoot.visible = tracked && showVisible;
  }

  /**
   * Update from column-major joint matrices (25 * 16) and radii (25), both
   * expressed in the same space as the roots' parent (player space).
   */
  setFromMatrices(mats: ArrayLike<number>, radii: ArrayLike<number>): void {
    for (let i = 0; i < JOINT_COUNT; i++) {
      const o = i * 16;
      this.joints[i].set(mats[o + 12], mats[o + 13], mats[o + 14]);
      this.radii[i] = radii[i];
    }
    this.rebuild();
  }

  /** Update from already-computed joint positions and radii. */
  rebuild(): void {
    const j = this.joints;
    for (let i = 0; i < JOINT_COUNT; i++) {
      const r = this.radii[i];
      this.s.set(r, r, r);
      this.m.compose(j[i], this.q.identity(), this.s);
      this.casterSpheres.setMatrixAt(i, this.m);
    }
    for (let b = 0; b < BONES.length; b++) {
      const [a, c] = BONES[b];
      const r = Math.min(this.radii[a], this.radii[c]) * 0.98;
      this.setCylinder(j[a], j[c], r, this.m);
      this.casterCylinders.setMatrixAt(b, this.m);
    }
    this.casterSpheres.instanceMatrix.needsUpdate = true;
    this.casterCylinders.instanceMatrix.needsUpdate = true;

    // palm
    this.centroid.set(0, 0, 0);
    for (const k of PALM_LOOP) this.centroid.add(j[k]);
    this.centroid.multiplyScalar(1 / PALM_LOOP.length);
    this.palmPositions[0] = this.centroid.x;
    this.palmPositions[1] = this.centroid.y;
    this.palmPositions[2] = this.centroid.z;
    for (let i = 0; i < PALM_LOOP.length; i++) {
      const p = j[PALM_LOOP[i]];
      this.palmPositions[3 + i * 3] = p.x;
      this.palmPositions[4 + i * 3] = p.y;
      this.palmPositions[5 + i * 3] = p.z;
    }
    (this.palmGeometry.attributes.position as BufferAttribute).needsUpdate = true;

    if (this.hasForearm) {
      const r = this.radii[0] * 1.35;
      this.setCylinder(j[0], this.elbow, r, this.casterForearm.matrix);
      this.forearm.matrix.copy(this.casterForearm.matrix);
    }
    this.casterForearm.visible = this.hasForearm;
    this.forearm.visible = this.hasForearm;
  }

  private setCylinder(a: Vector3, b: Vector3, r: number, out: Matrix4): void {
    this.mid.addVectors(a, b).multiplyScalar(0.5);
    this.dir.subVectors(b, a);
    const len = this.dir.length();
    if (len < 1e-6) {
      this.s.set(0, 0, 0);
      out.compose(this.mid, this.q.identity(), this.s);
      return;
    }
    this.dir.multiplyScalar(1 / len);
    this.q.setFromUnitVectors(UP, this.dir);
    this.s.set(r, len, r);
    out.compose(this.mid, this.q, this.s);
  }
}
