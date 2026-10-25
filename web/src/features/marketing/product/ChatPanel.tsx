import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { type PNode, renderNode } from './render';

/**
 * Old "Inspect receipt" chat: a Framer variant component that walks through 7 states on timers
 * (1 Typing, 2a Sent, 2 Thinking, 3 Answered, 3b Typing Follow-up, 4a Follow-up Sent, 4 Follow-up) and stops on the last.
 *
 * Measured on the old page (docs/testing/web/P10/product-shared):
 * - The sequence starts when the component mounts (hydration), not when it scrolls into view: with the page loaded and
 *   never scrolled it reaches "4 Follow-up" about 8 s later and does not replay on re-entry. The delays are the Framer
 *   `delay()` values of the component (FlutedSwirl.mjs `rt`): 2000, 850, 1200, 800, 800, 1200 ms, each step taking about
 *   65 ms more (re-render and commit).
 * - Rows slide into place with a layout animation (tween 0.3 s, cubic-bezier(.44,0,.56,1)); appearing rows fade in at
 *   the same time; the other rows move by the height that was added.
 * - Characters of the typed text appear 50 ms apart (opacity .001 -> 1, 10 ms), the first after 300 ms in the initial
 *   state and ~175 ms after the commit in the follow-up state (measured: char c visible at 175 + 50 c ms), and are hidden
 *   in the server HTML (the old SSR has them at opacity .001), so the finished sentence never flashes before it is typed.
 * - The infinite loops (status dot, typing dots) run only while the dot is in the viewport and start from their base
 *   values when it first enters it (`__framer__loopPauseOffscreen`).
 *
 * Performance: a forced style recalc (getComputedStyle, layout reads after a write) costs 300-1000 ms on this page, so
 * every state switch reads layout once before the swap and once after it, and never interleaves reads with writes.
 */
const DELAYS = [2000, 850, 1200, 800, 800, 1200];
/** The old page's steps take their Framer delay plus about 65 ms (re-render and commit of the variant), measured. */
const STEP_OVERHEAD_MS = 65;
const AT = DELAYS.map(
  (_, k) => DELAYS.slice(0, k + 1).reduce((a, b) => a + b, 0) + STEP_OVERHEAD_MS * (k + 1),
);
const EASE = 'cubic-bezier(0.44, 0, 0.56, 1)';
const LOOP_EASE = 'cubic-bezier(0.42, 0, 0.58, 1)';
const ROWS = ['User Message Row', 'Assistant Response Row', 'User Follow-up Row', 'Typing Indicator Row'];
const CHARS =
  '[data-framer-name="Typed Question"] span > span, [data-framer-name="Typed Follow-up"] span > span';

type Snap = { o: string; t: string };
type Boxes = Map<string, { el: HTMLElement; top: number; o: string }>;

/** Visible (laid out) rows of the thread keyed by name + occurrence. */
function boxes(root: HTMLElement): Boxes {
  const out: Boxes = new Map();
  const seen = new Map<string, number>();
  for (const el of root.querySelectorAll<HTMLElement>('[data-framer-name]')) {
    const name = el.dataset.framerName as string;
    if (!ROWS.includes(name) || !el.getClientRects().length) continue;
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    out.set(`${name}#${n}`, { el, top: el.getBoundingClientRect().top, o: el.style.opacity });
  }
  return out;
}

const STATUS_DOT = '.framer-1f2j1ga';
/** Typing dots: loop opacity base -> base * .35, y 0 -> -4, scale 1 -> .85, tween .45 s mirror, delays 0 / .15 / .3 s. */
const DOTS = [
  { sel: '.framer-1oiadln', delay: 0, base: 0.1681 },
  { sel: '.framer-1h3lpfq', delay: 150, base: 0.096 },
  { sel: '.framer-c960ix', delay: 300, base: 0.096 },
];

