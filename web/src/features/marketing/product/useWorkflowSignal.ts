import { type RefObject, useEffect } from 'react';

/**
 * Port of the old "workflow" overlay (Framer code component in runtime/FlutedSwirl.mjs, `Bo`): up to six signals travel
 * trigger -> action -> approve|review -> complete along the measured paths (84% approve / 16% review), with a comet
 * streak, a halo and a percentage pill at the end. Constants and easing are the original ones.
 */
const STAGE_AT = [0, 1280, 3680, 6080];
const LIFE = 6720;
const START_OFFSETS = [3400, 2300, 1200];
const GAP_MIN = 1360;
const GAP_MAX = 2160;
const SLOTS = 6;
const STREAKS = 10;
const STREAK_STEP = 5;
const RED = '#FF596B';
const APPROVE_INK = '#111111';
const STAGE1_INK = '#4a4a4a';

const ease = (e: number) => {
  const t = e < 0.5 ? 2 * e * e : 1 - (-2 * e + 2) ** 2 / 2;
  return e * 0.4 + t * 0.6;
};
const cl = (v: number) => Math.min(1, Math.max(0, v));
const gap = () => GAP_MIN + Math.random() * (GAP_MAX - GAP_MIN);

type Slot = {
  dot: SVGGElement;
  halo: SVGCircleElement;
  square: SVGGElement;
  core: SVGCircleElement;
  pill: SVGGElement;
  pillRect: SVGRectElement;
  pillText: SVGTextElement;
  streaks: SVGPathElement[];
};

