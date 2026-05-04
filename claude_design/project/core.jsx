// Shared helpers used by all three directions.
// Exposes: window.LIM utilities (timeAgo, classnames, GrainBackground, etc.)

const { useState, useEffect, useRef, useMemo, useCallback } = React;

function timeAgo(iso, now) {
  if (!iso) return '';
  const t = typeof iso === 'string' ? new Date(iso).getTime() : iso.getTime();
  const ref = (now ? (now.getTime ? now.getTime() : now) : Date.now());
  const diff = ref - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function statusLabel(s) { return s.toLowerCase(); }

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

// ─────────── Grain background — WebGL port (p5aholic-style) ───────────
// Faithful adaptation of the uploaded shader port. Uses three.js (loaded via
// CDN — see <script> tag in the HTML host). When `pixelated` is true, the
// shader's `style` uniform = 1.0 which stair-steps UVs into 50×50 blocks.
const GRAIN_VERTEX_SHADER = `
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

const GRAIN_FRAGMENT_SHADER = `
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

function _makeGrainTexture(THREE) {
  const size = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const cx = c.getContext('2d');
  const img = cx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i]     = Math.floor(Math.random() * 256);
    img.data[i + 1] = Math.floor(Math.random() * 256);
    img.data[i + 2] = Math.floor(Math.random() * 256);
    img.data[i + 3] = 255;
  }
  cx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}

function _makeBlurTexture(THREE) {
  const size = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const cx = c.getContext('2d');
  cx.fillStyle = 'black';
  cx.fillRect(0, 0, size, size);
  const g = cx.createRadialGradient(
    size * 0.65, size * 0.45, 0,
    size * 0.65, size * 0.45, size * 0.45,
  );
  g.addColorStop(0,   'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.7)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.2)');
  g.addColorStop(1,   'rgba(255,255,255,0)');
  cx.fillStyle = g;
  cx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}

function GrainBackground({ on, dark, paused, pixelated, grainSrc, blurSrc }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!on || !ref.current) return;
    const THREE = window.THREE;
    if (!THREE) {
      console.warn('GrainBackground: window.THREE not loaded');
      return;
    }

    const container = ref.current;
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    camera.position.z = 5;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    const loader = new THREE.TextureLoader();
    const grainTex = grainSrc ? loader.load(grainSrc) : _makeGrainTexture(THREE);
    const blurTex  = blurSrc  ? loader.load(blurSrc)  : _makeBlurTexture(THREE);
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

    // Exact back values from p5aholic's Config
    const backColor = dark
      ? new THREE.Vector3(0.05, 0.05, 0.05)
      : new THREE.Vector3(0.90, 0.90, 0.90);

    const uniforms = {
      grainTex: { value: grainTex },
      blurTex:  { value: blurTex },
      time:     { value: 0 },
      seed:     { value: Math.random() * 100 },
      back:     { value: backColor },
      style:    { value: pixelated ? 1.0 : 0.0 },
      param1:   { value: 1.0 },   // exact production value
      param2:   { value: 0.05 },  // exact production value
      param3:   { value: 0.2 },   // exact production value
    };

    const material = new THREE.RawShaderMaterial({
      vertexShader: GRAIN_VERTEX_SHADER,
      fragmentShader: GRAIN_FRAGMENT_SHADER,
      uniforms,
      transparent: true,
    });

    // Plane fills the orthographic camera bounds exactly — covers the full
    // viewport regardless of artboard aspect ratio. (p5aholic's original
    // (-0.8, -0.5) offset was tuned to his canvas; on portrait viewports it
    // leaves a blank stripe on the right + bottom.)
    const geometry = new THREE.PlaneGeometry(2, 2);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(0, 0, 1);
    scene.add(mesh);

    let frameId;
    const startTime = performance.now();
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tick = () => {
      const elapsed = (performance.now() - startTime) / 1000;
      uniforms.time.value = (paused || reduceMotion) ? 0 : elapsed;
      renderer.render(scene, camera);
      frameId = requestAnimationFrame(tick);
    };
    tick();

    const ro = new ResizeObserver(() => {
      renderer.setSize(container.clientWidth, container.clientHeight);
    });
    ro.observe(container);

    return () => {
      cancelAnimationFrame(frameId);
      ro.disconnect();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
      geometry.dispose();
      material.dispose();
      grainTex.dispose();
      blurTex.dispose();
      renderer.dispose();
    };
  }, [on, dark, paused, pixelated, grainSrc, blurSrc]);

  if (!on) return null;
  return (
    <div
      ref={ref}
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    />
  );
}

// ─────────── Health bar segment helper ───────────
function healthState(score) {
  if (score >= 90) return 'green';
  if (score >= 60) return 'amber';
  return 'red';
}

// ─────────── Stuck indicator (3 styles, plus diagonal-stripe pattern url) ───────────
function StuckMark({ days, style }) {
  if (!days) return null;
  if (style === 'pulse') {
    return <span className="lim-stuck lim-stuck--pulse" title={`stuck ${days}d`}><span className="lim-pulse-dot" />{days}d</span>;
  }
  if (style === 'stripe') {
    return <span className="lim-stuck lim-stuck--stripe" title={`stuck ${days}d`}>{days}d</span>;
  }
  // hourglass + days (default)
  return (
    <span className="lim-stuck lim-stuck--hg" title={`stuck ${days}d`}>
      <span className="lim-hg">⧗</span>{days}d
    </span>
  );
}

// ─────────── Agent palette (semantic — same across directions) ───────────
const AGENT_LABEL = {
  pipeline: 'pipeline',
  qa: 'qa',
  research: 'research',
  performance: 'perf',
  scripting: 'script',
  onboarding: 'onb',
  fireflies: 'fireflies',
  scheduler: 'sched',
  server: 'server',
  webhook: 'webhook',
};

// ─────────── Health dot ───────────
function HealthDot({ state }) {
  return <span className={`lim-dot lim-dot--${state}`} />;
}

// ─────────── pipeline column compress/expand hook ───────────
function useExpanded(initial) {
  const [open, setOpen] = useState(initial || null);
  return [open, setOpen];
}

window.LIM = {
  timeAgo, statusLabel, clamp, healthState, GrainBackground, StuckMark, HealthDot, AGENT_LABEL, useExpanded,
};
