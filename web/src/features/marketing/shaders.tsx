import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { LiquidMetal } from '../../components/marketing/motion';

type Host = { el: HTMLElement; kind: 'pill' | 'button' };

/**
 * The old Framer code components (liquid-metal rims on Section Labels and buttons) render `<canvas>` hosts inside
 * `[data-code-component-plugin-id]` wrappers. The static markup keeps the wrapper; the live WebGL shader is mounted
 * into it here with the values recorded from the old runtime (pill: 70/.01/.1/1.4 scale 1; button: 45/.08/.1/1).
 */
export function useShaderHosts(rootRef: { current: HTMLElement | null }, dep: unknown) {
  const [hosts, setHosts] = useState<Host[]>([]);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const found: Host[] = [];
    for (const el of root.querySelectorAll<HTMLElement>('[data-code-component-plugin-id="api"] > div')) {
      const pill = !!el.closest('[data-framer-name="White"], [data-framer-name="Section Label"]');
      el.textContent = '';
      found.push({ el, kind: pill ? 'pill' : 'button' });
    }
    setHosts(found);
    // dep: re-scan when the breakpoint tree is swapped
  }, [rootRef, dep]);
  return hosts.map((h, i) =>
    createPortal(
      h.kind === 'pill' ? (
        <LiquidMetal angle={70} distortion={0.01} softness={0.1} speed={1.4} scale={1} />
      ) : (
        <LiquidMetal angle={45} distortion={0.08} softness={0.1} speed={1} />
      ),
      h.el,
      `shader-${i}`,
    ),
  );
}
