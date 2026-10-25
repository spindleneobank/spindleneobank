import { springEasing } from './framer';

/** Distance the two stacked labels of a text-roll button travel on hover (line box 20px, labels offset 18px). */
const ROLL = 18;
const MS = 600;

/**
 * Spring for the Framer button text roll. The hover layout swap (label 1 up, label 2 in) is instant CSS; like Framer's
 * layout animation, the labels then spring from their old position (+18px on enter, -18px on leave) to rest.
 * Delegated on `root`; `hostSel` is the button, `textSel` its two labels.
 */
export function initRollSpring(root: ParentNode, hostSel: string, textSel: string): () => void {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};
  const easing = springEasing(15, MS);
  const run = (host: Element, from: number) => {
    for (const t of host.querySelectorAll(textSel))
      t.animate([{ transform: `translateY(${from}px)` }, { transform: 'none' }], { duration: MS, easing });
  };
  const over = (e: Event) => {
    const host = (e.target as Element).closest?.(hostSel);
    if (host && !host.contains((e as MouseEvent).relatedTarget as Node | null)) run(host, ROLL);
  };
  const out = (e: Event) => {
    const host = (e.target as Element).closest?.(hostSel);
    if (host && !host.contains((e as MouseEvent).relatedTarget as Node | null)) run(host, -ROLL);
  };
  root.addEventListener('mouseover', over);
  root.addEventListener('mouseout', out);
  return () => {
    root.removeEventListener('mouseover', over);
    root.removeEventListener('mouseout', out);
  };
}
