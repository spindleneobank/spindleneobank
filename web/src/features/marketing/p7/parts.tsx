import { Link } from '@tanstack/react-router';
import { animate } from 'motion';
import { type CSSProperties, type ReactNode, useRef } from 'react';
import { LiquidMetal } from '../../../components/marketing/motion';
import { MOBILE_SRC } from './mobile-src';
import './p7.css';

export type Pic = { src: string; alt: string; filter?: string | null };

const filterOf = (f?: string | null): CSSProperties | undefined =>
  f ? { filter: `url("/assets/flower-palette.svg#${f}")` } : undefined;

/** Old site image: the desktop/tablet file, and the /assets/mobile/* encode on phones (<=809.98px). */
export function Photo({
  img,
  className,
  imgClassName,
}: {
  img: Pic;
  className?: string;
  imgClassName?: string;
}) {
  const mobile = MOBILE_SRC[img.src];
  return (
    <picture className={className}>
      {mobile ? <source media="(max-width: 809.98px)" srcSet={mobile} /> : null}
      <img className={imgClassName} src={img.src} alt={img.alt} style={filterOf(img.filter)} />
    </picture>
  );
}

/** Framer "White" badge: a liquid-metal rim around a gradient plate with the sunrise pixel icon. */
export function Badge({ label }: { label: string }) {
  return (
    <div className="pg-badge">
      <div className="pg-badge-rim">
        <span className="pg-badge-metal" aria-hidden="true">
          <LiquidMetal angle={45} distortion={0.08} softness={0.1} speed={1} />
        </span>
        <div className="pg-badge-body">
          <div className="pg-badge-content">
            <img className="pg-badge-icon" src="/assets/pixel/sunrise.svg" alt="" />
            <p className="pg-label-12">{label}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 2px section edge (1px translucent + 1px page background), positioned by the parent. */
export function Edge({ side }: { side: 't' | 'b' | 'l' | 'r' }) {
  return <i className={`pg-edge pg-edge-${side}`} aria-hidden="true" />;
}

export function ArrowLink({
  to,
  label,
  dir,
  variant,
}: {
  to: '/blogs' | '/case-study';
  label: string;
  dir: 'back' | 'forward';
  variant?: 'primary' | 'dark';
}) {
  const hover = useHoverFill<HTMLAnchorElement>();
  return (
    <Link to={to} className={`pg-arrow pg-arrow-${variant ?? 'primary'}`} {...hover}>
      {dir === 'back' ? <i className="pg-arrow-icon pg-arrow-left" aria-hidden="true" /> : null}
      <span className="pg-arrow-text">
        <p className="pg-label-14">{label}</p>
      </span>
      {dir === 'forward' ? <i className="pg-arrow-icon pg-arrow-right" aria-hidden="true" /> : null}
    </Link>
  );
}

export function Section({ className, children }: { className: string; children: ReactNode }) {
  return <section className={className}>{children}</section>;
}

const FILL_OFF = 'rgba(17, 15, 21, 0)';
const FILL_ON = 'rgb(17, 15, 21)';

/** Framer hover variant: background fades to the page colour with a JS spring (bounce 0, 0.4 s). */
export function useHoverFill<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const to = (color: string) => {
    if (ref.current)
      animate(ref.current, { backgroundColor: color }, { type: 'spring', bounce: 0, duration: 0.4 });
  };
  return {
    ref,
    onPointerEnter: () => to(FILL_ON),
    onPointerLeave: () => to(FILL_OFF),
  };
}
