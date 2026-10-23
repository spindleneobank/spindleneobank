import { type RefObject, useEffect } from 'react';

/**
 * "Receipt verified for the epoch" card: when it first scrolls into view the card scales in (0.97 -> 1), its title
 * slides down 6px and the two proof rows slide in from -12px, staggered (timings measured on the old page).
 */
const EASE = 'cubic-bezier(0.44, 0, 0.56, 1)';
const STEPS: { sel: string; from: string; ms: number; delay: number }[] = [
  { sel: '.framer-TxqIX', from: 'scale(0.97)', ms: 800, delay: 0 },
  { sel: '.framer-16v5wt9', from: 'translateY(6px)', ms: 450, delay: 200 },
  { sel: '.framer-1yavpk', from: 'translateX(-12px)', ms: 500, delay: 100 },
  { sel: '.framer-7oa5rc', from: 'translateX(-12px)', ms: 500, delay: 250 },
];

export function useReceiptEnter(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const hosts = [...el.querySelectorAll<HTMLElement>('.framer-18l5ov-container')];
    const io = new IntersectionObserver(
      (es) => {
        for (const e of es) {
          if (!e.isIntersecting) continue;
          io.unobserve(e.target);
          for (const s of STEPS)
            for (const t of e.target.querySelectorAll<HTMLElement>(s.sel))
              t.animate([{ opacity: 0, transform: s.from }, { opacity: 1, transform: 'none' }], { duration: s.ms, delay: s.delay, easing: EASE, fill: 'backwards' });
        }
      },
      { threshold: 0.4 },
    );
    for (const h of hosts) io.observe(h);
    return () => io.disconnect();
  }, [root]);
}
