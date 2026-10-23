// Verbatim GLSL from the Framer 'Liquid Metal' component (runtime/LiquidMetal.*.mjs).
export const VERT = `
IN vec2 aPosition;
OUT vec2 vUv;

void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;
export const FRAG = `
IN vec2 vUv;

uniform vec2  uResolution;   // drawing buffer size, device px
uniform vec3  uColorBack;
uniform vec3  uColorTint;
uniform float uRepetition;
uniform float uSoftness;
uniform float uShiftRed;
uniform float uShiftBlue;
uniform float uDistortion;
uniform float uContour;
uniform float uAngle;        // radians
uniform float uPhase;        // loop phase, 0..TAU
uniform float uScale;
uniform float uRotation;     // radians
uniform vec2  uOffset;       // units of the fitted dimension
uniform vec2  uOrigin;       // 0..1, y measured downwards
uniform float uFitCover;     // 0 = contain, 1 = cover
uniform float uUseImage;     // 1 when uMask holds the user's SVG silhouette
uniform sampler2D uMask;     // .r = encoded signed distance, .a = coverage
uniform vec2  uMaskAspect;   // keeps a non-square SVG undistorted
uniform float uMaskScale;    // scales SVG mask around center, 1 = unchanged

const float TAU = 6.283185307179586;

// Metal tone ramp in three stops rather than two. The deepest reflections are
// a neutral near-black; the shadow that carries into the silver picks up a
// restrained cool cast; the highlight stays a near-white with a cool edge.
// Two dark characters instead of one is what keeps the dark areas reading as
// layered reflections rather than flat ink.
const vec3 METAL_DARK  = vec3(20.0, 20.0, 22.0) / 255.0;
const vec3 METAL_COOL  = vec3(64.0, 67.0, 80.0) / 255.0;
const vec3 METAL_LIGHT = vec3(250.0, 250.0, 255.0) / 255.0;
const float COOL_PIVOT = 0.14;

/** Per-channel three-stop ramp. Branchless so the channels stay independent. */
vec3 metalRamp(vec3 t) {
  vec3 k1 = clamp(t / COOL_PIVOT, 0.0, 1.0);
  vec3 k2 = clamp((t - COOL_PIVOT) / (1.0 - COOL_PIVOT), 0.0, 1.0);
  return mix(mix(METAL_DARK, METAL_COOL, k1), METAL_LIGHT, k2);
}

// One cycle of the stripe waveform, measured off the reference: a narrow dark
// band, then a narrow bright band, then a long smooth ramp back up to white.
const float BAND_DARK_END  = 0.045;
const float BAND_LIGHT_END = 0.17;
// Lifts the body of the ramp without moving its endpoints, so the silver and
// white keep more of the surface while black and white stay at full contrast.
const float RAMP_LIFT      = 0.78;

// Tuning gains. These convert the 0..1 controls into field-space amounts.
const float FIELD_GAIN      = 1.00; // field units -> stripe cycles
const float BREATH_GAIN     = 0.56; // how far the whole band stack sweeps per loop
const float DISTORTION_GAIN = 0.45; // 'distortion' -> field units of noise
const float CONTOUR_GAIN    = 0.55; // 'contour' -> broad band bend at the edge
const float CONTOUR_FALLOFF = 3.0;  // how fast that broad bend decays inwards
const float RIM_GAIN        = 0.38; // 'contour' -> narrow bevel lobe at the edge
const float RIM_FALLOFF     = 18.0; // bevel width, ~0.055 world units
const float RIM_REFRACTION  = 1.8;  // extra dispersion inside the bevel

