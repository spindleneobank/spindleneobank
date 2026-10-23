import { spring } from 'motion';

/**
 * Framer page-load appear animations (`__framer__appearAnimationsContent`), replayed the way the old runtime's
 * `startOptimizedAppearAnimation` does: a 10 s hold at the initial value, then WAAPI keyframes sampled every 10 ms from
 * the recorded spring (bounce 0, duration .6, delay .2), `linear`, fill both: opacity .001 -> 1 and transform none.
 * The SSR markup is the final state; skipped with reduced motion.
 */
const INITIAL = 0.001;
const SAMPLES = 61;
export function runAppear(root: HTMLElement) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};
  const gen = spring({ keyframes: [0, 1], duration: 600, bounce: 0 });
  const opacity = Array.from({ length: SAMPLES }, (_, i) =>
    i === SAMPLES - 1 ? 1 : INITIAL + (1 - INITIAL) * gen.next(i * 10).value,
  );
  const anims: Animation[] = [];
  for (const el of root.querySelectorAll<HTMLElement>('[data-framer-appear-id]')) {
    const hold = el.animate(
      { opacity: [INITIAL, INITIAL] },
      { duration: 10000, easing: 'linear', fill: 'both' },
    );
    const run = el.animate(
      { opacity, transform: opacity.map(() => 'none') },
      { delay: 200, duration: 600, easing: 'linear', fill: 'both' },
    );
    run.finished.then(
      () => hold.cancel(),
      () => {},
    );
    anims.push(hold, run);
  }
  return () => {
    for (const a of anims) a.cancel();
  };
}

/**
 * Old Framer "Border" component (dashed lines): the SVG wrapper mounts at opacity 0 and, once its size is measured,
 * fades to 1 with `transition: opacity .4s cubic-bezier(.4,0,.2,1)` (inline in the markup).
 */
export function runBorderFade(root: HTMLElement) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};
  const els = [
    ...root.querySelectorAll<HTMLElement>('div[style*="transition: opacity"], div[data-p5-tr]'),
  ].filter((e) => e.querySelector(':scope > svg path[stroke-dasharray]'));
  const saved = els.map((e) => e.dataset.p5Tr ?? e.style.transition);
  els.forEach((e, i) => {
    e.dataset.p5Tr = saved[i] as string;
    e.style.transition = 'none';
    e.style.opacity = '0';
  });
  const raf = requestAnimationFrame(() => {
    void root.offsetHeight;
    for (const e of els) {
      e.style.transition = e.dataset.p5Tr ?? '';
      e.style.opacity = '1';
    }
  });
  return () => cancelAnimationFrame(raf);
}

/**
 * The old site's NumberFlow counters (`<number-flow-react>`) keep their digits in a shadow root that is not part of the
 * serialized markup; the shadow content is stored in `data-p5-shadow` and attached here (static digits, as in the old
 * page where the values never change after load).
 */
export function attachNumberShadows(root: HTMLElement) {
  for (const el of root.querySelectorAll<HTMLElement>('[data-p5-shadow]')) {
    if (el.shadowRoot) continue;
    el.attachShadow({ mode: 'open' }).innerHTML = el.dataset.p5Shadow ?? '';
  }
  return () => {};
}
