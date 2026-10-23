import { type RefObject, useEffect } from 'react';

/**
 * Port of refinements-v10.js `observe`: the network card toggles `sp-motion-visible` while at least 10% in view and the
 * tab is visible; the CSS (meter columns, work packet, status dot) only runs its infinite animations with that class.
 */
export function useMotionVisible(root: RefObject<HTMLElement | null>, selector = '.sp-network-working') {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const cards = [...el.querySelectorAll<HTMLElement>(selector)];
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) e.target.classList.toggle('sp-motion-visible', e.isIntersecting && !document.hidden);
      },
      { threshold: 0.1 },
    );
    for (const c of cards) io.observe(c);
    const vis = () => {
      for (const c of cards) {
        if (document.hidden) c.classList.remove('sp-motion-visible');
        else {
          io.unobserve(c);
          io.observe(c);
        }
      }
    };
    document.addEventListener('visibilitychange', vis);
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', vis);
      for (const c of cards) c.classList.remove('sp-motion-visible');
    };
  }, [root, selector]);
}