function mount(svg: SVGSVGElement) {
  // breakpoint variants render hidden siblings: only the displayed ones belong to this layout
  const shown = (e: Element) => getComputedStyle(e).display !== 'none';
  const paths = [...svg.querySelectorAll<SVGPathElement>(':scope > path')].filter(shown);
  const slotGroups = [...svg.querySelectorAll<SVGGElement>(':scope > g')].filter((g) => g.querySelectorAll(':scope > path').length >= STREAKS && g.querySelector(':scope > g > g > circle') && g.querySelector(':scope > g > g > text'));
  if (paths.length < 5 || slotGroups.length < SLOTS) return () => {};
  const [p1, p2, p2r, p3, p3r] = paths as [SVGPathElement, SVGPathElement, SVGPathElement, SVGPathElement, SVGPathElement];
  const slots: Slot[] = slotGroups.slice(-SLOTS).map((g) => {
    const sp = [...g.querySelectorAll<SVGPathElement>(':scope > path')];
    const dot = g.querySelector(':scope > g') as SVGGElement;
    const gs = [...dot.children].filter((c) => c.tagName === 'g') as SVGGElement[];
    const square = gs[0] as SVGGElement;
    const pill = gs[1] as SVGGElement;
    return {
      dot,
      // the halo circle has one sibling per breakpoint variant: take the displayed one
      halo: ([...dot.children].filter((c) => c.tagName === 'circle' && shown(c))[0] ?? dot.children[0]) as SVGCircleElement,
      square,
      core: square.querySelector('circle') as SVGCircleElement,
      pill,
      pillRect: pill.querySelector('rect') as SVGRectElement,
      pillText: pill.querySelector('text') as SVGTextElement,
      // DOM order is streak STREAKS-1 first: streak index e is child STREAKS-1-e
      streaks: Array.from({ length: STREAKS }, (_, e) => sp[STREAKS - 1 - e] as SVGPathElement),
    };
  });
  const coreFill = slots[0]?.core.getAttribute('fill') ?? '';
  const lengths = new Map<SVGPathElement, number>();
  const len = (p: SVGPathElement) => {
    let l = lengths.get(p);
    if (l === undefined) {
      l = p.getTotalLength();
      lengths.set(p, l);
    }
    return l;
  };
  const clearStreaks = (s: Slot) => {
    for (const e of s.streaks) {
      e.style.opacity = '0';
      e.setAttribute('d', '');
    }
  };
  const hide = (s: Slot) => {
    s.dot.style.opacity = '0';
    clearStreaks(s);
  };
  const place = (s: Slot, p: SVGPathElement, t: number, scale: number) => {
    const l = len(p);
    if (!Number.isFinite(l) || l <= 0) {
      s.dot.style.opacity = '0';
      return;
    }
    const pt = p.getPointAtLength(cl(t) * l);
    s.dot.setAttribute('transform', `translate(${pt.x} ${pt.y}) scale(${scale})`);
  };
  const trail = (s: Slot, p: SVGPathElement, t: number, ink: string, fade: number) => {
    const l = len(p);
    if (!Number.isFinite(l) || l <= 0) {
      clearStreaks(s);
      return;
    }
    const head = cl(t) * l;
    s.streaks.forEach((el, n) => {
      const to = head - n * STREAK_STEP;
      const from = to - STREAK_STEP;
      if (to <= 0) {
        el.style.opacity = '0';
        el.setAttribute('d', '');
        return;
      }
      const a = Math.max(0, from);
      const b = Math.min(l, to);
      let d = '';
      if (b > a) for (let i = 0; i <= 3; i++) {
        const pt = p.getPointAtLength(a + ((b - a) * i) / 3);
        d += i === 0 ? `M ${pt.x} ${pt.y}` : ` L ${pt.x} ${pt.y}`;
      }
      el.setAttribute('d', d);
      el.style.stroke = ink;
      el.style.opacity = `${Math.max(0, (1 - n / STREAKS) * 0.85 * fade)}`;
    });
  };
  for (const p of paths) p.style.opacity = '1';

  type Live = { startAt: number; branch: 'approve' | 'review' } | null;
  const live: Live[] = slots.map(() => null);
  let raf = 0;
  let began = false;
  let nextAt = 0;
  const spawn = (now: number, ago: number) => {
    const i = live.findIndex((x) => x === null);
    if (i === -1) return false;
    const branch = Math.random() < 0.84 ? 'approve' : 'review';
    live[i] = { startAt: now - ago, branch };
    const txt = branch === 'approve' ? '84%' : '16%';
    const s = slots[i] as Slot;
    if (s.pillText.textContent !== txt) s.pillText.textContent = txt;
    return true;
  };
  const frame = (now: number) => {
    if (!began) {
      began = true;
      for (const o of START_OFFSETS) spawn(now, o);
      nextAt = now;
    }
    if (now >= nextAt && spawn(now, 0)) nextAt = now + gap();
    slots.forEach((s, c) => {
      const l = live[c];
      if (!l) return;
      const h = now - l.startAt;
      if (h >= LIFE) {
        live[c] = null;
        hide(s);
        return;
      }
      const approve = l.branch === 'approve';
      const second = approve ? p2 : p2r;
      const third = approve ? p3 : p3r;
      let stage: number;
      let path: SVGPathElement;
      let prog: number;
      if (h < (STAGE_AT[1] as number)) {
        stage = 1;
        path = p1;
        prog = h / ((STAGE_AT[1] as number) - (STAGE_AT[0] as number));
      } else if (h < (STAGE_AT[2] as number)) {
        stage = 2;
        path = second;
        prog = (h - (STAGE_AT[1] as number)) / ((STAGE_AT[2] as number) - (STAGE_AT[1] as number));
      } else if (h < (STAGE_AT[3] as number)) {
        stage = 3;
        path = third;
        prog = (h - (STAGE_AT[2] as number)) / ((STAGE_AT[3] as number) - (STAGE_AT[2] as number));
      } else {
        stage = 3;
        path = third;
        prog = 1;
      }
      const e = ease(prog);
      const ink = stage === 1 ? STAGE1_INK : stage === 2 ? RED : approve ? APPROVE_INK : RED;
      const tail = h > (STAGE_AT[3] as number) ? 1 - (h - (STAGE_AT[3] as number)) / (LIFE - (STAGE_AT[3] as number)) : 1;
      const pulse = 1 + 0.1 * Math.sin(now / 110 + c * 1.7);
      const out = (v: number) => 1 - (1 - cl(v)) ** 3;
      const scale = stage < 3 ? Math.min(out(prog / 0.25), 1 - cl((prog - 0.75) / 0.25) ** 3) : (0.4 + 0.6 * out((h - (STAGE_AT[2] as number)) / 480)) * tail * pulse;
      if (s.dot.style.opacity !== '1') s.dot.style.opacity = '1';
      place(s, path, e, scale);
      const sq = stage < 3 ? 'block' : 'none';
      const pl = stage === 3 ? 'block' : 'none';
      if (s.square.style.display !== sq) s.square.style.display = sq;
      if (s.pill.style.display !== pl) s.pill.style.display = pl;
      if (coreFill && s.core.getAttribute('fill') !== coreFill) s.core.setAttribute('fill', coreFill);
      if (s.pillRect.getAttribute('fill') !== ink) s.pillRect.setAttribute('fill', ink);
      if (stage < 3) {
        if (s.halo.style.opacity !== '0') s.halo.style.opacity = '0';
        clearStreaks(s);
      } else {
        if (s.halo.style.color !== ink) s.halo.style.color = ink;
        s.halo.style.opacity = `${0.55 + 0.25 * Math.sin(now / 180 + c)}`;
        trail(s, path, e, ink, Math.max(0, tail));
      }
    });
    raf = requestAnimationFrame(frame);
  };
  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    began = false;
    live.fill(null);
    for (const s of slots) hide(s);
  };
  const go = () => {
    if (!raf && !document.hidden) raf = requestAnimationFrame(frame);
  };
  const host = svg.parentElement ?? svg;
  const io = new IntersectionObserver((es) => (es.some((x) => x.isIntersecting) ? go() : stop()), { threshold: 0.2 });
  io.observe(host);
  const vis = () => (document.hidden ? stop() : undefined);
  document.addEventListener('visibilitychange', vis);
  for (const s of slots) hide(s);
  return () => {
    io.disconnect();
    document.removeEventListener('visibilitychange', vis);
    stop();
  };
}

export function useWorkflowSignal(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let offs: (() => void)[] = [];
    const setup = () => {
      for (const o of offs) o();
      offs = [...el.querySelectorAll<SVGSVGElement>('svg[data-workflow-overlay]')].filter((s) => getComputedStyle(s).display !== 'none' && s.getClientRects().length > 0).map((s) => {
        return mount(s);
      });
    };
    setup();
    // the displayed variant changes with the breakpoint
    const mqs = [matchMedia('(min-width: 810px)'), matchMedia('(min-width: 1200px)')];
    for (const m of mqs) m.addEventListener('change', setup);
    return () => {
      for (const m of mqs) m.removeEventListener('change', setup);
      for (const o of offs) o();
    };
  }, [root]);
}
