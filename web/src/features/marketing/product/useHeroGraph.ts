import { type RefObject, useEffect } from 'react';

/**
 * Port of the old hero graph ("Compute -> receipts -> payout" SVG, Framer code component in runtime/fvDT3...mjs).
 * Every cycle three random left lines each send a comet (head r8 + 8 trailing dots) towards the centre card, the arrow
 * pulses, then three comets run from the card to the right-hand result cards. Constants are the original ones.
 * Runs while 45% of the graph is in view, not in reduced motion, and the tab is visible.
 */
const SAMPLES = 96;
const SPEED_PX_PER_MS = 0.16;
const COMETS = Array.from({ length: 9 }, (_, i) => (i === 0 ? { off: 0 } : { off: (i - 1) * 3 }));

type Geo = { L: number; xs: Float32Array; ys: Float32Array };
const geo = (p: SVGPathElement | null): Geo => {
  const L = p ? p.getTotalLength() : 1;
  const xs = new Float32Array(SAMPLES + 1);
  const ys = new Float32Array(SAMPLES + 1);
  if (p)
    for (let i = 0; i <= SAMPLES; i++) {
      const pt = p.getPointAtLength((L * i) / SAMPLES);
      xs[i] = pt.x;
      ys[i] = pt.y;
    }
  return { L, xs, ys };
};
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const shuffle3 = (n: number) => {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j] as number, a[i] as number];
  }
  return a.slice(0, 3);
};

function mount(svg: SVGSVGElement) {
  const groups = [...svg.querySelectorAll('g')].filter((g) => g.children.length === 9 && [...g.children].every((c) => c.tagName === 'circle'));
  const leftPaths = [...svg.querySelectorAll<SVGPathElement>(':scope > g[mask] > path')];
  const rightPaths = [...svg.querySelectorAll<SVGPathElement>(':scope > g[opacity="0.5"] > path')];
  const arrow = svg.querySelector<SVGGElement>('g[transform="translate(349 84)"] > g');
  const nl = leftPaths.length;
  if (groups.length < nl + rightPaths.length || !nl) return () => {};
  const left = groups.slice(0, nl);
  const right = groups.slice(nl, nl + rightPaths.length);
  const lg = leftPaths.map(geo);
  const rg = rightPaths.map(geo);
  const cache = new Map<Element, number>();
  const setOp = (e: Element | null, v: number) => {
    if (!e) return;
    const r = Math.round(v * 200) / 200;
    if (cache.get(e) !== r) {
      cache.set(e, r);
      (e as SVGElement | HTMLElement).style.opacity = String(r);
    }
  };
  const place = (g: Element, c: Geo, dist: number, op: number) => {
    const dots = [...g.children];
    // DOM order of the circles is [head, then the tail from the farthest dot back to the nearest]: comet k is child 9 - k (head: child 0)
    for (let k = 0; k < COMETS.length; k++) {
      const dot = dots[k === 0 ? 0 : 9 - k];
      if (!dot) continue;
      const a = (Math.max(0, dist - (COMETS[k] as { off: number }).off) / c.L) * SAMPLES;
      const i = a >= SAMPLES ? SAMPLES - 1 : a | 0;
      const f = a - i;
      dot.setAttribute('cx', ((c.xs[i] as number) + ((c.xs[i + 1] as number) - (c.xs[i] as number)) * f).toFixed(1));
      dot.setAttribute('cy', ((c.ys[i] as number) + ((c.ys[i + 1] as number) - (c.ys[i] as number)) * f).toFixed(1));
    }
    g.setAttribute('opacity', op.toFixed(2));
  };
  for (const g of [...left, ...right]) g.setAttribute('opacity', '0');

  let raf = 0;
  let start = performance.now() + 300;
  let active = false;
  let pick: number[] = [];
  let offs: number[] = [];
  let durs: number[] = [];
  let tEnd = 0;
  let tRight = 0;
  let tDone = 0;
  let tLoop = 0;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const p = now - start;
    if (p >= 0 && !active) {
      active = true;
      pick = shuffle3(nl);
      offs = pick.map((_, i) => i * 140);
      durs = pick.map((e) => (lg[e] as Geo).L / SPEED_PX_PER_MS);
      tEnd = Math.max(...pick.map((_, i) => (offs[i] as number) + (durs[i] as number)));
      tRight = tEnd + 500;
      tDone = tRight + 900;
      tLoop = tDone + 300 + 600 + Math.random() * 700;
      for (const g of [...left, ...right]) g.setAttribute('opacity', '0');
    }
    let y = 1;
    if (active && p >= tEnd && p < tRight) y = 1 - 0.55 * (1 - Math.abs(2 * ((p - tEnd) / 500) - 1));
    setOp(arrow, y);
    if (!active) return;
    pick.forEach((e, n) => {
      const r = p - (offs[n] as number);
      if (r < 0) return;
      const d = durs[n] as number;
      let a = clamp01(r / 160);
      if (r >= d) a = 1 - clamp01((r - d) / 300);
      const c = lg[e] as Geo;
      place(left[e] as Element, c, c.L * clamp01(r / d), a);
    });
    const c2 = p - tRight;
    if (c2 >= 0) {
      const e = clamp01(c2 / 900);
      let t = clamp01(c2 / 120);
      if (c2 >= 900) t = 1 - clamp01((c2 - 900) / 300);
      for (let r = 0; r < right.length; r++) place(right[r] as Element, rg[r] as Geo, (rg[r] as Geo).L * e, t);
    }
    if (p > tLoop) {
      active = false;
      start = now;
    }
  };
  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    for (const g of [...left, ...right]) g.setAttribute('opacity', '0');
    if (arrow) arrow.style.opacity = '';
    cache.clear();
    active = false;
  };
  const go = () => {
    if (!raf && !document.hidden) {
      start = performance.now() + 300;
      raf = requestAnimationFrame(frame);
    }
  };
  const io = new IntersectionObserver((es) => (es.some((e) => e.isIntersecting) ? go() : stop()), { threshold: 0.45 });
  io.observe(svg.parentElement ?? svg);
  const vis = () => (document.hidden ? stop() : undefined);
  document.addEventListener('visibilitychange', vis);
  return () => {
    io.disconnect();
    document.removeEventListener('visibilitychange', vis);
    stop();
  };
}

export function useHeroGraph(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const offs = [...el.querySelectorAll<SVGSVGElement>('svg')].filter((s) => s.querySelector('radialGradient#cometHead')).map(mount);
    return () => {
      for (const o of offs) o();
    };
  }, [root]);
}
