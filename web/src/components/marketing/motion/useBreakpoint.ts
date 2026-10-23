import { useEffect, useState } from 'react';

export type Breakpoint = 'phone' | 'tablet' | 'desktop';

/** Framer breakpoints: desktop >=1200, tablet 810-1199.98, phone <=809.98. SSR returns `desktop`. */
export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>('desktop');
  useEffect(() => {
    const t = matchMedia('(min-width: 810px)');
    const d = matchMedia('(min-width: 1200px)');
    const f = () => setBp(d.matches ? 'desktop' : t.matches ? 'tablet' : 'phone');
    f();
    t.addEventListener('change', f);
    d.addEventListener('change', f);
    return () => {
      t.removeEventListener('change', f);
      d.removeEventListener('change', f);
    };
  }, []);
  return bp;
}
