// @ts-nocheck
/**
 * Port of the old site's "Fluted Swirl" hero shader (runtime/FlutedSwirl.mjs): swirl scene shader, fluted-glass shader,
 * cursor ink-trail field and WebGL2 renderer. Logic, GLSL and constants are copied from the original module.
 * Aliases: DEFAULTS=Ts, VERT=Es, SCENE_FRAG=Os, GLASS_FRAG=ks, InkField=Ps, Renderer=Fs.
 */
const lib = (() => {
  let Ts, Es, Ds, Os, ks, As, js, Ms, Ns, $, Ps, Fs;
  function Q(e, t, n) {
    return (
      t in e
        ? Object.defineProperty(e, t, { value: n, enumerable: !0, configurable: !0, writable: !0 })
        : (e[t] = n),
      e
    );
  }
  function _s(e) {
    const t = As.get(e);
    if (t) return t;
    const n = vs(e);
    return (As.size > 64 && As.clear(), As.set(e, n), n);
  }
  function vs(e) {
    let t = (e || `#000000`).trim(),
      n = t.match(/rgba?\(([^)]+)\)/i),
      r;
    if (n)
      r = n[1]
        .split(`,`)
        .slice(0, 3)
        .map((e) => parseFloat(e) / 255);
    else {
      (t = t.replace(`#`, ``)),
        t.length === 3 &&
          (t = t
            .split(``)
            .map((e) => e + e)
            .join(``));
      const e = parseInt(t.slice(0, 6), 16) || 0;
      r = [(e >> 16) & 255, (e >> 8) & 255, e & 255].map((e) => e / 255);
    }
    return r.map((e) => (e <= 0.04045 ? e / 12.92 : ((e + 0.055) / 1.055) ** 2.4));
  }
  function ys(e) {
    let t = (e && e.length ? e : [`#ffffff`]).slice(0, 8),
      n = t.join(`|`),
      r = js.get(n);
    return (
      r ||
        ((r = new Float32Array(24)),
        t.forEach((e, t) => {
          const n = _s(e);
          for (let e = 0; e < 3; e++) {
            const i = n[e],
              a = i <= 0.0031308 ? i * 12.92 : 1.055 * i ** (1 / 2.4) - 0.055;
            r[t * 3 + e] = a * 2 - 1;
          }
          const i = 0.2126 * r[t * 3] + 0.7152 * r[t * 3 + 1] + 0.0722 * r[t * 3 + 2];
          for (let e = 0; e < 3; e++) r[t * 3 + e] -= i * 0.95;
        }),
        js.size > 32 && js.clear(),
        js.set(n, r)),
      { n: t.length, v: r }
    );
  }
  function bs(e) {
    Ms[0] = e;
    let t = Ns[0],
      n = (t >>> 16) & 32768,
      r = ((t >>> 23) & 255) - 127 + 15,
      i = t & 8388607;
    return r <= 0
      ? r < -10
        ? n
        : ((i = (i | 8388608) >> (1 - r)), n | (i >> 13))
      : r >= 31
        ? n | 31744
        : n | (r << 10) | (i >> 13);
  }
  function xs(e, t, n) {
    const r = e.createShader(t);
    if ((e.shaderSource(r, n), e.compileShader(r), !e.getShaderParameter(r, e.COMPILE_STATUS)))
      throw Error(e.getShaderInfoLog(r) || `shader`);
    return r;
  }
  function Ss(e, t) {
    const n = e.createProgram();
    if (
      (e.attachShader(n, xs(e, e.VERTEX_SHADER, Es)),
      e.attachShader(n, xs(e, e.FRAGMENT_SHADER, t)),
      e.bindAttribLocation(n, 0, `aPos`),
      e.linkProgram(n),
      !e.getProgramParameter(n, e.LINK_STATUS))
    )
      throw Error(e.getProgramInfoLog(n) || `link`);
    const r = {},
      i = e.getProgramParameter(n, e.ACTIVE_UNIFORMS);
    for (let t = 0; t < i; t++) {
      const i = e.getActiveUniform(n, t).name;
      r[i] = e.getUniformLocation(n, i);
    }
    return { p: n, loc: r };
  }
  function Cs(e) {
    const t = (e) =>
        _s(e)
          .map((e) => e.toFixed(3))
          .join(`,`),
      n = (e) => e.toFixed(3);
    return [
      t(e.colorA),
      t(e.colorB),
      e.palette.map(t).join(`;`),
      n(e.aberration),
      n(e.paletteGain),
      n(e.angle),
      n(e.frequency),
      n(e.refraction),
    ].join(`|`);
  }
  (Ts = {
    colorA: 'rgba(243, 218, 205, 1)',
    colorB: 'rgba(233, 214, 223, 1)',
    detail: 2.7,
    swirlSpeed: 1,
    blend: 84,
    interactive: !0,
    inkBase: `#ffffff`,
    inkUp: `#000000`,
    inkDown: `#000000`,
    inkLeft: `#000000`,
    inkRight: `#000000`,
    inkIntensity: 1,
    inkMomentum: 13,
    inkRadius: 3.5,
    shape: `rounded`,
    angle: 31,
    frequency: 16,
    softness: 1,
    refraction: 4.9,
    aberration: 0.46,
    lightAngle: -90,
    highlight: 0.12,
    highlightSoftness: 0,
    highlightColor: 'rgba(233, 214, 223, 1)',
    waveAmplitude: 0.06,
    waveFrequency: 1.5,
    glassSpeed: 0.15,
    grain: 0.05,
    grainBias: 2,
    toneMin: 0,
    toneMax: 0.9,
    edgeLow: 0.3,
    edgeHigh: 0.885,
    midCurve: 0.89,
    palette: [`#FFE0D6`, `#E4B67C`, `#5FC3EE`, `#718EE8`],
    paletteGain: 1.76,
    paletteEdge: 0.263,
  }),
    (Es = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
    vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5); // y-down, like the source
    gl_Position = vec4(aPos, 0.0, 1.0);
}`),
    (Ds = `
