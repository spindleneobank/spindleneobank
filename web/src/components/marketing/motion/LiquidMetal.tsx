import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { FRAG, VERT } from './liquidMetalShaders';

/**
 * Port of the Framer "Liquid Metal" code component (WebGL2/WebGL1 fragment shader, GLSL copied verbatim).
 * Constants (loop 16s, DPR clamp 2, pixel cap, intersection margins) are the original ones.
 * Limitation: the SVG-mask source (`source: "svg"`) of the original is not ported; the site only uses `none`.
 */
const D = {
  colorBack: [170 / 255, 170 / 255, 172 / 255],
  colorTint: [1, 1, 1],
  repetition: 2,
  shiftRed: 0.3,
  shiftBlue: 0.3,
  contour: 0.4,
  scale: 0.6,
  rotation: 0,
  offsetX: 0,
  offsetY: 0,
  originX: 0.5,
  originY: 0.5,
  fitCover: 0,
};
const LOOP_S = 16;
const TAU = Math.PI * 2;
const RAD = Math.PI / 180;
const PIXEL_CAP = 1920 * 1080 * 4;

const clock = { elapsed: 0, last: 0, raf: 0, subs: new Set<(t: number) => void>() };
function tick(now: number) {
  clock.raf = requestAnimationFrame(tick);
  const dt = Math.min(100, now - clock.last);
  clock.last = now;
  clock.elapsed += dt;
  for (const s of clock.subs) s(clock.elapsed);
}
function subscribe(fn: (t: number) => void) {
  clock.subs.add(fn);
  if (clock.raf === 0 && !document.hidden) {
    clock.last = performance.now();
    clock.raf = requestAnimationFrame(tick);
  }
  return () => {
    clock.subs.delete(fn);
    if (clock.subs.size === 0 && clock.raf !== 0) {
      cancelAnimationFrame(clock.raf);
      clock.raf = 0;
    }
  };
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(clock.raf);
      clock.raf = 0;
    } else if (clock.subs.size > 0 && clock.raf === 0) {
      clock.last = performance.now();
      clock.raf = requestAnimationFrame(tick);
    }
  });
}

const NAMES = [
  'uResolution',
  'uColorBack',
  'uColorTint',
  'uRepetition',
  'uSoftness',
  'uShiftRed',
  'uShiftBlue',
  'uDistortion',
  'uContour',
  'uAngle',
  'uPhase',
  'uScale',
  'uRotation',
  'uOffset',
  'uOrigin',
  'uFitCover',
  'uUseImage',
  'uMask',
  'uMaskAspect',
  'uMaskScale',
];

