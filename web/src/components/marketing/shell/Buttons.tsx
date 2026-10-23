import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { LiquidMetal } from '../motion/LiquidMetal';

function Roll({ children }: { children: ReactNode }) {
  return (
    <span className="sx-roll">
      <p>{children}</p>
      <p aria-hidden="true">{children}</p>
    </span>
  );
}

/** Framer "Button Primary": liquid-metal rim (angle 45, distortion .08, softness .1) around a plate with a text roll on hover. */
export function ButtonPrimary({ to, children, light = false, className = '' }: { to: string; children: ReactNode; light?: boolean; className?: string }) {
  return (
    <Link to={to} className={`sx-btn ${light ? 'sx-btn-light sx-btn-lg' : ''} ${className}`}>
      <span className="sx-btn-metal" aria-hidden="true">
        <LiquidMetal angle={45} distortion={0.08} softness={0.1} speed={1} />
      </span>
      <span className="sx-btn-plate">
        <Roll>{children}</Roll>
      </span>
    </Link>
  );
}

/** Framer "Primary" outline button (footer band). */
export function ButtonSecondary({ to, children, className = '' }: { to: string; children: ReactNode; className?: string }) {
  return (
    <Link to={to} className={`sx-sbtn sx-btn-lg ${className}`}>
      <Roll>{children}</Roll>
    </Link>
  );
}
