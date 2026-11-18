import { Link } from '@tanstack/react-router';
import { motion } from 'motion/react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { LiquidMetal } from '../../../components/marketing/motion';
import { SPRING } from '../../../components/marketing/motion/framer';
import { EXTERNAL, SOCIAL_HANDLE, SOCIALS, type Social } from '../../../components/marketing/shell/nav-data';
import './about.css';

export function Badge({ tone, children }: { tone: 'black' | 'white'; children: ReactNode }) {
  return (
    <div className="ab-badge-box">
      <div className={`ab-badge ab-badge-${tone}`}>
        <span className="ab-badge-metal" aria-hidden="true">
          <LiquidMetal angle={45} distortion={0.08} softness={0.1} speed={1} />
        </span>
        <div className="ab-badge-in">
          <img src="/assets/pixel/sunrise.svg" alt="" width={18} height={18} />
          <p>{children}</p>
        </div>
      </div>
    </div>
  );
}

export function TitleBlock({
  badge,
  tone,
  title,
  center,
  narrow,
}: {
  badge: string;
  tone: 'black' | 'white';
  title: string;
  center?: boolean;
  narrow?: 'a' | 'b';
}) {
  return (
    <div className="ab-title">
      <div className={`ab-title-c${center ? ' is-center' : ''}`}>
        <Badge tone={tone}>{badge}</Badge>
        <h2 className={`ab-h2${narrow === 'a' ? ' is-narrow' : narrow === 'b' ? ' is-narrow2' : ''}`}>
          {title}
        </h2>
      </div>
    </div>
  );
}

/** Duotone image: same filters as the old page (flower-palette.svg#orchid / #ember). */
// The old page ships a mobile candidate only on the GPU card (measured: every other image resolves to the stock file).
const SRCSET_W: Record<string, [number, number]> = {
  'role-gpu-cooling-v10': [800, 1600],
};
const SIZES = '(max-width: 809px) calc(100vw - 32px), 1200px';

export function Duo({ src, tone, className }: { src: string; tone: 'orchid' | 'ember'; className?: string }) {
  const base = src.split('/').pop()?.replace('.webp', '') ?? '';
  const w = SRCSET_W[base];
  return (
    <img
      className={className}
      src={src}
      srcSet={w ? `/assets/mobile/${base}.webp ${w[0]}w, ${src} ${w[1]}w` : undefined}
      sizes={w ? SIZES : undefined}
      alt=""
      style={{ filter: `url("/assets/flower-palette.svg#${tone}")` }}
      loading="eager"
    />
  );
}

export function RollButton({ href, children }: { href: string; children: string }) {
  return (
    <a className="ab-btn" href={href}>
      <span className="ab-roll">
        <p>{children}</p>
        <p aria-hidden="true">{children}</p>
      </span>
    </a>
  );
}

const MIX_A = 'rgba(233, 214, 223, 1)';
const MIX_B = 'rgba(233, 214, 223, 0.4)';
const mix = (pct: number) => `color-mix(in srgb, ${MIX_A} ${pct}%, ${MIX_B})`;
const WIN = 3.5; // characters over which one character fades in

/**
 * Port of the old scroll-linked text reveal: every character goes opacity .3 -> 1 and colour 40% -> 100% as the
 * block scrolls from "start 0.9" to "end 0.8" of the viewport (measured on the old page).
 */
export function RevealText({ paragraphs }: { paragraphs: string[] }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const chars = [...el.querySelectorAll<HTMLElement>('.ab-c')];
    const n = chars.length;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let top = 0;
    let bottom = 0;
    const measure = () => {
      const r = el.getBoundingClientRect();
      top = r.top + scrollY;
      bottom = r.bottom + scrollY;
    };
    const apply = (force?: unknown) => {
      raf = 0;
      const vh = innerHeight;
      // like the old effect, only track the block while it is on screen
      if (force !== true) {
        const r = el.getBoundingClientRect();
        if (r.bottom < 0 || r.top > vh * 1.25) return;
      }
      const s = top - 0.9 * vh;
      const e = bottom - 0.8 * vh;
      const p = reduce ? 1 : Math.min(1, Math.max(0, (scrollY - s) / (e - s)));
      const span = p * (n + WIN);
      for (let i = 0; i < n; i++) {
        const m = Math.min(1, Math.max(0, (span - i) / WIN));
        const c = chars[i];
        if (!c) continue;
        c.style.opacity = String(Math.round((0.3 + 0.7 * m) * 1e6) / 1e6);
        c.style.color = mix(Math.round(m * 100));
      }
    };
    const onScroll = () => apply();
    const onResize = () => {
      measure();
      apply(true);
    };
    measure();
    apply(true);
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onResize);
    const ro = new ResizeObserver(onResize);
    ro.observe(document.body);
    return () => {
      removeEventListener('scroll', onScroll);
      removeEventListener('resize', onResize);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: matches the old markup (aria-label on the text container)
    <div ref={root} className="ab-reveal" aria-label={paragraphs.join('\n\n')}>
      {paragraphs.map((p) => (
        <span key={p} aria-hidden="true">
          {p.split(' ').map((w, wi, arr) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static copy
            <span key={wi} style={{ display: 'contents' }}>
              <span className="ab-w" aria-hidden="true">
                {[...w].map((ch, ci) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static copy
                  <span key={ci} className="ab-c" aria-hidden="true" style={{ opacity: 0.3, color: mix(0) }}>
                    {ch}
                  </span>
                ))}
              </span>
              {wi < arr.length - 1 ? ' ' : null}
            </span>
          ))}
        </span>
      ))}
    </div>
  );
}

