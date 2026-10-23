import { animate } from 'motion/react';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { type PNode, renderNode } from './render';

/**
 * "Explore the paths" tab group (Framer variant component: Step 1 / 2 / 3). Clicking a tab makes it the active step;
 * the old page crossfades the tab label (opacity 1 -> 0.4 on the one that closes, 0.4 -> 1 on the one that opens,
 * spring bounce 0 / 0.6s) and swaps the step content. Tabs never advance on their own.
 */
const TABS = ['framer-aitp2v-container', 'framer-dwvy2q-container', 'framer-1g1so52-container'];
const LABEL = '.framer-18935bg';
const SPRING = { type: 'spring', bounce: 0, duration: 0.6 } as const;

export function TabGroup({
  states,
  override,
}: {
  states: PNode[];
  override?: Parameters<typeof renderNode>[3];
}): ReactNode {
  const [i, setI] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const prev = useRef(0);
  const widths = useRef<number[]>([]);

  useLayoutEffect(() => {
    const root = box.current;
    const was = prev.current;
    prev.current = i;
    if (!root || was === i || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const label = (k: number) => root.querySelector<HTMLElement>(`.${TABS[k]} ${LABEL}`);
    const out = label(was);
    const inn = label(i);
    if (out) animate(out, { opacity: [1, 0.4] }, SPRING);
    if (inn) animate(inn, { opacity: [0.4, 1] }, SPRING);
    // Framer layout animation: the closing tab shrinks (803 -> 208 px) and the opening one grows with the same
    // spring while the step content swaps instantly.
    TABS.forEach((c, k) => {
      const el = root.querySelector<HTMLElement>(`.${c}`);
      const from = widths.current[k];
      if (!el || !from) return;
      const to = el.getBoundingClientRect().width;
      if (Math.abs(from - to) > 1) animate(el, { width: [from, to] }, SPRING);
    });
  }, [i]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the tabs are the old Framer tap targets (no key handling in the original)
    <div
      ref={box}
      style={{ display: 'contents' }}
      onClick={(e) => {
        const el = e.target as Element;
        const k = TABS.findIndex((c) => el.closest(`.${c}`));
        if (k >= 0 && k !== i) {
          widths.current = TABS.map((c) => box.current?.querySelector<HTMLElement>(`.${c}`)?.getBoundingClientRect().width ?? 0);
          setI(k);
        }
      }}
    >
      {renderNode(states[i] as PNode, 't', 'tabs', override)}
    </div>
  );
}
