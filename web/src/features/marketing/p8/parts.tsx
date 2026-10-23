import type { ReactNode } from 'react';
import { LiquidMetal } from '../../../components/marketing/motion';
import './p8.css';

/** Framer "Light" border component: 1px light + 1px page-colour line on the chosen sides. */
export function Lines({ sides }: { sides: ('t' | 'b' | 'l' | 'r')[] }) {
  return (
    <span className="p8-lines" aria-hidden="true">
      {sides.map((s) => (
        <i key={s} className={s} />
      ))}
    </span>
  );
}

/** Framer "White" pill: liquid-metal rim, sunrise pixel icon, uppercase label. */
export function Pill({ children }: { children: string }) {
  return (
    <div className="p8-pill">
      <span className="p8-pill-metal" aria-hidden="true">
        <LiquidMetal angle={45} distortion={0.08} softness={0.1} speed={1} />
      </span>
      <div className="p8-pill-in">
        <img src="/assets/pixel/sunrise.svg" alt="" width={18} height={18} />
        <p>{children}</p>
      </div>
    </div>
  );
}

export function Band({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`p8-band ${className}`}>{children}</div>;
}
