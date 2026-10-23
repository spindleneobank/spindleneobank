import { type RefObject, useEffect, useState } from 'react';

/** True once the element has a layout box (breakpoint variants that are `display: none` stay false, so they mount no canvases). */
export function useVisibleBox(ref: RefObject<HTMLElement | null>): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setOn(el.getClientRects().length > 0);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return on;
}
