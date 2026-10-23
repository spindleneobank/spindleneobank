/** Framer's default transitions, as observed in the old site (WAAPI recordings). */
export const SPRING = { type: 'spring', bounce: 0, duration: 0.6 } as const; // hover opacity, menus, hamburger
export const FADE = { duration: 0.3, ease: [0.44, 0, 0.56, 1] } as const; // overlay panels, in-view fades
export const EASE_LINK = 'cubic-bezier(0.44, 0, 0.56, 1)'; // text links: 0.2s color/decoration
export const BREAKPOINTS = { tablet: 810, desktop: 1200 } as const; // phone <=809.98, tablet 810-1199.98, desktop >=1200
