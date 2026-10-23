import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { LiquidMetal } from '../motion/LiquidMetal';
import { useBreakpoint } from '../motion/useBreakpoint';

function Roll({ children }: { children: ReactNode }) {
  return (
    <span className="sx-roll">
      <p>{children}</p>
      <p aria-hidden="true">{children}</p>
    </span>
  );
}

/** Framer "Button Primary": liquid-metal rim (angle 45, distortion .08, softness .1) around a plate with a text roll on hover. */
export function ButtonPrimary({
  to,
  children,
  light = false,
  lg = false,
  className = '',
}: {
  to: string;
  children: ReactNode;
  light?: boolean;
  lg?: boolean;
  className?: string;
}) {
  const bp = useBreakpoint();
  return (
    <Link to={to} className={`sx-btn ${light ? 'sx-btn-light' : ''} ${lg ? 'sx-btn-lg' : ''} ${className}`}>
      {bp === 'phone' ? (
        <span className="sx-btn-metal" aria-hidden="true" style={{ display: 'none' }}>
          <canvas width={0} height={0} />
        </span>
      ) : (
        <span className="sx-btn-metal" aria-hidden="true">
          <LiquidMetal angle={45} distortion={0.08} softness={0.1} speed={1} />
        </span>
      )}
      <span className="sx-btn-plate">
        <Roll>{children}</Roll>
      </span>
    </Link>
  );
}

/** Framer "Primary" outline button (footer band). */
export function ButtonSecondary({
  to,
  children,
  className = '',
}: {
  to: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link to={to} className={`sx-sbtn sx-btn-lg ${className}`}>
      <Roll>{children}</Roll>
    </Link>
  );
}
