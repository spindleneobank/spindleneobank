import Lenis from 'lenis';
import { type ReactNode, useEffect, useState } from 'react';
import { Footer } from './Footer';
import { Header } from './Header';
import './shell.css';

/** Edge lines with the travelling gradient streak (framer-q66caz "LIne"); height follows the document. */
function PageLines() {
  const [h, setH] = useState(8600);
  useEffect(() => {
    const f = () => setH(document.documentElement.scrollHeight);
    f();
    const ro = new ResizeObserver(f);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="sx-lines" aria-hidden="true" style={{ ['--sx-h' as string]: `${h}px` }}>
      <div className="sx-lines-in">
        <div className="sx-line sx-line-l">
          <i />
        </div>
        <div className="sx-line sx-line-r">
          <i />
        </div>
      </div>
    </div>
  );
}

/** Same settings as the old Framer Lenis (intensity 6 -> duration 0.6s). Skipped for reduced motion. */
function useSmoothScroll() {
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const l = new Lenis({ smoothWheel: true, duration: 0.6, autoRaf: true, autoToggle: true, anchors: true, allowNestedScroll: true, syncTouch: false, stopInertiaOnNavigate: true, orientation: 'vertical', gestureOrientation: 'vertical' });
    return () => l.destroy();
  }, []);
}

/**
 * Marketing shell. The header is position:fixed (out of flow, z-index 10) exactly like the old site, so page bodies start
 * at y=0 and own their top padding. The footer includes the closing "Your compute. Your payout." band.
 */
export function MarketingShell({ children }: { children: ReactNode }) {
  useSmoothScroll();
  return (
    <div className="sx-shell" style={{ position: 'relative', minHeight: '100vh' }}>
      <Header />
      <main id="main">{children}</main>
      <PageLines />
      <Footer />
    </div>
  );
}