export function ChatPanel({
  states,
  override,
}: {
  states: PNode[];
  override?: Parameters<typeof renderNode>[3];
}): ReactNode {
  const last = states.length - 1;
  // SSR and the first client render show the first state, like the old page; reduced motion jumps to the last one.
  const [i, setI] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const prev = useRef(new Map<Element, Snap>());
  const before = useRef<Boxes | null>(null);
  const motion = useRef<boolean | null>(null);
  // mount time: every switch is scheduled against it, so a slow commit or a janky frame does not push the later steps
  const mountAt = useRef(0);
  const loops = useRef(new WeakMap<Element, Animation>());
  const io = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    if (motion.current === false) {
      setI(last);
      return;
    }
    mountAt.current = performance.now();
  }, [last]);

  useEffect(() => {
    if (!motion.current || i >= last) return;
    const wait = Math.max(0, mountAt.current + (AT[i] ?? 0) - performance.now());
    const t = setTimeout(() => {
      if (box.current) before.current = boxes(box.current);
      setI(i + 1);
    }, wait);
    return () => clearTimeout(t);
  }, [i, last]);

  useLayoutEffect(() => {
    const root = box.current;
    if (!root) return;
    if (motion.current === null) motion.current = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    const live = motion.current;
    root.dataset.live = '1';

    // ---- reads: row positions after the swap, snapshots of inline styles, visible typed characters
    // Rows are matched by name (the swap may replace their nodes): they slide by the distance their top moved and fade
    // from the old inline opacity to the new one (an appearing row starts collapsed at the bottom edge of the thread).
    const rowFlips = new Map<HTMLElement, [Keyframe, Keyframe]>();
    if (before.current) {
      for (const [k, cur] of boxes(root)) {
        const old = before.current.get(k);
        if (!old) continue;
        const dy = old.top - cur.top;
        const o = cur.el.style.opacity || '1';
        if (Math.abs(dy) > 0.5 || (old.o || '1') !== o)
          rowFlips.set(cur.el, [
            { opacity: old.o || 1, transform: Math.abs(dy) > 0.5 ? `translateY(${dy}px)` : 'none' },
            { opacity: o, transform: 'none' },
          ]);
      }
      before.current = null;
    }
    const allChars = new Set(root.querySelectorAll<HTMLElement>(CHARS));
    const chars = live ? [...allChars].filter((c) => c.getClientRects().length) : [];
    const seen = new Map<Element | null, number>();
    const charIdx = chars.map((c) => {
      const host = c.closest('p');
      const n = seen.get(host) ?? 0;
      seen.set(host, n + 1);
      return n;
    });
    const now = new Map<Element, Snap>();
    const flips: [HTMLElement, Keyframe, Keyframe][] = [];
    for (const el of root.querySelectorAll<HTMLElement>('*')) {
      const s = { o: el.style.opacity, t: el.style.transform };
      now.set(el, s);
      if (!live || loops.current.has(el) || allChars.has(el)) continue;
      const p = prev.current.get(el);
      if (p && (p.o !== s.o || p.t !== s.t) && !rowFlips.has(el))
        flips.push([
          el,
          { opacity: p.o || 1, transform: p.t || 'none' },
          { opacity: s.o || 1, transform: s.t || 'none' },
        ]);
    }
    prev.current = now;

    // ---- writes
    for (const [el, from, to] of flips) el.animate([from, to], { duration: 300, easing: EASE });
    for (const [el, kf] of rowFlips) el.animate(kf, { duration: 300, easing: EASE });
    chars.forEach((c, k) => {
      c.animate([{ opacity: 0.001 }, { opacity: 1 }], {
        duration: 10,
        delay: (i === 0 ? 300 : 175) + (charIdx[k] ?? 0) * 50,
        easing: EASE,
        fill: 'backwards',
      });
    });
    if (!live) return;

    // loops (paused while offscreen); every node gets its animation once, later states reuse the nodes React keeps
    if (!io.current) {
      io.current = new IntersectionObserver((es) => {
        for (const e of es) {
          const a = loops.current.get(e.target);
          if (!a) continue;
          if (e.isIntersecting) a.play();
          else a.pause();
        }
      });
    }
    const add = (el: HTMLElement, a: Animation) => {
      a.pause();
      loops.current.set(el, a);
      io.current?.observe(el);
    };
    const loop = { iterations: Number.POSITIVE_INFINITY, direction: 'alternate', easing: LOOP_EASE } as const;
    for (const el of root.querySelectorAll<HTMLElement>(STATUS_DOT)) {
      if (loops.current.has(el)) continue;
      add(
        el,
        el.animate(
          [
            { opacity: 1, transform: 'rotate(0deg)' },
            { opacity: 0.3, transform: 'rotate(360deg)' },
          ],
          { ...loop, duration: 800 },
        ),
      );
    }
    for (const d of DOTS)
      for (const el of root.querySelectorAll<HTMLElement>(d.sel)) {
        if (loops.current.has(el)) continue;
        add(
          el,
          el.animate(
            [
              { opacity: d.base, transform: 'translateY(0) scale(1)' },
              { opacity: d.base * 0.35, transform: 'translateY(-4px) scale(0.85)' },
            ],
            { ...loop, duration: 450, delay: d.delay, fill: 'backwards' },
          ),
        );
      }
  }, [i]);

  useEffect(
    () => () => {
      io.current?.disconnect();
      io.current = null;
    },
    [],
  );

  return (
    <div ref={box} data-pp-chat-box="" style={{ display: 'contents' }}>
      {renderNode(states[i] as PNode, 's', 'chat', override)}
    </div>
  );
}
