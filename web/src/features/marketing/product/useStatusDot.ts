import { type RefObject, useEffect } from 'react';

/**
 * "Status Dot" (old Framer loop effect on `framer-1f2j1ga`): opacity 1 -> 0.3 and rotate 0 -> 360deg, tween 0.8s
 * ease [.42, 0, .58, 1], repeat type mirror, forever, paused while offscreen (`__framer__loopPauseOffscreen`).
 */
export function useStatusDot(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const dots = [...el.querySelectorAll<HTMLElement>('.framer-1f2j1ga')];
    const anims = dots.map((d) =>
      d.animate([{ opacity: 1, transform: 'rotate(0deg)' }, { opacity: 0.3, transform: 'rotate(360deg)' }], {
        duration: 800,
        easing: 'cubic-bezier(0.42, 0, 0.58, 1)',
        iterations: Number.POSITIVE_INFINITY,
        direction: 'alternate',
      }),
    );
    const io = new IntersectionObserver((es) => {
      for (const e of es) {
        const a = anims[dots.indexOf(e.target as HTMLElement)];
        if (e.isIntersecting) a?.play();
        else a?.pause();
      }
    });
    for (const d of dots) io.observe(d);
    return () => {
      io.disconnect();
      for (const a of anims) a.cancel();
    };
  }, [root]);
}