// --- chromatic edge -------------------------------------------------------
// Two dispersion terms with different behaviour. The world term is a fixed
// distance, so it holds the fringe to a constant narrow width locked to the
// edge - that is the bulk of the effect. The phase term is a fraction of a
// stripe, so it adds a little extra bloom where bands are open; it is kept
// small, because at high values it spreads colour across whole bands instead
// of keeping it on the transition.
const float DISP_PHASE   = 0.012;
const float DISP_WORLD   = 0.020;
// Green is nudged only slightly toward red. A large bias collapses the warm
// side into flat yellow; a small one keeps a wide red band ahead of the amber,
// and the cyan band ahead of the blue, which is the balance the reference
// shows. Green never trails both other channels, so it cannot form a halo.
const float GREEN_BIAS   = 0.05;
// How far the channels are allowed to separate. The reference reaches nearly
// pure red and cyan on its thin edges, so this sits close to full separation;
// what keeps it from reading as a neon outline is the width modulation below
// and the fact that green can never be left on its own.
const float CHROMA_STRENGTH = 0.95;
// Falloff of the colour onto flat plateaus. The channel offsets already
// confine colour to transitions - on a wide plateau all three sample the same
// value - so this only needs to close on genuinely flat black and white. A
// low exponent additionally dims the dark side of every edge, which is where
// the reference's colour is strongest.
const float PLATEAU_FALLOFF = 16.0;
// Width modulation along a contour, from the gradient direction: some stretches
// stay thin and sharp, others open into a soft bloom.
const float BLOOM_MIN    = 0.55;
const float BLOOM_MAX    = 1.80;

// --- critical-point rounding ----------------------------------------------
// Where the field gradient collapses - at a saddle or an extremum - two band
// boundaries meet and the contour pinches into a point, which is what reads as
// a heart notch or a V-shaped cusp. Widening the transition only in that
// neighbourhood turns the pinch into a soft rounded neck. The cubic falloff
// keeps it inert at ordinary gradients, so band count, spacing and composition
// are untouched.
const float CUSP_SCALE   = 0.25;
const float CUSP_ROUND   = 0.34;

// Transition half-width for softness=0, and the extra width at softness=1.
// The curve is quadratic so the low end stays crisp: the reference render is
// almost identical at softness 0 and 0.1, which a linear ramp cannot reproduce.
const float SOFT_MIN = 0.0035;
const float SOFT_MAX = 0.2000;

mat2 rot(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}

// ---------------------------------------------------------------------------
// Mask signed distance. Negative inside, in world units.
//
// There are exactly two sources: the built-in procedural field, which fills the
// canvas rectangle, and a user supplied SVG sampled from its distance texture.
// ---------------------------------------------------------------------------
float sdRoundedBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

float maskDistance(vec2 p, vec2 canvasHalf) {
  if (uUseImage > 0.5) {
    vec2 uv = (p * uMaskAspect * 0.5) / max(uMaskScale, 0.0001) + 0.5;
    uv.y = 1.0 - uv.y;
    // Outside the SVG's own rectangle there is nothing to draw.
    vec2 outside = max(abs(uv - 0.5) - 0.5, 0.0);
    float rectDist = length(outside);
    float encoded = texture2D(uMask, clamp(uv, 0.0, 1.0)).r;
    return (encoded * 2.0 - 1.0) + rectDist * 2.0;
  }
  // Procedural source should fully cover component bounds at any aspect ratio.
  float invScale = 1.0 / max(uScale, 0.0001);
  return sdRoundedBox(p, canvasHalf * invScale, 0.08 * invScale);
}

// ---------------------------------------------------------------------------
// Value noise, used only for the 'distortion' control.
// ---------------------------------------------------------------------------
float hash21(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
}

