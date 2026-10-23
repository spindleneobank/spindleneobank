# Marketing motion primitives (P1)

Import from `components/marketing/motion`. Values are the ones recorded from the old Framer site (framer-motion = `motion`).
- `SPRING` `{type:'spring',bounce:0,duration:.6}`: Framer's default hover/menu transition (opacity .5 to 1 on links, menus, hamburger). `FADE` `{duration:.3, ease:[.44,0,.56,1]}`: overlay panels and in-view fades. `EASE_LINK` for CSS text-link transitions (.2s). `BREAKPOINTS`, `useBreakpoint()`: phone <=809.98, tablet 810-1199.98, desktop >=1200.
- `<Appear spec={{initial, animate, transition}} inView? />`: paste the values from the old page's `__framer__appearAnimationsContent` JSON (or component props). Renders the final state on the server, with reduced motion, and before hydration.
- `<SplitReveal text stagger={0.05} delay />`: per-character opacity reveal (0.001 to 1, 10 ms linear, 50 ms stagger), the old heading/typewriter effect.
- `<LiquidMetal angle distortion softness speed />`: WebGL port of the Framer Liquid Metal shader (GLSL verbatim). Use inside a clipped, positioned box (see `ButtonPrimary`). Stills on phone and reduced motion, like the original. SVG-mask source is not ported.
- Shell parts (`components/marketing/shell`): `ButtonPrimary` (rim + text roll, `light` for the cream variant), `ButtonSecondary`, `LogoSpotlight`, `NavLink` (accepts `/path#hash`), `SocialButton` + `ComingDialog` (old `coming()` dialog, `data-sp-social` hover bounce), `MarketingShell` (fixed header, page edge lines, Lenis smooth scroll, footer with the closing band).
