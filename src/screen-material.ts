import { ShaderMaterial, Texture, Vector2, Vector3, Vector4 } from '@iwsdk/core';

export const MAX_EYES = 4;

/**
 * Paper screen lit by a warm lamp. Composites the live hand shadow, the faint
 * target silhouette, and the "alive" puppet.
 *
 * Shadow textures: red = hands (sharp, scored), green = forearm (display only,
 * blurred very widely so it reads as a soft sleeve).
 */
export function createScreenMaterial(shadow: Texture, target: Texture, texel: Vector2, screenM: Vector2): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uShadow: { value: shadow },
      uTarget: { value: target },
      uTexel: { value: texel },
      uTime: { value: 0 },
      uTargetAlpha: { value: 1 },
      uMatch: { value: 0 },
      uAlive: { value: 0 },
      uSoft: { value: 1.6 },
      uLamp: { value: 1 },
      uCurtain: { value: 0 },
      uScreenM: { value: screenM },
      // Eyes: (u, v, radius m, openness). Radius 0 = unused.
      uEyes: { value: Array.from({ length: MAX_EYES }, () => new Vector4()) },
      uEyeInk: { value: 0 },
      uEyeHole: { value: 0 },
      uLiveEye: { value: 0 },
      uEyeShift: { value: new Vector2() },
      // Moon: (u, v, strength).
      uMoon: { value: new Vector3(0.8, 0.74, 0) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uShadow;
      uniform sampler2D uTarget;
      uniform vec2 uTexel;
      uniform float uTime;
      uniform float uTargetAlpha;
      uniform float uMatch;
      uniform float uAlive;
      uniform float uSoft;
      uniform float uLamp;
      uniform float uCurtain;
      uniform vec2 uScreenM;
      uniform vec4 uEyes[${MAX_EYES}];
      uniform float uEyeInk;
      uniform float uEyeHole;
      uniform float uLiveEye;
      uniform vec2 uEyeShift;
      uniform vec3 uMoon;
      varying vec2 vUv;

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      float blur(sampler2D t, vec2 uv, float r) {
        vec2 d = uTexel * r;
        float s = texture2D(t, uv).r * 0.25;
        s += texture2D(t, uv + vec2(d.x, 0.0)).r * 0.125;
        s += texture2D(t, uv - vec2(d.x, 0.0)).r * 0.125;
        s += texture2D(t, uv + vec2(0.0, d.y)).r * 0.125;
        s += texture2D(t, uv - vec2(0.0, d.y)).r * 0.125;
        s += texture2D(t, uv + d).r * 0.0625;
        s += texture2D(t, uv - d).r * 0.0625;
        s += texture2D(t, uv + vec2(d.x, -d.y)).r * 0.0625;
        s += texture2D(t, uv + vec2(-d.x, d.y)).r * 0.0625;
        return s;
      }
      // Very wide, cheap blur of the forearm (green) channel.
      float armBlur(sampler2D t, vec2 uv) {
        vec2 d = uTexel * 7.0;
        float s = texture2D(t, uv).g * 0.2;
        for (int i = 0; i < 8; i++) {
          float a = float(i) * 0.785398;
          vec2 o = vec2(cos(a), sin(a));
          s += texture2D(t, uv + o * d).g * 0.06;
          s += texture2D(t, uv + o * d * 2.2).g * 0.04;
        }
        return s;
      }
      // An almond-shaped eye; open = 1 wide open, 0 shut.
      float eyeShape(vec2 uv, vec2 c, float r, float open) {
        vec2 q = (uv - c) * uScreenM;
        q.y /= max(open, 0.06) * 0.85;
        return 1.0 - smoothstep(r * 0.72, r, length(q));
      }
      void main() {
        // Warm paper with fibres, lit by a lamp hotspot with gentle flicker.
        float flicker = 0.97 + 0.03 * sin(uTime * 7.3) * sin(uTime * 3.1 + 1.7);
        vec2 c = vUv - vec2(0.5, 0.45);
        c.x *= 1.5;
        float hot = exp(-dot(c, c) * 2.2);
        float fibre = noise(vUv * vec2(180.0, 120.0)) * 0.05 + noise(vUv * vec2(18.0, 9.0)) * 0.06;
        vec3 paper = vec3(1.0, 0.82, 0.55) * (0.28 + 0.95 * hot) * flicker * mix(0.22, 1.0, uLamp);
        paper *= 1.0 - fibre;

        // The moon the rabbit dreams of (painted on the paper, behind shadows).
        if (uMoon.z > 0.0) {
          vec2 mq = (vUv - uMoon.xy) * uScreenM;
          float md = length(mq);
          float moon = 1.0 - smoothstep(0.075, 0.082, md);
          float crater = noise(mq * 60.0) * 0.12 + noise(mq * 140.0) * 0.06;
          vec3 moonCol = vec3(1.0, 0.95, 0.78) * (1.15 - crater) * mix(0.5, 1.0, uLamp);
          paper = mix(paper, moonCol, moon * uMoon.z);
          paper += vec3(1.0, 0.85, 0.5) * exp(-md * md * 90.0) * 0.18 * uMoon.z;
        }
        vec3 lit = paper;

        // Target silhouette: faint fill + soft outline (ink wash).
        float t = blur(uTarget, vUv, 1.0);
        float tw = blur(uTarget, vUv, 3.5);
        float outline = smoothstep(0.15, 0.45, tw) * (1.0 - smoothstep(0.55, 0.9, tw));
        float targetInk = (t * 0.10 + outline * 0.35) * uTargetAlpha;
        vec3 col = mix(paper, vec3(0.45, 0.22, 0.12), targetInk);

        // Live shadow with soft penumbra; the forearm as a soft sleeve.
        float s = blur(uShadow, vUv, uSoft);
        float arm = armBlur(uShadow, vUv);
        float shadowAmt = max(s, arm * 0.75) * 0.9;
        // Matching glow: as the score rises, the target's outline warms toward gold.
        col = mix(col, vec3(0.06, 0.035, 0.03) * (0.6 + hot), shadowAmt);
        col += vec3(1.0, 0.65, 0.2) * outline * uMatch * 0.55 * uTargetAlpha;

        // Alive puppet: the target drawn as a solid, deep shadow on a soft arm.
        float tArm = armBlur(uTarget, vUv) * 0.7;
        col = mix(col, vec3(0.05, 0.03, 0.02), max(t, tArm) * uAlive * 0.92);
        col += vec3(0.9, 0.5, 0.15) * outline * uAlive * 0.3 * (0.6 + 0.4 * sin(uTime * 4.0));

        // Eyes: inked on the faint target as a hint, lamplight through the
        // shadow once the puppet is alive, and on the player's own shadow as
        // it comes close to the shape.
        for (int i = 0; i < ${MAX_EYES}; i++) {
          vec4 e = uEyes[i];
          if (e.z <= 0.0) continue;
          float d = length((vUv - e.xy) * uScreenM);
          float ring = smoothstep(e.z * 0.55, e.z * 0.8, d) * (1.0 - smoothstep(e.z * 0.95, e.z * 1.2, d));
          col = mix(col, vec3(0.35, 0.16, 0.08), ring * uEyeInk * 0.6);
          float hole = eyeShape(vUv, e.xy, e.z, e.w);
          col = mix(col, lit * 1.08, hole * uEyeHole);
          float live = eyeShape(vUv, e.xy - uEyeShift, e.z, e.w) * uLiveEye * smoothstep(0.4, 0.8, s);
          col = mix(col, lit * 1.08, live);
        }

        // Vignette toward the frame.
        vec2 e = min(vUv, 1.0 - vUv);
        float vig = smoothstep(0.0, 0.06, min(e.x * 1.5, e.y));
        col *= 0.55 + 0.45 * vig;
        // Velvet stage curtains drawn from both sides, plus a fixed valance.
        float closeW = uCurtain * 0.52;
        float edgeL = vUv.x - closeW;
        float edgeR = (1.0 - vUv.x) - closeW;
        float inCurtain = step(edgeL, 0.0) + step(edgeR, 0.0);
        float valance = step(0.955, vUv.y);
        float folds = 0.55 + 0.45 * sin(vUv.x * 95.0 + sin(vUv.y * 6.0) * 1.5);
        vec3 velvet = vec3(0.42, 0.05, 0.06) * folds * (0.35 + 0.75 * hot);
        col = mix(col, velvet, clamp(inCurtain + valance, 0.0, 1.0));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
}
