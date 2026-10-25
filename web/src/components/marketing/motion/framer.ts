/** Framer's default transitions, as observed in the old site (WAAPI recordings). */
export const SPRING = { type: 'spring', bounce: 0, duration: 0.6 } as const; // hover opacity, menus, hamburger
export const FADE = { duration: 0.3, ease: [0.44, 0, 0.56, 1] } as const; // overlay panels, in-view fades
export const EASE_LINK = 'cubic-bezier(0.44, 0, 0.56, 1)'; // text links: 0.2s color/decoration
export const BREAKPOINTS = { tablet: 810, desktop: 1200 } as const; // phone <=809.98, tablet 810-1199.98, desktop >=1200

/**
 * Critically damped spring (Framer {bounce 0, duration 0.6}) as a CSS linear() easing. omega is fitted from the old site's
 * recordings (about 15 rad/s: 90% after ~260ms, 99% after ~440ms); the value follows 1 - (1 + wt) e^(-wt).
 */
export function springEasing(omega = 15, ms = 600): string {
  const pts = Array.from({ length: 31 }, (_, i) => {
    const t = (i / 30) * (ms / 1000);
    return (1 - (1 + omega * t) * Math.exp(-omega * t)).toFixed(4);
  });
  return `linear(${pts.join(', ')}, 1)`;
}