/** Dashed-frame stat tag; `speed` is the old parallax factor (px of lift per px scrolled). */
export function Tag({
  n,
  label,
  left,
  top,
  speed,
}: {
  n: string;
  label: string;
  left: string;
  top: string;
  speed: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    const apply = () => {
      raf = 0;
      if (matchMedia('(max-width: 809.98px)').matches) {
        el.style.transform = '';
        return;
      }
      el.style.transform = `translate(-50%, -50%) translateY(${-speed * scrollY}px)`;
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };
    apply();
    addEventListener('scroll', on, { passive: true });
    addEventListener('resize', on);
    return () => {
      removeEventListener('scroll', on);
      removeEventListener('resize', on);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [speed]);
  return (
    <div ref={ref} className="ab-tag" style={{ left, top }}>
      <div className="ab-tag-b">
        <span className="ab-tag-metal" aria-hidden="true">
          <LiquidMetal angle={45} distortion={0.08} softness={0.1} speed={1} />
        </span>
        <div className="ab-tag-in">
          <h4>{n}</h4>
          <p>{label}</p>
        </div>
      </div>
    </div>
  );
}

export function LinkedIn() {
  return (
    <motion.a
      className="ab-in-a"
      href="https://www.linkedin.com/"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="LinkedIn profile"
      initial={false}
      animate={{ opacity: 0.5 }}
      whileHover={{ opacity: 1 }}
      transition={SPRING}
    >
      <span className="ab-in ab-mask-in" />
    </motion.a>
  );
}

export function ArrowBox() {
  return (
    <span className="ab-rl-x">
      <span className="ab-arrow ab-mask-arrow" />
    </span>
  );
}

const PIXEL = {
  telegram: (
    <svg viewBox="0 0 32 32" aria-hidden="true" shapeRendering="crispEdges">
      <title>A stepped paper-plane social mark.</title>
      <path
        d="M3 14H6V12H10V10H14V8H18V6H22V4H28V10H26V16H24V22H22V28H19V25H16V22H13V25H10V20H6V18H3Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
      <path
        d="M10 19H13V16H16V13H19V10H22M13 20V25"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  ),
  x: (
    <svg viewBox="0 0 32 32" aria-hidden="true" shapeRendering="crispEdges">
      <title>An angular pixel X social mark.</title>
      <path
        d="M5 4H11V7H14V10H17V13H20V16H23V19H26V22H29V28H23V25H20V22H17V19H14V16H11V13H8V10H5ZM25 4V7H22V10H19M13 22H10V25H7V28"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  ),
};

/** Old `sp-document-panel` community card, linking to the Telegram and X channels. */
export function CommunityCard() {
  const channels = SOCIALS.filter((s): s is Extract<Social, { key: keyof typeof PIXEL }> => s.key in PIXEL);
  return (
    <div className="ab-card">
      <div className="ab-card-h">
        <span>SPINDLE / COMMUNITY</span>
        <h2>Follow what takes shape.</h2>
        <p>Compute lanes. Signed receipts. Network design. Follow Spindle on Telegram and X.</p>
      </div>
      <div className="ab-soc">
        {channels.map((s) => (
          <a
            key={s.key}
            href={s.href}
            {...EXTERNAL}
            data-sp-social={s.key}
            aria-label={`Spindle on ${s.label}`}
          >
            {PIXEL[s.key]}
            <span>{s.label}</span>
            <small>{SOCIAL_HANDLE.toUpperCase()}</small>
          </a>
        ))}
      </div>
    </div>
  );
}

export function RoleLink({
  slug,
  name,
  design,
  state,
  category,
}: {
  slug: string;
  name: string;
  design: string;
  state: string;
  category: string;
}) {
  return (
    <Link to="/about/$role" params={{ role: slug }} className="ab-rl-l">
      <p>{name}</p>
      <span className="ab-rl-r">
        <span className="ab-rl-d">
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <p>{design}</p>
            <p>/</p>
            <p>{state}</p>
          </span>
          <p className="dot">•</p>
          <p className="cat">{category}</p>
        </span>
        <ArrowBox />
      </span>
    </Link>
  );
}