vec3 toSrgb(vec3 c) {
    c = max(c, 0.0);
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}`),
    (Os = `#version 300 es
precision highp float;
in vec2 vUv;
uniform float uTime;
uniform float uDetail;
uniform float uBias;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform sampler2D uField;
uniform float uFieldOn;
uniform vec3 uInkBase;
uniform vec3 uInkUp;
uniform vec3 uInkDown;
uniform vec3 uInkLeft;
uniform vec3 uInkRight;
uniform vec2 uTone;       // x: darkest, y: brightest, as a share of the way from colour A to colour B
uniform vec2 uThreshold;  // swirl edge softness (source: 0.3, 0.7)
uniform float uMid;       // mid-tone curve: >1 keeps more of the swirl in neutral greys
out vec4 outColor;
${Ds}
float flowLayers(vec2 uv, float detail, float t) {
    float f1 = detail;
    vec2 d1 = vec2(
        uv.x + sin(uv.y * f1 * 1.7 + t * 0.8) * 0.12 + cos(uv.x * f1 * 0.9 - t * 0.5) * 0.05,
        uv.y + cos(uv.x * f1 * 1.3 - t * 0.6) * 0.12 + sin(uv.y * f1 * 1.1 + t * 0.7) * 0.05);
    float p1 = sin(d1.x * f1 * 2.1 + d1.y * f1 * 1.8 + t * 0.4);
    float f2 = detail * 2.1;
    vec2 d2 = vec2(
        d1.x + cos(d1.y * f2 * 2.7 - t * 0.45) * 0.07 + sin(d1.x * f2 * 1.9 + t * 0.6) * 0.04,
        d1.y + sin(d1.x * f2 * 2.3 + t * 0.65) * 0.07 + cos(d1.y * f2 * 1.6 - t * 0.4) * 0.04);
    float p2 = cos(d2.x * f2 * 1.4 - d2.y * f2 * 1.9 + t * 0.35);
    float f3 = detail * 3.7;
    vec2 d3 = vec2(
        d2.x + sin(d2.y * f3 * 1.8 + t * 0.85) * 0.04 + cos(d2.x * f3 * 1.3 - t * 0.55) * 0.025 + sin((d2.x + d2.y) * f3 * 0.7 + t * 0.9) * 0.02,
        d2.y + cos(d2.x * f3 * 1.6 - t * 0.75) * 0.04 + sin(d2.y * f3 * 1.1 + t * 0.5) * 0.025 + cos((d2.x + d2.y) * f3 * 0.8 - t * 0.95) * 0.02);
    float p3 = sin(d3.x * f3 * 1.1 + d3.y * f3 * 1.5 - t * 0.55);
    return p1 * 0.45 + p2 * 0.35 + p3 * 0.2;
}
vec4 inkColor(vec4 s0, vec4 s1, vec4 s2, vec4 s3, vec4 s4) {
    float liquid = smoothstep(0.0, 0.1, (s0.z + s1.z + s2.z + s3.z + s4.z) * 0.2);
    vec2 flow = (s0.xy + s1.xy + s2.xy + s3.xy + s4.xy) * 0.2;
    float mag = length(flow);
    float hasFlow = smoothstep(0.01, 0.1, mag);
    float nx = flow.x / (mag + 0.001);
    float ny = flow.y / (mag + 0.001);
    float r = smoothstep(0.0, 0.7, max(nx, 0.0));
    float l = smoothstep(0.0, 0.7, max(-nx, 0.0));
    float u = smoothstep(0.0, 0.7, max(ny, 0.0));
    float d = smoothstep(0.0, 0.7, max(-ny, 0.0));
    float hw = l + r;
    float vw = u + d;
    float tw = hw + vw + 0.001;
    vec4 horiz = vec4(uInkLeft, 1.0) * l + vec4(uInkRight, 1.0) * r;
    vec4 vert = vec4(uInkDown, 1.0) * d + vec4(uInkUp, 1.0) * u;
    vec4 dir = horiz * (hw / tw) + vert * (vw / tw);
    return mix(vec4(uInkBase, 1.0), dir, hasFlow) * liquid; // premultiplied
}
void main() {
    float pat = flowLayers(vUv, uDetail, uTime);
    float k = pow(smoothstep(uThreshold.x, uThreshold.y, pat * 0.5 + 0.5 + uBias), uMid);
    vec3 col = mix(uColorA, uColorB, k);
    col *= sin(uTime * 2.5 + pat * 8.0) * 0.015 + 1.0;
    if (uFieldOn > 0.5) {
        float px = 1.0 / 128.0;
        vec4 ink = inkColor(
            texture(uField, vUv),
            texture(uField, vUv + vec2(px, 0.0)),
            texture(uField, vUv + vec2(0.0, px)),
            texture(uField, vUv + vec2(-px, 0.0)),
            texture(uField, vUv + vec2(0.0, -px)));
        col = ink.rgb + col * (1.0 - ink.a);
    }
    // Keep the result inside a neutral band between the two colours, so it
    // never collapses into solid black or blown-out white.
    vec3 span = uColorB - uColorA;
    vec3 rel = (col - uColorA) / max(abs(span), vec3(1e-4)) * sign(span + 1e-6);
    col = uColorA + span * (uTone.x + clamp(rel, -0.2, 1.2) * (uTone.y - uTone.x));
    outColor = vec4(max(col, 0.0), 1.0); // linear; the sRGB target encodes on write
}`),
    (ks = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform float uAspect;
uniform float uFluteT;
uniform float uAngle;
uniform float uFreq;
uniform float uSoft;
uniform float uWaveAmp;
uniform float uWaveFreq;
uniform float uRefr;
uniform float uAberr;
uniform int uPalN;        // reflection colours in use (1-8)
uniform vec3 uPal[8];     // each colour as a tint direction (2c - 1)
uniform float uPalGain;   // reflection strength
uniform float uPalEdge;   // edge contrast that reaches the outermost colours
uniform vec3 uShape;
uniform float uLightAngle;
uniform float uHighlight;
uniform float uHlSoft;
uniform vec3 uHlColor;
uniform float uGrain;
uniform float uGrainBias;
uniform vec2 uViewport;
out vec4 outColor;
${Ds}
const float PI = 3.14159265359;
vec2 mirrorUv(vec2 uv) {
    vec2 m = mod(abs(uv), 2.0);
    return vec2(m.x >= 1.0 ? 2.0 - m.x : m.x, m.y >= 1.0 ? 2.0 - m.y : m.y);
}
vec3 scene(vec2 uv) {
    vec2 m = mirrorUv(uv);
    return texture(uScene, vec2(m.x, 1.0 - m.y)).rgb; // sRGB texture: reads are linear
}
float hash12(vec2 p) {
    uvec2 u = floatBitsToUint(p * vec2(141421356.0, 2718281828.0));
    return float((u.x ^ u.y) * 3141592653u) / 4294967295.0;
}
// One flute sample: refraction + colour split, plus its highlight term.
vec4 fluteSample(float pos, float cosA, float sinA) {
    float cell = (fract(pos) - 0.5) * 2.0;
    float absCell = max(abs(cell), 1e-4);
    float slope = sign(cell) * pow(absCell, mix(uShape.x, uShape.y, uSoft));
    float halfCell = 0.5 / max(uFreq, 0.001);
    float refrU = -slope * uRefr * halfCell;
    vec2 ruv = vec2(vUv.x + refrU * cosA / uAspect, vUv.y + refrU * sinA);
    float chrU = refrU * uAberr * 0.5;
    vec2 off = vec2(chrU * cosA / uAspect, chrU * sinA);
    // Reflections: the contrast across the flute edge picks a colour from the
    // list (first colour on one side, last on the other; strong edges reach the
    // outer colours) and tints only the edge. Flat areas stay untouched, and the
    // cost is three reads however many colours are listed.
    vec3 sC = scene(ruv);
    float e = dot(scene(ruv + off) - scene(ruv - off), vec3(0.2126, 0.7152, 0.0722));
    float x = (1.0 - clamp(e / uPalEdge, -1.0, 1.0)) * 0.5 * float(uPalN - 1);
    int i0 = int(x);
    vec3 tint = mix(uPal[i0], uPal[min(i0 + 1, uPalN - 1)], x - float(i0));
    vec3 col = max(sC + abs(e) * uPalGain * tint, 0.0);
    float slopeSq = min(slope * slope, 1.0);
    float nz = sqrt(1.0 - slopeSq);
    float half_ = uLightAngle * PI / 360.0;
    float nDotH = max(slope * sin(half_) + nz * cos(half_), 0.0);
    float shininess = exp2(8.0 - uHlSoft * 7.0);
    float fresnel = 0.04 + 0.96 * pow(1.0 - nz, 5.0);
    return vec4(col, pow(nDotH, shininess) * fresnel * uHighlight);
}
void main() {
    float r = uAngle * PI / 180.0;
    float cosA = cos(r);
    float sinA = sin(r);
    vec2 ac = vec2((vUv.x - 0.5) * uAspect, vUv.y - 0.5);
    float u = ac.x * cosA + ac.y * sinA;
    float v = -ac.x * sinA + ac.y * cosA;
    float wave = sin(v * uWaveFreq * PI * 2.0 + uFluteT * 2.0) * uWaveAmp;
    float pos = (u + uShape.z * wave) * uFreq + uFluteT;
    // Anti-alias the hard step between flutes: only pixels next to a flute
    // boundary take four sub-samples; everything else takes one.
    float w = fwidth(pos);
    float f = fract(pos);
    vec4 s;
    if (min(f, 1.0 - f) < w * 1.5) {
        s = (fluteSample(pos - w * 0.375, cosA, sinA) + fluteSample(pos - w * 0.125, cosA, sinA)
           + fluteSample(pos + w * 0.125, cosA, sinA) + fluteSample(pos + w * 0.375, cosA, sinA)) * 0.25;
    } else {
        s = fluteSample(pos, cosA, sinA);
    }
    vec3 col = s.rgb + uHlColor * s.a;
    // grain (static, like animated: false)
    if (uGrain > 0.0) {
        float n = hash12(vUv * uViewport);
        float bright = clamp(dot(col, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
        col += (n * 2.0 - 1.0) * pow(1.0 - bright + 1e-6, uGrainBias) * (uGrain * 0.1);
    }
    outColor = vec4(toSrgb(col), 1.0);
}`),
    (As = new Map()),
    (js = new Map()),
    (Ms = new Float32Array(1)),
    (Ns = new Uint32Array(Ms.buffer)),
    ($ = 128),
    (Ps = class {
      step(e, t, n, r, i) {
        e = Math.min(e, 0.016);
        const a = e > 0 ? (t - this.prevX) / e : 0,
          o = e > 0 ? (n - this.prevY) / e : 0;
        if (
          ((this.velX = this.velX * 0.85 + a * 0.15),
          (this.velY = this.velY * 0.85 + o * 0.15),
          (this.prevX = t),
          (this.prevY = n),
          (this.injecting = Math.abs(a) + Math.abs(o) > 0.01),
          !this.injecting && this.max < 1e-4)
        )
          return ((this.active = !1), !1);
        let { data: s, temp: c } = this,
          l = i.inkRadius * 0.05,
          u = 1 - e,
          d = 1 - e,
          f = i.inkMomentum * 50 * e,
          p = 0;
        for (let e = 0; e < $; e++)
          for (let t = 0; t < $; t++) {
            const n = (e * $ + t) * 4,
              r = s[n],
              i = s[n + 1];
            if (
              ((c[n] = r * u),
              (c[n + 1] = i * u),
              (c[n + 2] = s[n + 2] * d),
              Math.abs(r) > 0.001 || Math.abs(i) > 0.001)
            ) {
              const a = t - r * f,
                o = e - i * f,
                l = Math.floor(a),
                u = Math.floor(o);
              if (l >= 0 && u >= 0 && l + 1 < $ && u + 1 < $) {
                const e = a - l,
                  t = o - u,
                  r = (u * $ + l) * 4 + 2,
                  i = r + 4,
                  f = r + $ * 4,
                  p = f + 4;
                c[n + 2] =
                  (s[r] * (1 - e) * (1 - t) + s[i] * e * (1 - t) + s[f] * (1 - e) * t + s[p] * e * t) * d;
              }
            }
            const a = Math.max(Math.abs(c[n]), Math.abs(c[n + 1]), c[n + 2]);
            a > p && (p = a);
          }
        if (this.injecting) {
          const a = Math.sqrt(this.velX * this.velX + this.velY * this.velY),
            o = l * Math.min(a * a * 20, 1),
            s = o * 2 * (o * 2),
            u = Math.max(o * o, 1e-9),
            d = i.inkIntensity * 100 * e * 0.01,
            f = Math.min(a * 10, 1),
            p = o * 2,
            m = Math.max(0, Math.floor((t - p / Math.max(r, 1)) * $) - 1),
            h = Math.min($ - 1, Math.ceil((t + p / Math.max(r, 1)) * $) + 1),
            g = Math.max(0, Math.floor((n - p * Math.max(1 / r, 1)) * $) - 1),
            _ = Math.min($ - 1, Math.ceil((n + p * Math.max(1 / r, 1)) * $) + 1);
          for (let e = g; e <= _; e++)
            for (let i = m; i <= h; i++) {
              const a = (i + 0.5) / $,
                o = (e + 0.5) / $,
                l = r >= 1 ? (a - t) * r : a - t,
                p = r >= 1 ? o - n : (o - n) / r,
                m = l * l + p * p;
              if (m < s) {
                const t = (e * $ + i) * 4,
                  n = Math.exp(-m / u);
                (c[t] = Math.max(-1, Math.min(1, c[t] + this.velX * n * d))),
                  (c[t + 1] = Math.max(-1, Math.min(1, c[t + 1] + this.velY * n * d))),
                  (c[t + 2] = Math.max(0, Math.min(1, c[t + 2] + n * d * f)));
              }
            }
        }
        (this.max = this.injecting ? 1 : p), s.set(c);
        const m = this.half;
        for (let e = 0; e < s.length; e++) m[e] = bs(s[e]);
        return ((this.active = !0), !0);
      }
      reset() {
        this.data.fill(0), this.temp.fill(0), this.half.fill(0), (this.max = 0), (this.active = !1);
      }
      constructor() {
        Q(this, `data`, new Float32Array($ * $ * 4)),
          Q(this, `temp`, new Float32Array($ * $ * 4)),
          Q(this, `half`, new Uint16Array($ * $ * 4)),
          Q(this, `velX`, 0),
          Q(this, `velY`, 0),
          Q(this, `prevX`, 0.5),
          Q(this, `prevY`, 0.5),
          Q(this, `max`, 0),
          Q(this, `injecting`, !1),
          Q(this, `active`, !1);
      }
    }),
    (Fs = class {
      texParams(e) {
        const t = this.gl;
        t.texParameteri(t.TEXTURE_2D, t.TEXTURE_MIN_FILTER, e),
          t.texParameteri(t.TEXTURE_2D, t.TEXTURE_MAG_FILTER, e),
          t.texParameteri(t.TEXTURE_2D, t.TEXTURE_WRAP_S, t.CLAMP_TO_EDGE),
          t.texParameteri(t.TEXTURE_2D, t.TEXTURE_WRAP_T, t.CLAMP_TO_EDGE);
      }
      resize(e, t, n, r = 3e6) {
        (e = Math.max(1, e)), (t = Math.max(1, t));
        let i = Math.min(Math.max(n, 1), 2);
        e * t * i * i > r && (i = Math.sqrt(r / (e * t)));
        const a = Math.max(1, Math.round(e * i)),
          o = Math.max(1, Math.round(t * i)),
          s = Math.max(64, Math.round(e * 0.5)),
          c = Math.max(64, Math.round(t * 0.5));
        if (
          ((this.cssW = e),
          (this.cssH = t),
          (a !== this.w || o !== this.h) &&
            ((this.canvas.width = a), (this.canvas.height = o), (this.w = a), (this.h = o)),
          s !== this.sw || c !== this.sh)
        ) {
          const e = this.gl;
          e.bindTexture(e.TEXTURE_2D, this.sceneTex),
            e.texImage2D(e.TEXTURE_2D, 0, e.SRGB8_ALPHA8, s, c, 0, e.RGBA, e.UNSIGNED_BYTE, null),
            this.texParams(e.LINEAR),
            e.bindFramebuffer(e.FRAMEBUFFER, this.fbo),
            e.framebufferTexture2D(e.FRAMEBUFFER, e.COLOR_ATTACHMENT0, e.TEXTURE_2D, this.sceneTex, 0),
            e.bindFramebuffer(e.FRAMEBUFFER, null),
            (this.sw = s),
            (this.sh = c);
        }
      }
      stepInk(e, t, n, r) {
        const i = this.ink.step(e, t, n, this.cssW / this.cssH, r);
        if (i) {
          const e = this.gl;
          e.bindTexture(e.TEXTURE_2D, this.fieldTex),
            e.texSubImage2D(e.TEXTURE_2D, 0, 0, 0, $, $, e.RGBA, e.HALF_FLOAT, this.ink.half);
        }
        return i;
      }
      draw(e, t) {
        const n = this.gl;
        n.bindVertexArray(this.vao),
          n.bindFramebuffer(n.FRAMEBUFFER, this.fbo),
          n.viewport(0, 0, this.sw, this.sh),
          n.useProgram(this.scene.p);
        const r = this.scene.loc;
        n.uniform1f(r.uTime, e * t.swirlSpeed),
          n.uniform1f(r.uDetail, t.detail),
          n.uniform1f(r.uBias, (t.blend - 50) * 0.006),
          n.uniform3fv(r.uColorA, _s(t.colorA)),
          n.uniform3fv(r.uColorB, _s(t.colorB)),
          n.uniform3fv(r.uInkBase, _s(t.inkBase)),
          n.uniform3fv(r.uInkUp, _s(t.inkUp)),
          n.uniform3fv(r.uInkDown, _s(t.inkDown)),
          n.uniform3fv(r.uInkLeft, _s(t.inkLeft)),
          n.uniform3fv(r.uInkRight, _s(t.inkRight)),
          n.uniform2f(r.uTone, t.toneMin, t.toneMax),
          n.uniform2f(r.uThreshold, t.edgeLow, t.edgeHigh),
          n.uniform1f(r.uMid, t.midCurve),
          n.uniform1f(r.uFieldOn, this.ink.active || this.ink.max > 1e-4 ? 1 : 0),
          n.activeTexture(n.TEXTURE0),
          n.bindTexture(n.TEXTURE_2D, this.fieldTex),
          n.uniform1i(r.uField, 0),
          n.drawArrays(n.TRIANGLES, 0, 3),
          n.bindFramebuffer(n.FRAMEBUFFER, null),
          n.viewport(0, 0, this.w, this.h),
          n.useProgram(this.glass.p);
        const i = this.glass.loc,
          a = t.shape === `bars` ? [16, 4, 0] : t.shape === `waves` ? [8, 3, 1] : [8, 3, 0];
        n.bindTexture(n.TEXTURE_2D, this.sceneTex),
          n.uniform1i(i.uScene, 0),
          n.uniform1f(i.uAspect, this.cssW / this.cssH),
          n.uniform1f(i.uFluteT, -e * t.glassSpeed),
          n.uniform1f(i.uAngle, t.angle),
          n.uniform1f(i.uFreq, t.frequency),
          n.uniform1f(i.uSoft, t.softness),
          n.uniform1f(i.uWaveAmp, t.waveAmplitude),
          n.uniform1f(i.uWaveFreq, t.waveFrequency),
          n.uniform1f(i.uRefr, t.refraction),
          n.uniform1f(i.uAberr, t.aberration);
        const o = ys(t.palette);
        n.uniform1i(i.uPalN, o.n),
          n.uniform3fv(i[`uPal[0]`], o.v),
          n.uniform1f(i.uPalGain, t.paletteGain),
          n.uniform1f(i.uPalEdge, t.paletteEdge),
          n.uniform3fv(i.uShape, a),
          n.uniform1f(i.uLightAngle, t.lightAngle),
          n.uniform1f(i.uHighlight, t.highlight),
          n.uniform1f(i.uHlSoft, t.highlightSoftness),
          n.uniform3fv(i.uHlColor, _s(t.highlightColor)),
          n.uniform1f(i.uGrain, t.grain),
          n.uniform1f(i.uGrainBias, t.grainBias),
          n.uniform2f(i.uViewport, this.w, this.h),
          n.drawArrays(n.TRIANGLES, 0, 3);
      }
      dispose() {
        const e = this.gl;
        e.deleteProgram(this.scene.p),
          e.deleteProgram(this.glass.p),
          e.deleteTexture(this.sceneTex),
          e.deleteTexture(this.fieldTex),
          e.deleteFramebuffer(this.fbo),
          e.getExtension(`WEBGL_lose_context`)?.loseContext();
      }
      constructor(e) {
        Q(this, `gl`, void 0),
          Q(this, `scene`, void 0),
          Q(this, `glass`, void 0),
          Q(this, `vao`, void 0),
          Q(this, `fbo`, void 0),
          Q(this, `sceneTex`, void 0),
          Q(this, `fieldTex`, void 0),
          Q(this, `ink`, new Ps()),
          Q(this, `w`, 0),
          Q(this, `h`, 0),
          Q(this, `sw`, 0),
          Q(this, `sh`, 0),
          Q(this, `cssW`, 1),
          Q(this, `cssH`, 1),
          Q(this, `canvas`, void 0),
          (this.canvas = e);
        const t = e.getContext(`webgl2`, {
          alpha: !1,
          antialias: !1,
          depth: !1,
          stencil: !1,
          premultipliedAlpha: !1,
          powerPreference: `default`,
          preserveDrawingBuffer: !1,
        });
        if (!t) throw Error(`WebGL2 unavailable`);
        (this.gl = t), (this.scene = Ss(t, Os)), (this.glass = Ss(t, ks));
        const n = t.createBuffer();
        (this.vao = t.createVertexArray()),
          t.bindVertexArray(this.vao),
          t.bindBuffer(t.ARRAY_BUFFER, n),
          t.bufferData(t.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), t.STATIC_DRAW),
          t.enableVertexAttribArray(0),
          t.vertexAttribPointer(0, 2, t.FLOAT, !1, 0, 0),
          (this.sceneTex = t.createTexture()),
          (this.fbo = t.createFramebuffer()),
          (this.fieldTex = t.createTexture()),
          t.bindTexture(t.TEXTURE_2D, this.fieldTex),
          t.texImage2D(t.TEXTURE_2D, 0, t.RGBA16F, $, $, 0, t.RGBA, t.HALF_FLOAT, this.ink.half),
          this.texParams(t.LINEAR);
      }
    });
  return { DEFAULTS: Ts, Renderer: Fs };
})();
export const DEFAULTS = lib.DEFAULTS;
export const FlutedRenderer = lib.Renderer;
