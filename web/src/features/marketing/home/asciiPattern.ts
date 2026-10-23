/**
 * Port of the Framer "Animated Pattern Background" (runtime/Vl_67...mjs), ASCII style only, with the settings of the old
 * home page instance (Evidence section, left half): pattern 3, binary glyphs, scale 1.1, frequency 10/20, centre speeds
 * 30/35, colour rgba(233, 214, 223, 0.24), Geist 12px, tick every 0.2s while in view. The canvas is also filtered by the
 * page CSS (flower palette), as in the old page.
 */
const SETTINGS = {
  mode: 2, // mn["3"]
  frequencyA: 10 / 100,
  frequencyB: 20 / 100,
  centerASpeed: 30 / 50,
  centerBSpeed: 35 / 50,
  characters: ' 01',
  scale: 1.1,
  color: 'rgba(233, 214, 223, 0.24)',
  fontFamily: '"Geist", "Geist Placeholder", sans-serif',
  fontSize: 12,
  fontWeight: 400,
  lineHeight: 1,
  letterSpacing: 0,
  interval: 0.2,
};

const mapRange = (e: number, t: number, n: number, r: number, i: number) => ((e - t) / (n - t)) * (i - r) + r;
const dist = (a: number[], b: number[]) =>
  Math.hypot((b[0] as number) - (a[0] as number), (b[1] as number) - (a[1] as number));
/** easing(-1): e => 1 - (1 - clamp(e)) ** 3 */
const smooth = (e: number) => 1 - (1 - Math.max(0, Math.min(1, e))) ** 3;

/** Width/height ratio of a "W" as the original measured it (its numeric font size is ignored by the browser). */
function charRatio(): number {
  const t = document.createElement('div');
  t.style.position = 'absolute';
  t.style.visibility = 'hidden';
  t.style.whiteSpace = 'nowrap';
  t.style.fontFamily = SETTINGS.fontFamily;
  t.style.fontWeight = String(SETTINGS.fontWeight);
  t.style.lineHeight = String(SETTINGS.lineHeight);
  t.style.letterSpacing = String(SETTINGS.letterSpacing);
  t.textContent = 'W';
  document.body.appendChild(t);
  const ratio = t.offsetWidth / t.offsetHeight;
  document.body.removeChild(t);
  return ratio;
}

export function mountAsciiPattern(canvas: HTMLCanvasElement): () => void {
  const box = canvas.parentElement;
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!box || !ctx) return () => {};
  const t0 = performance.now();
  let time = 0;
  let drawn = -1;
  let raf = 0;
  let timer: number | undefined;
  const S = SETTINGS;

  const draw = (n: number) => {
    const b = canvas.width;
    const x = canvas.height;
    const dpr = window.devicePixelRatio || 1;
    const aspect = b / x;
    ctx.clearRect(0, 0, b, x);
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillStyle = S.color;
    const N = S.fontSize * S.scale * dpr;
    ctx.font = `${S.fontWeight} ${N}px ${S.fontFamily}`;
    ctx.imageSmoothingEnabled = false;
    const cellH = N * S.lineHeight;
    const cellW = cellH * charRatio();
    const L = Math.min(b, x);
    const R = mapRange(Math.cos(n * S.frequencyA), -1, 1, 6, 60);
    const Z = mapRange(Math.cos(n * S.frequencyB), -1, 1, 6, 60);
    const cA = [Math.cos(n * 3 * S.centerASpeed) * 0.5, Math.sin(n * 7 * S.centerASpeed) * 0.5];
    const cB = [Math.cos(n * 5 * S.centerBSpeed) * 0.5, Math.sin(n * 4 * S.centerBSpeed) * 0.5];
    for (let y = 0; y < x; y += cellH)
      for (let r = 0; r < b; r += cellW) {
        const px = [Math.floor(r), Math.floor(y)] as number[];
        const o = [(2 * ((px[0] as number) - b / 2)) / L, (2 * ((px[1] as number) - x / 2)) / L];
        (o as number[])[0] = (o[0] as number) * aspect;
        const f =
          S.mode % 2 === 0
            ? Math.atan2((cA[1] as number) - (o[1] as number), (cA[0] as number) - (o[0] as number))
            : dist(o, cA);
        const p =
          S.mode === 0
            ? Math.atan2((cB[1] as number) - (o[1] as number), (cB[0] as number) - (o[0] as number))
            : dist(o, cB);
        const v = smooth((Math.cos(f * R) * Math.cos(p * Z) + 1) / 2);
        ctx.fillText(
          S.characters.charAt(Math.floor(v * S.characters.length)),
          px[0] as number,
          px[1] as number,
        );
      }
  };
  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    draw(time);
    drawn = time;
  };
  const loop = () => {
    if (drawn !== time) {
      draw(time);
      drawn = time;
    }
    raf = requestAnimationFrame(loop);
  };
  const tick = () => {
    time = (performance.now() - t0) * 0.1 * 1e-4;
  };
  const stop = () => {
    clearInterval(timer);
    timer = undefined;
    cancelAnimationFrame(raf);
    raf = 0;
  };
  const io = new IntersectionObserver((e) => {
    stop();
    if (e[0]?.isIntersecting === true && !document.hidden) {
      raf = requestAnimationFrame(loop);
      tick();
      timer = window.setInterval(tick, S.interval * 1000);
    }
  });
  const ro = new ResizeObserver(resize);
  ro.observe(box);
  io.observe(box);
  const vis = () => {
    if (document.hidden) stop();
  };
  document.addEventListener('visibilitychange', vis);
  resize();
  return () => {
    stop();
    io.disconnect();
    ro.disconnect();
    document.removeEventListener('visibilitychange', vis);
  };
}
