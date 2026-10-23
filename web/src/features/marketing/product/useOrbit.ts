import { type RefObject, useEffect } from 'react';

/** Old "Rotating Integrations" orbit: the ring turns 12deg/s; each badge counter-rotates by (ring angle + its arm angle) to stay upright. */
export const ORBIT_DEG_PER_S = 12;

export function useOrbit(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const hosts = [...el.querySelectorAll<HTMLElement>('[data-framer-name="Rotating Orbit"]')];
    const parts = hosts.map((orbit) => {
      const arms = [...orbit.querySelectorAll<HTMLElement>(':scope > [data-framer-name^="Orbit Arm"]')].map(
        (arm) => ({
          badge: arm.firstElementChild as HTMLElement | null,
          angle: Number.parseFloat(/rotate\((-?[\d.]+)deg\)/.exec(arm.style.transform)?.[1] ?? '0'),
        }),
      );
      orbit.style.willChange = 'transform';
      for (const a of arms) if (a.badge) a.badge.style.willChange = 'transform';
      return { orbit, arms, on: true };
    });
    let raf = 0;
    let t0 = 0;
    const frame = (now: number) => {
      raf = 0;
      if (!t0) t0 = now;
      const deg = ((now - t0) / 1000) * ORBIT_DEG_PER_S;
      let any = false;
      for (const p of parts) {
        if (!p.on) continue;
        any = true;
        p.orbit.style.transform = `rotate(${deg}deg)`;
        for (const a of p.arms) if (a.badge) a.badge.style.transform = `rotate(${-(deg + a.angle)}deg)`;
      }
      if (any && !document.hidden) raf = requestAnimationFrame(frame);
    };
    const kick = () => {
      if (!raf && !document.hidden) raf = requestAnimationFrame(frame);
    };
    // Like the original ticker, the ring keeps turning offscreen; only a hidden tab pauses it.
    kick();
    document.addEventListener('visibilitychange', kick);
    return () => {
      document.removeEventListener('visibilitychange', kick);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [root]);
}
