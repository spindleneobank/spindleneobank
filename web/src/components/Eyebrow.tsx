import type { ReactNode } from 'react';

export function Eyebrow({ children, tone = 'dark' }: { children: ReactNode; tone?: 'dark' | 'light' }) {
  return <span className={`sp-eyebrow sp-eyebrow-${tone}`}>{children}</span>;
}