// ---------------------------------------------------------------------------
// The flowing scalar field whose level sets are the metal's stripes.
//
// Every time term is an integer multiple of uPhase, so the whole field is
// exactly periodic with period TAU in uPhase, i.e. the animation loops with no
// seam. A single gentle domain warp bends the level sets into long arcs; it is
// deliberately weak, because a strong warp compresses space unevenly and the
// stripes then cram in one place and smear into flat grey in another.
// ---------------------------------------------------------------------------
float liquidField(vec2 q, float ph) {
  // One low-frequency, low-amplitude warp. This is the only source of
  // curvature, so the arcs stay large-radius and free of small-scale kinks,
  // and it is the only term that moves the shape of the field.
  vec2 w = q + 0.20 * vec2(sin(q.y * 0.85 + ph), cos(q.x * 0.78 - ph));

  // Three waves of comparable gradient in three directions. Comparable
  // amplitudes keep |grad f| nearly constant, which is what makes the bands
  // repeat evenly; the differing directions produce the closed, eye-shaped
  // level sets. The constants fix where the composition sits at frame 0.
  //
  // Their phase relationship is FIXED - no per-wave time rate. Advancing the
  // waves at different rates moves the field's maxima and saddles relative to
  // each other, which creates and destroys level-set islands: that is what
  // reads as melting, pinching and collapsing blobs. Holding them still keeps
  // one nested topology for the whole loop.
  float f = 0.42 * sin(w.y * 1.55 + 1.9);
  f += 0.34 * sin(w.x * 1.35 + 0.6);
  f += 0.24 * sin((w.x + w.y) * 1.30);

  // The reveal: one global offset lifts and lowers the entire field, so every
  // nested band opens together and closes together, evenly spaced, without any
  // two of them ever meeting. sin() makes the open and close ease in and out.
  f += BREATH_GAIN * sin(ph);
  return f;
}

/**
 * One cycle of the metal tone curve.
 * 'e' is the half-width of every transition: it carries both the 'softness'
 * control and the per-pixel anti-aliasing width.
 */
float stripeTone(float phase, float e) {
  float u = fract(phase);
  float light = smoothstep(BAND_DARK_END - e, BAND_DARK_END + e, u)
              - smoothstep(BAND_LIGHT_END - e, BAND_LIGHT_END + e, u);
  float ramp = pow(smoothstep(BAND_LIGHT_END + e, 1.0 - e, u), RAMP_LIFT)
             * (1.0 - smoothstep(1.0 - e, 1.0, u));
  return clamp(light + ramp, 0.0, 1.0);
}

/** Photoshop-style colour burn, the blend the reference uses for colorTint. */
vec3 colorBurn(vec3 base, vec3 blend) {
  return 1.0 - min(vec3(1.0), (1.0 - base) / max(blend, vec3(1.0 / 255.0)));
}