class Renderer {
  gl!: WebGLRenderingContext | WebGL2RenderingContext;
  program: WebGLProgram | null = null;
  buffer: WebGLBuffer | null = null;
  loc = new Map<string, WebGLUniformLocation | null>();
  sent = new Map<string, string>();
  w = 0;
  h = 0;
  cssW = 0;
  cssH = 0;
  disposed = false;
  constructor(public canvas: HTMLCanvasElement) {
    this.create();
  }
  create() {
    const opts = {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      powerPreference: 'default' as const,
    };
    const g2 = this.canvas.getContext('webgl2', opts);
    const gl = (g2 ?? this.canvas.getContext('webgl', opts)) as WebGLRenderingContext | null;
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;
    const v2 = !!g2;
    const deriv = v2 || !!gl.getExtension('OES_standard_derivatives');
    const vh = v2
      ? '#version 300 es\n#define IN in\n#define OUT out\n'
      : '#define IN attribute\n#define OUT varying\n';
    const fh = v2
      ? '#version 300 es\nprecision highp float;\n#define IN in\n#define texture2D texture\nout vec4 fragColor;\n'
      : `${deriv ? '#extension GL_OES_standard_derivatives : enable\n' : ''}precision highp float;\n#define IN varying\n#define fragColor gl_FragColor\n${deriv ? '' : '#define dFdx(x) 0.0\n#define dFdy(x) 0.0\n#define fwidth(x) 0.0\n'}`;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type) as WebGLShader;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(`shader compile failed: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const vs = sh(gl.VERTEX_SHADER, vh + VERT);
    const fs = sh(gl.FRAGMENT_SHADER, fh + FRAG);
    const p = gl.createProgram() as WebGLProgram;
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('program link failed');
    this.program = p;
    gl.useProgram(p);
    for (const n of NAMES) this.loc.set(n, gl.getUniformLocation(p, n));
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(p, 'aPosition');
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
  }
  restore() {
    if (this.disposed) return;
    this.sent.clear();
    this.w = 0;
    this.h = 0;
    this.create();
  }
  resize(cw: number, ch: number) {
    if (cw === this.cssW && ch === this.cssH) return;
    this.cssW = cw;
    this.cssH = ch;
    const dpr = window.devicePixelRatio || 1;
    let r = Math.min(2, Math.max(dpr, 2));
    if (cw * ch * r * r > PIXEL_CAP) r = Math.sqrt(PIXEL_CAP / (cw * ch));
    r = Math.max(0.25, r);
    const w = Math.max(1, Math.round(cw * r));
    const h = Math.max(1, Math.round(ch * r));
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.canvas.width = w;
    this.canvas.height = h;
  }
  f(n: string, v: number) {
    const k = String(v);
    if (this.sent.get(n) === k) return;
    const l = this.loc.get(n);
    if (l) this.gl.uniform1f(l, v);
    this.sent.set(n, k);
  }
  v2(n: string, x: number, y: number) {
    const k = `${x},${y}`;
    if (this.sent.get(n) === k) return;
    const l = this.loc.get(n);
    if (l) this.gl.uniform2f(l, x, y);
    this.sent.set(n, k);
  }
  v3(n: string, v: number[]) {
    const k = v.join(',');
    if (this.sent.get(n) === k) return;
    const l = this.loc.get(n);
    if (l) this.gl.uniform3f(l, v[0] ?? 0, v[1] ?? 0, v[2] ?? 0);
    this.sent.set(n, k);
  }
  draw(o: { softness: number; distortion: number; angle: number; phase: number }) {
    const { gl } = this;
    if (!this.program || gl.isContextLost() || this.w === 0) return;
    gl.useProgram(this.program);
    gl.viewport(0, 0, this.w, this.h);
    this.v2('uResolution', this.w, this.h);
    this.v3('uColorBack', D.colorBack);
    this.v3('uColorTint', D.colorTint);
    this.f('uRepetition', D.repetition);
    this.f('uSoftness', Math.min(1, Math.max(0, o.softness)));
    this.f('uShiftRed', D.shiftRed);
    this.f('uShiftBlue', D.shiftBlue);
    this.f('uDistortion', Math.max(0, o.distortion));
    this.f('uContour', D.contour);
    this.f('uAngle', o.angle * RAD);
    this.f('uScale', D.scale);
    this.f('uRotation', D.rotation * RAD);
    this.v2('uOffset', D.offsetX, D.offsetY);
    this.v2('uOrigin', D.originX, D.originY);
    this.f('uFitCover', D.fitCover);
    this.f('uUseImage', 0);
    this.v2('uMaskAspect', 1, 1);
    this.f('uMaskScale', 1);
    const ph = this.loc.get('uPhase');
    if (ph) gl.uniform1f(ph, o.phase);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  dispose() {
    this.disposed = true;
    const { gl } = this;
    if (!gl) return;
    if (this.buffer) gl.deleteBuffer(this.buffer);
    if (this.program) gl.deleteProgram(this.program);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

export type LiquidMetalProps = {
  distortion?: number;
  softness?: number;
  speed?: number;
  angle?: number;
  animate?: boolean;
  /** Phone-width screens show a still frame unless this is on (Framer default: off). */
  animateOnPhone?: boolean;
  style?: CSSProperties;
  className?: string;
};

/** Framer defaults: distortion .07, softness .1, speed 1, angle 70. */
export function LiquidMetal({
  distortion = 0.07,
  softness = 0.1,
  speed = 1,
  angle = 70,
  animate = true,
  animateOnPhone = false,
  style,
  className,
}: LiquidMetalProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const r = useRef<Renderer | null>(null);
  const [mounted, setMounted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [gen, setGen] = useState(0);
  const props = useRef({ distortion, softness, speed, angle });
  props.current = { distortion, softness, speed, angle };

  const still = () =>
    !animate ||
    (!animateOnPhone && matchMedia('(max-width: 809.98px)').matches) ||
    matchMedia('(prefers-reduced-motion: reduce)').matches;

  const render = (t: number) => {
    const rr = r.current;
    if (!rr) return;
    const p = props.current;
    const phase = (((t * p.speed) / 1000 / LOOP_S) % 1) * TAU;
    rr.draw({ softness: p.softness, distortion: p.distortion, angle: p.angle, phase });
  };

  // mount the canvas once near the viewport (rootMargin 800px 0)
  useEffect(() => {
    const el = wrap.current;
    if (
      !el ||
      typeof IntersectionObserver === 'undefined' ||
      matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setMounted(true);
      return;
    }
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setMounted(true), {
      rootMargin: '800px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const c = canvas.current;
    const el = wrap.current;
    if (!c || !el) return;
    let rr: Renderer;
    try {
      rr = new Renderer(c);
    } catch {
      setFailed(true);
      return;
    }
    r.current = rr;
    const lost = (e: Event) => e.preventDefault();
    const restored = () => {
      try {
        rr.restore();
        measure();
        render(still() ? 0 : clock.elapsed);
      } catch {
        setFailed(true);
      }
    };
    const measure = () => {
      const b = el.getBoundingClientRect();
      rr.resize(Math.max(1, Math.round(b.width)), Math.max(1, Math.round(b.height)));
    };
    c.addEventListener('webglcontextlost', lost);
    c.addEventListener('webglcontextrestored', restored);
    measure();
    render(still() ? 0 : clock.elapsed);
    let pend = false;
    const ro = new ResizeObserver(() => {
      if (pend) return;
      pend = true;
      requestAnimationFrame(() => {
        pend = false;
        measure();
        render(still() ? 0 : clock.elapsed);
      });
    });
    ro.observe(el);
    let unsub: (() => void) | null = null;
    let io: IntersectionObserver | null = null;
    if (still()) render(0);
    else {
      io = new IntersectionObserver(
        (e) => {
          const on = e.some((x) => x.isIntersecting);
          if (on && !unsub) unsub = subscribe(render);
          else if (!on && unsub) {
            unsub();
            unsub = null;
          }
        },
        { rootMargin: '200px', threshold: 0 },
      );
      io.observe(el);
    }
    return () => {
      io?.disconnect();
      unsub?.();
      ro.disconnect();
      c.removeEventListener('webglcontextlost', lost);
      c.removeEventListener('webglcontextrestored', restored);
      rr.dispose();
      r.current = null;
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: renderer lifecycle keyed on mount/animate flags only
  }, [mounted, gen, animate, animateOnPhone]);

  useEffect(() => {
    if (still()) render(0);
    // biome-ignore lint/correctness/useExhaustiveDependencies: redraw on prop change
  }, [distortion, softness, speed, angle]);
  void setGen;

  return (
    <div
      ref={wrap}
      className={className}
      style={{
        position: 'relative',
        display: 'block',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: 'transparent',
        ...style,
      }}
    >
      {mounted && !failed ? (
        <canvas
          ref={canvas}
          style={{
            position: 'absolute',
            inset: 0,
            display: 'block',
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
          }}
        />
      ) : null}
    </div>
  );
}
