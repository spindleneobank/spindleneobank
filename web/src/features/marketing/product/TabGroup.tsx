import { animate } from 'motion/react';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { type PNode, renderNode } from './render';

/**
 * "Explore the paths" tab group (Framer variant component: Step 1 / 2 / 3). Clicking a tab makes it the active step;
 * the old page crossfades the tab label (opacity 1 -> 0.4 on the one that closes, 0.4 -> 1 on the one that opens,
 * spring bounce 0 / 0.6s) and swaps the step content. Hovering an inactive tab does the same. Tabs never advance on their own.
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
  const run = useRef<{ stop: () => void } | null>(null);

  // While the widths animate the boxes move under a resting pointer and would fire mouseover on the neighbour tab, so
  // hover is ignored until the spring has settled (clicks always work).
  const lockUntil = useRef(0);
  const activate = (el: Element, hover = false) => {
    const k = TABS.findIndex((c) => el.closest(`.${c}`));
    if (k < 0 || k === i || (hover && performance.now() < lockUntil.current)) return;
    lockUntil.current = performance.now() + 700;
    widths.current = TABS.map(
      (c) => box.current?.querySelector<HTMLElement>(`.${c}`)?.getBoundingClientRect().width ?? 0,
    );
    setI(k);
  };

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
    // Framer layout animation: the closing tab shrinks (803 -> 208 px) and the opening one grows with the same spring
    // while the step content swaps instantly. The inactive tabs are `flex: 1 0 0`, so animating only the two changed
    // widths would let the third tab breathe; every tab gets an explicit width for the length of the spring instead.
    run.current?.stop();
    const els = TABS.map((c) => root.querySelector<HTMLElement>(`.${c}`));
    const clear = () => {
      for (const el of els) {
        el?.style.removeProperty('flex');
        el?.style.removeProperty('width');
      }
    };
    clear();
    const to = els.map((el) => el?.getBoundingClientRect().width ?? 0);
    const from = widths.current.map((w, k) => (w > 0 ? w : (to[k] ?? 0)));
    if (!from.some((w, k) => Math.abs(w - (to[k] ?? 0)) > 1)) return;
    const set = (v: number) =>
      els.forEach((el, k) => {
        if (!el) return;
        const w = (from[k] ?? 0) + ((to[k] ?? 0) - (from[k] ?? 0)) * v;
        el.style.flex = `0 0 ${w}px`;
        el.style.width = `${w}px`;
      });
    set(0);
    run.current = animate(0, 1, { ...SPRING, onUpdate: set, onComplete: clear });
  }, [i]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the tabs are the old Framer tap targets (no key handling in the original)
    <div
      ref={box}
      style={{ display: 'contents' }}
      onClick={(e) => activate(e.target as Element)}
      // The old tabs also open on hover (Framer onMouseEnter variant): measured on /product, hovering an inactive tab
      // makes it the active one and the former one stays collapsed after the pointer leaves.
      onMouseOver={(e) => activate(e.target as Element, true)}
    >
      {renderNode(states[i] as PNode, 't', 'tabs', override)}
    </div>
  );
}
