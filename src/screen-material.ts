import { ShaderMaterial, Texture, Vector2 } from '@iwsdk/core';

/**
 * Paper screen lit by a warm lamp. Composites the live hand shadow, the faint
 * target silhouette, and the "alive" puppet.
 */
export function createScreenMaterial(shadow: Texture, target: Texture, texel: Vector2): ShaderMaterial {
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
      void main() {
        // Warm paper with fibres, lit by a lamp hotspot with gentle flicker.
        float flicker = 0.97 + 0.03 * sin(uTime * 7.3) * sin(uTime * 3.1 + 1.7);
        vec2 c = vUv - vec2(0.5, 0.45);
        c.x *= 1.5;
        float hot = exp(-dot(c, c) * 2.2);
        float fibre = noise(vUv * vec2(180.0, 120.0)) * 0.05 + noise(vUv * vec2(18.0, 9.0)) * 0.06;
        vec3 paper = vec3(1.0, 0.82, 0.55) * (0.28 + 0.95 * hot) * flicker * mix(0.22, 1.0, uLamp);
        paper *= 1.0 - fibre;

        // Target silhouette: faint fill + soft outline (ink wash).
        float t = blur(uTarget, vUv, 1.0);
        float tw = blur(uTarget, vUv, 3.5);
        float outline = smoothstep(0.15, 0.45, tw) * (1.0 - smoothstep(0.55, 0.9, tw));
        float targetInk = (t * 0.10 + outline * 0.35) * uTargetAlpha;
        vec3 col = mix(paper, vec3(0.45, 0.22, 0.12), targetInk);

        // Live shadow with soft penumbra.
        float s = blur(uShadow, vUv, uSoft);
        float shadowAmt = s * 0.9;
        // Matching glow: as the score rises, the target's outline warms toward gold.
        col = mix(col, vec3(0.06, 0.035, 0.03) * (0.6 + hot), shadowAmt);
        col += vec3(1.0, 0.65, 0.2) * outline * uMatch * 0.55 * uTargetAlpha;

        // Alive puppet: the target drawn as a solid, deep shadow.
        col = mix(col, vec3(0.05, 0.03, 0.02), t * uAlive * 0.92);
        col += vec3(0.9, 0.5, 0.15) * outline * uAlive * 0.35 * (0.6 + 0.4 * sin(uTime * 4.0));

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
