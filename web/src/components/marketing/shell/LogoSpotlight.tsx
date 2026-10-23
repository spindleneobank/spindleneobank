import { useEffect, useMemo, useRef, useState } from 'react';

const R = 120; // spotlightRadius
const FALLOFF = 45; // % of full alpha before fading out
const SIZE = R * 2;
const SWEEP_MS = 5000;
const PERIOD_MS = 5400;
const LOGO_GRADIENT =
  'linear-gradient(116deg, color-mix(in srgb, rgba(233, 214, 223, 1) 15%, transparent) 0%, color-mix(in srgb, rgba(233, 214, 223, 1) 15%, transparent) 29%, color-mix(in srgb, rgba(233, 214, 223, 1) 15%, transparent) 42%, color-mix(in srgb, rgba(233, 214, 223, 1) 15%, transparent) 59%, color-mix(in srgb, rgba(233, 214, 223, 1) 15%, transparent) 100%)';
const SPOT_GRADIENT = 'linear-gradient(90deg, rgba(233, 214, 223, 0.1) 0%, rgb(233, 214, 223) 50%, rgba(233, 214, 223, 0.1) 100%)';
const MASK_REPEAT = { WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat' } as const;

/**
 * Port of the footer "Logo Spotlight" Framer component: a faint gradient wordmark, plus a radial spotlight (120px)
 * that follows the pointer (opacity fades 0.28s) and, with no pointer, sweeps left to right (5s sweep every 5.4s).
 * The SVG is fetched and recoloured white so it works as a mask, exactly like the original.
 */
export function LogoSpotlight({ src = '/assets/brand/footer-wordmark.svg', alt = 'Spindle' }: { src?: string; alt?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const spot = useRef<HTMLDivElement>(null);
  const box = useRef({ width: 0, height: 0 });
  const [hover, setHover] = useState(false);
  const [coarse, setCoarse] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [mask, setMask] = useState<string | null>(null);
  const inside = useRef(false);

  useEffect(() => {
    const a = matchMedia('(hover: none), (pointer: coarse)');
    const b = matchMedia('(prefers-reduced-motion: reduce)');
    const f = () => {
      setCoarse(a.matches);
      setReduced(b.matches);
    };
    f();
    a.addEventListener('change', f);
    b.addEventListener('change', f);
    return () => {
      a.removeEventListener('change', f);
      b.removeEventListener('change', f);
    };
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    let url: string | null = null;
    (async () => {
      try {
        const r = await fetch(src, { signal: ac.signal });
        if (!r.ok) return;
        const doc = new DOMParser().parseFromString(await r.text(), 'image/svg+xml').documentElement;
        if (doc.nodeName.toLowerCase() !== 'svg') return;
        for (const e of Array.from(doc.querySelectorAll('*'))) {
          if (e.tagName.toLowerCase() === 'stop') {
            e.setAttribute('stop-color', '#ffffff');
            e.setAttribute('stop-opacity', '1');
          }
          const f = e.getAttribute('fill');
          const s = e.getAttribute('stroke');
          if (f && f !== 'none') e.setAttribute('fill', '#ffffff');
          if (s && s !== 'none') e.setAttribute('stroke', '#ffffff');
          e.removeAttribute('opacity');
          e.removeAttribute('fill-opacity');
          e.removeAttribute('stroke-opacity');
        }
        url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(doc)], { type: 'image/svg+xml' }));
        if (!ac.signal.aborted) setMask(url);
      } catch {
        // fall back to the plain src mask
      }
    })();
    return () => {
      ac.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [src]);

  const disabled = coarse || reduced;
  const loop = !disabled;
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const m = () => {
      const r = el.getBoundingClientRect();
      box.current = { width: r.width, height: r.height };
    };
    m();
    const ro = new ResizeObserver(m);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const s = spot.current;
    if (!s || !loop) return;
    let raf = 0;
    let t0: number | null = null;
    let acc = 0;
    s.style.setProperty('--active-x', `${-R}px`);
    s.style.setProperty('--active-y', `${Math.max(0, box.current.height * 0.5)}px`);
    const step = (now: number) => {
      if (t0 === null) t0 = now;
      const dt = now - t0;
      t0 = now;
      if (inside.current) {
        raf = requestAnimationFrame(step);
        return;
      }
      acc += dt;
      const { width, height } = box.current;
      const d = acc % PERIOD_MS;
      const x = d < SWEEP_MS ? -R + (width + R * 2) * (d / SWEEP_MS) : width + R;
      s.style.setProperty('--active-x', `${x}px`);
      s.style.setProperty('--active-y', `${Math.max(0, height * 0.5)}px`);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [loop]);

  const maskImg = useMemo(() => `url("${mask ?? src}")`, [mask, src]);
  const radial = `radial-gradient(circle ${R}px at var(--active-x, -9999px) var(--active-y, 50%), rgba(0, 0, 0, 1) 0%, rgba(0, 0, 0, 1) ${FALLOFF}%, rgba(0, 0, 0, 0) 100%)`;
  const place = { WebkitMaskPosition: 'center', maskPosition: 'center', WebkitMaskSize: '100% 100%', maskSize: '100% 100%' } as const;
  const setXY = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    spot.current?.style.setProperty('--active-x', `${e.clientX - r.left}px`);
    spot.current?.style.setProperty('--active-y', `${e.clientY - r.top}px`);
  };

  return (
    <div
      ref={host}
      style={{ position: 'relative', width: '100%', display: 'block' }}
      onPointerEnter={(e) => {
        if (disabled) return;
        inside.current = true;
        setXY(e);
        setHover(true);
      }}
      onPointerMove={(e) => {
        if (!disabled) setXY(e);
      }}
      onPointerLeave={() => {
        if (disabled) return;
        inside.current = false;
        if (loop) {
          spot.current?.style.setProperty('--active-x', `${-R}px`);
          spot.current?.style.setProperty('--active-y', `${Math.max(0, box.current.height * 0.5)}px`);
        }
        setHover(false);
      }}
    >
      <img src={src} alt={alt} style={{ width: '100%', height: 'auto', display: 'block', opacity: 0, pointerEvents: 'none', userSelect: 'none' }} />
      <div
        aria-hidden="true"
        style={{ position: 'absolute', inset: 0, background: LOGO_GRADIENT, WebkitMaskImage: maskImg, maskImage: maskImg, ...MASK_REPEAT, ...place, pointerEvents: 'none' }}
      />
      <div
        ref={spot}
        aria-hidden="true"
        style={{ position: 'absolute', inset: 0, opacity: hover || loop ? 1 : 0, transition: `opacity ${reduced ? 0 : 0.28}s ease`, WebkitMaskImage: radial, maskImage: radial, ...MASK_REPEAT, pointerEvents: 'none' }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: SPOT_GRADIENT,
            backgroundSize: `${SIZE}px ${SIZE}px`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: `calc(var(--active-x, -9999px) - ${R}px) calc(var(--active-y, 50%) - ${R}px)`,
            WebkitMaskImage: maskImg,
            maskImage: maskImg,
            ...MASK_REPEAT,
            ...place,
          }}
        />
      </div>
    </div>
  );
}
