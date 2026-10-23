import { Link } from '@tanstack/react-router';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { PixelIcon } from './PixelIcon';

type Variant = 'primary' | 'secondary' | 'ghost';
type Common = { variant?: Variant; icon?: string; children: ReactNode; className?: string };

export function CTA({
  to,
  href,
  variant = 'primary',
  icon = 'arrow',
  children,
  className = '',
  ...rest
}: Common & { to?: string; href?: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = `sp-cta sp-cta-${variant} ${className}`;
  const inner = (
    <>
      <span>{children}</span>
      {icon ? <PixelIcon name={icon} size={16} /> : null}
    </>
  );
  if (to) {
    return (
      <Link to={to} className={cls}>
        {inner}
      </Link>
    );
  }
  if (href) {
    return (
      <a href={href} className={cls} target="_blank" rel="noreferrer noopener">
        {inner}
      </a>
    );
  }
  return (
    <button type="button" className={cls} {...rest}>
      {inner}
    </button>
  );
}
