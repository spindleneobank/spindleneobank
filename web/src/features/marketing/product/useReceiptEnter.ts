import { animate } from 'motion/react';
import { type RefObject, useEffect } from 'react';

/**
 * "Receipt verified for the epoch" card: Framer scroll "appear once" effects, values from the old runtime module
 * (FlutedSwirl.mjs, card component):
 * - card: opacity 0, scale .97, y 16 -> rest, spring bounce .12 / .7s, threshold .2
 * - title (framer-16v5wt9): opacity 0, y 6 -> rest, tween .45s ease [.22,1,.36,1] after .15s, threshold .5
 * - rows (framer-1yavpk, framer-7oa5rc): opacity 0, x -12 -> rest, tween .5s, same ease, after .3s / .45s, threshold .5
 */
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
type Tween = { sel: string; from: string; ms: number; delay: number; amount: number };
const TWEENS: Tween[] = [
  { sel: '.framer-16v5wt9', from: 'translateY(6px)', ms: 450, delay: 150, amount: 0.5 },
  { sel: '.framer-1yavpk', from: 'translateX(-12px)', ms: 500, delay: 300, amount: 0.5 },
  { sel: '.framer-7oa5rc', from: 'translateX(-12px)', ms: 500, delay: 450, amount: 0.5 },
];

export function useReceiptEnter(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const offs: IntersectionObserver[] = [];
    const once = (target: HTMLElement, amount: number, run: () => void) => {
      const io = new IntersectionObserver(
        (es) => {
          if (!es.some((e) => e.isIntersecting)) return;
          io.disconnect();
          run();
        },
        { threshold: amount },
      );
      io.observe(target);
      offs.push(io);
    };
    for (const card of el.querySelectorAll<HTMLElement>('.framer-1qk8qr7'))
      once(card, 0.2, () =>
        animate(
          card,
          { opacity: [0, 1], y: [16, 0], scale: [0.97, 1] },
          { type: 'spring', bounce: 0.12, duration: 0.7 },
        ),
      );
    for (const t of TWEENS)
      for (const node of el.querySelectorAll<HTMLElement>(t.sel))
        once(node, t.amount, () => {
          node.animate(
            [
              { opacity: 0, transform: t.from },
              { opacity: 1, transform: 'none' },
            ],
            { duration: t.ms, delay: t.delay, easing: EASE, fill: 'backwards' },
          );
        });
    return () => {
      for (const o of offs) o.disconnect();
    };
  }, [root]);
}
