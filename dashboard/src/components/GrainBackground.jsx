// GrainBackground.jsx
// Faithful port of p5aholic.me's Circle effect, with exact param values
// and back colors extracted from his bundle Config.
//
// IMPORTANT — for a near-pixel-perfect match, you need his two texture files:
//   - /assets/texture/grain.webp (1024x1024 noise pattern)
//   - /assets/texture/blur.webp  (1024x1024 soft blob alpha mask)
//
// Two ways to provide them:
//
//   Option A — use his actual textures (private use is fine, his FAQ says
//   "Can I use your code? yes"). Download both files from p5aholic.me to
//   your project's public/ folder:
//     curl -o public/grain.webp https://p5aholic.me/assets/texture/grain.webp
//     curl -o public/blur.webp  https://p5aholic.me/assets/texture/blur.webp
//   Then pass <GrainBackground grainSrc="/grain.webp" blurSrc="/blur.webp" />
//
//   Option B — let the component generate procedural substitutes at runtime
//   (default). Won't match exactly but is a reasonable approximation.

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

const vertexShader = `
  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;
  attribute vec3 position;
  attribute vec2 uv;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Verbatim port of his fragment shader (extracted from the public bundle).
const fragmentShader = `
  precision highp float;

  uniform sampler2D grainTex;
  uniform sampler2D blurTex;
  uniform float time;
  uniform float seed;
  uniform vec3 back;
  uniform float style;
  uniform float param1;
  uniform float param2;
  uniform float param3;

  varying vec2 vUv;

  #define PI 3.141592653589793

  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x * 34.0) + 10.0) * x); }

  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                       -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
                   + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m; m = m * m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  float snoise01(vec2 v) { return (1.0 + snoise(v)) * 0.5; }

  float noise2d(vec2 st) {
    return snoise01(vec2(st.x + time * 0.02, st.y - time * 0.04 + seed));
  }

  // Domain warping (Inigo Quilez)
  float pattern(vec2 p) {
    vec2 q = vec2(noise2d(p + vec2(0.0, 0.0)), noise2d(p + vec2(5.2, 1.3)));
    vec2 r = vec2(noise2d(p + 4.0 * q + vec2(1.7, 9.2)), noise2d(p + 4.0 * q + vec2(8.3, 2.8)));
    return noise2d(p + 1.0 * r);
  }

  void main() {
    vec2 uv = vUv;
    vec2 p = gl_FragCoord.xy;

    uv = style > 0.0 ? ceil(uv * 50.0) / 50.0 : uv;

    vec3 grainColor = texture2D(grainTex, mod(p * param1 * 5.0, 1024.0) / 1024.0).rgb;
    float blurAlpha = texture2D(blurTex, uv).a;

    float gr = pow(grainColor.r * 1.0, 1.5) + 0.5 * (1.0 - blurAlpha);
    float gg = grainColor.g;

    float ax = param2 * gr * cos(gg * 2.0 * PI);
    float ay = param2 * gr * sin(gg * 2.0 * PI);

    float ndx = 1.0 * 1.0 * param3 + 0.1 * (1.0 - blurAlpha);
    float ndy = 2.0 * 1.0 * param3 + 0.1 * (1.0 - blurAlpha);
    float nx = uv.x * ndx + ax;
    float ny = uv.y * ndy + ay;
    float n = pattern(vec2(nx, ny));
    n = pow(n * 1.05, 6.0);
    n = smoothstep(0.0, 1.0, n);

    vec3 front = vec3(0.5);
    vec3 result = mix(back, front, n);

    gl_FragColor = vec4(result, blurAlpha);
  }
`;

// Procedural substitutes — used if no texture files are provided.
function makeProceduralGrainTexture(size = 1024) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i]     = Math.floor(Math.random() * 256); // R — used as gr
    img.data[i + 1] = Math.floor(Math.random() * 256); // G — used as gg (angle)
    img.data[i + 2] = Math.floor(Math.random() * 256);
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}

function makeProceduralBlurTexture(size = 1024) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  // Start with a black canvas
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, size, size);
  // Draw a soft white blob centered toward upper-right (matching his off-center)
  const gradient = ctx.createRadialGradient(
    size * 0.65, size * 0.45, 0,
    size * 0.65, size * 0.45, size * 0.45,
  );
  gradient.addColorStop(0,    'rgba(255,255,255,1)');
  gradient.addColorStop(0.4,  'rgba(255,255,255,0.7)');
  gradient.addColorStop(0.7,  'rgba(255,255,255,0.2)');
  gradient.addColorStop(1,    'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}

export default function GrainBackground({
  enabled = true,
  isDark = false,
  grainSrc = null,    // path to grain texture (e.g. "/grain.webp")
  blurSrc = null,     // path to blur texture (e.g. "/blur.webp")
  style = 0,          // 0 = smooth, 1 = pixelated/monospaced
  // p5aholic's exact production values — DO NOT change unless you know what you're doing
  param1 = 1.0,
  param2 = 0.05,
  param3 = 0.2,
}) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!enabled || !containerRef.current) return;

    const container = containerRef.current;

    // Match his scene setup: orthographic camera, 3x3 plane offset from center.
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    camera.position.z = 5;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    // Load textures (or generate procedurally if no src provided)
    const loader = new THREE.TextureLoader();
    const grainTex = grainSrc ? loader.load(grainSrc) : makeProceduralGrainTexture();
    const blurTex  = blurSrc  ? loader.load(blurSrc)  : makeProceduralBlurTexture();
    if (grainSrc) {
      grainTex.minFilter = THREE.NearestFilter;
      grainTex.magFilter = THREE.NearestFilter;
      grainTex.generateMipmaps = false;
    }
    if (blurSrc) {
      blurTex.minFilter = THREE.NearestFilter;
      blurTex.magFilter = THREE.NearestFilter;
      blurTex.generateMipmaps = false;
    }

    // Exact back color values from his Config
    const backColor = isDark
      ? new THREE.Vector3(0.05, 0.05, 0.05)
      : new THREE.Vector3(0.90, 0.90, 0.90);

    const uniforms = {
      grainTex: { value: grainTex },
      blurTex:  { value: blurTex },
      time:     { value: 0 },
      seed:     { value: Math.random() * 100 },
      back:     { value: backColor },
      style:    { value: style },
      param1:   { value: param1 },
      param2:   { value: param2 },
      param3:   { value: param3 },
    };

    const material = new THREE.RawShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      transparent: true,
    });

    // Fullscreen plane — covers the entire viewport so there's no blank strip.
    // (p5aholic uses an off-center 3x3 plane at (-0.8, -0.5, 1), but that's
    // tuned for his portfolio layout. For a fullscreen dashboard background
    // we want full coverage.)
    const geometry = new THREE.PlaneGeometry(2, 2);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(0, 0, 1);
    scene.add(mesh);

    let frameId;
    const startTime = performance.now();
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const animate = () => {
      const elapsed = (performance.now() - startTime) / 1000;
      uniforms.time.value = reduceMotion ? 0 : elapsed;
      renderer.render(scene, camera);
      frameId = requestAnimationFrame(animate);
    };
    animate();

    const handleResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', handleResize);
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      geometry.dispose();
      material.dispose();
      grainTex.dispose();
      blurTex.dispose();
      renderer.dispose();
    };
  }, [enabled, isDark, grainSrc, blurSrc, style, param1, param2, param3]);

  if (!enabled) return null;

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: -1,
        pointerEvents: 'none',
      }}
    />
  );
}