void main() {
  // --- 1. canvas pixel -> world space ------------------------------------
  vec2 fragPx = vUv * uResolution;
  float fitDim = mix(min(uResolution.x, uResolution.y),
                     max(uResolution.x, uResolution.y), uFitCover);
  float pxPerWorld = fitDim * uScale * 0.5;   // device px in one world unit
  vec2 originPx = vec2(uOrigin.x, 1.0 - uOrigin.y) * uResolution;
  vec2 centred = fragPx - originPx - vec2(uOffset.x, -uOffset.y) * fitDim;
  vec2 p = (rot(-uRotation) * centred) / max(pxPerWorld, 1.0);
  // Half-extents of the canvas rectangle in world units.
  vec2 canvasHalf = uResolution / max(fitDim, 1.0);
  float pixelWorld = 1.0 / max(pxPerWorld, 1.0);   // world units in one device px

  // --- 2. mask -----------------------------------------------------------
  float sd = maskDistance(p, canvasHalf);

  // --- 3. animated field -------------------------------------------------
  vec2 pa = rot(-uAngle) * p;
  float f = liquidField(pa, uPhase);

  if (uDistortion > 0.0) {
    // The noise drift travels around a circle so it returns to its start
    // after one loop period, keeping the animation seamless.
    vec2 drift = 0.55 * vec2(cos(uPhase), sin(uPhase));
    // Low frequencies only: higher octaves read as bubbling and noisy folds
    // rather than as the reference's smooth, wide undulation.
    float n = valueNoise(pa * 1.45 + drift) * 0.75
            + valueNoise(pa * 2.90 - drift * 1.70) * 0.25;
    f += uDistortion * DISTORTION_GAIN * n;
  }

  // Two lobes of extra field measured inwards from the silhouette. The broad
  // lobe bends the stripes parallel to the edge; the narrow lobe packs a
  // steep ramp into ~0.04 world units, which renders as the polished bevel
  // highlight that traces the outline.
  float depth = max(-sd, 0.0);
  float rim = exp(-depth * RIM_FALLOFF);
  if (uContour > 0.0) {
    f += uContour * (CONTOUR_GAIN * exp(-depth * CONTOUR_FALLOFF) + RIM_GAIN * rim);
  }

  // --- 4. stripes + per-channel dispersion -------------------------------
  float phase = f * uRepetition * FIELD_GAIN;

  // Rate of change of the stripe phase, per device pixel and per world unit.
  vec2 dPhase = vec2(dFdx(phase), dFdy(phase));
  float phasePerPixel = length(dPhase);
  float phasePerWorld = phasePerPixel * pxPerWorld;

  // Transition half-width: the 'softness' control, never thinner than a pixel.
  float e = max(SOFT_MIN + SOFT_MAX * uSoftness * uSoftness, phasePerPixel * 0.80);

  // Round off the pinch at critical points (see CUSP_SCALE above). The clamp
  // matters: at an extremum the gradient goes to zero and the derivative-based
  // measure gets noisy, so an uncapped width speckles the flat highlights.
  float calm = CUSP_SCALE / (CUSP_SCALE + phasePerWorld);
  e = min(e + CUSP_ROUND * calm * calm * calm, 0.14);

  // Direction the stripe phase climbs, in screen space. Along a curving contour
  // this rotates smoothly, so using it as a modulator makes the edge alternate
  // between thin sharp stretches and wide soft ones instead of drawing one
  // constant-width outline.
  vec2 gradDir = dPhase / max(phasePerPixel, 1.0e-6);
  float axial = abs(gradDir.x * 0.80 + gradDir.y * 0.60);
  float bloom = mix(BLOOM_MIN, BLOOM_MAX, axial);

  // Dispersion offset, in stripe-phase units. The bevel refracts a little more,
  // and a softer reveal carries a correspondingly softer, wider fringe.
  float disperse = (DISP_PHASE + phasePerWorld * DISP_WORLD)
                 * bloom
                 * (1.0 + RIM_REFRACTION * rim * uContour)
                 * (1.0 + e * 2.0);

  // Channel offsets. Red leads, green follows close behind it, blue trails, so
  // an edge reads red -> amber -> white -> cyan -> blue. No offset combination
  // leaves green alone, which is what would show as a green halo.
  float dR = disperse * uShiftRed;
  float dB = disperse * uShiftBlue;
  float lum = stripeTone(phase, e);
  vec3 tone = vec3(stripeTone(phase - dR, e),
                   stripeTone(phase - dR * GREEN_BIAS, e),
                   stripeTone(phase + dB, e));

  // Confine colour to the transition. On a flat black, silver or white plateau
  // this falls to zero, so the metal body stays neutral and nothing bleeds.
  float activity = 1.0 - pow(abs(2.0 * lum - 1.0), PLATEAU_FALLOFF);

  // Pull the channels back toward the neutral tone. Fully separated channels
  // read as a saturated RGB outline; a partial mix reads as lens dispersion.
  tone = mix(vec3(lum), tone, CHROMA_STRENGTH * activity);

  // --- 5. colour ---------------------------------------------------------
  vec3 metal = metalRamp(tone);
  metal = colorBurn(metal, uColorTint);

  // max() keeps the edge anti-aliased even on the no-derivatives fallback path.
  float aa = max(fwidth(sd), pixelWorld) * 0.5;
  float coverage = 1.0 - smoothstep(-aa, aa, sd);

  float outAlpha = (uUseImage > 0.5) ? coverage : 1.0;
  vec3 outRgb = mix(uColorBack, metal, coverage);
  fragColor = vec4(outRgb, outAlpha);
}
`;
