import { spring } from 'motion';
import type { Breakpoint } from '../../../components/marketing/motion/useBreakpoint';
import { applyExceptions } from './exceptions';
import { STEPS } from './sliderData';

/**
 * Old "Explore the paths" stepper (Framer component with Active/Inactive cards): clicking an inactive card makes it the
 * active one. Desktop cards share a row (active 803px, others 208px), tablet/phone stack them (active 442/450px, others
 * 111/67px). The box size eases with the recorded spring (bounce 0, duration .6, sampled every 10 ms) and the small
 * label icon of the two cards cross-fades .4 <-> 1 over 600 ms.
 */
const SAMPLES = 61;
const sampleSpring = () => {
  const g = spring({ keyframes: [0, 1], duration: 600, bounce: 0 });
  return Array.from({ length: SAMPLES }, (_, i) => (i === SAMPLES - 1 ? 1 : g.next(i * 10).value));
};
const linearEase = () => `linear(${sampleSpring().slice(0, 60).map((v) => Math.round(v * 10000) / 10000).join(', ')})`;

const CARD = '.framer-E7aMW';
const STEP_ROOT = '.framer-egeFU';

export function runSlider(root: HTMLElement, bp: Breakpoint) {
  const steps = STEPS[bp];
  const onClick = (e: Event) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>(CARD);
    if (!card || !root.contains(card) || !/Inactive/.test(card.dataset.framerName ?? '')) return;
    const stepRoot = card.closest<HTMLElement>(STEP_ROOT);
    if (!stepRoot) return;
    const cards = [...stepRoot.querySelectorAll<HTMLElement>(CARD)];
    const next = cards.indexOf(card);
    const prev = cards.findIndex((c) => /Active/.test(c.dataset.framerName ?? '') && !/Inactive/.test(c.dataset.framerName ?? ''));
    const html = steps[next];
    if (!html) return;
    const vertical = bp !== 'desktop';
    const before = cards.map((c) => (c.parentElement as HTMLElement).getBoundingClientRect());
    const tpl = document.createElement('template');
    tpl.innerHTML = applyExceptions(html);
    const fresh = tpl.content.firstElementChild as HTMLElement;
    stepRoot.replaceWith(fresh);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    const after = [...fresh.querySelectorAll<HTMLElement>(CARD)];
    const ease = sampleSpring();
    const targets = after.map((c) => (c.parentElement as HTMLElement).getBoundingClientRect());
    after.forEach((c, i) => {
      const box = c.parentElement as HTMLElement;
      const to = targets[i] as DOMRect;
      const b = before[i];
      if (!b) return;
      const prop = vertical ? 'height' : 'width';
      const from = vertical ? b.height : b.width;
      const end = vertical ? to.height : to.width;
      {
        const frames = ease.map((v) => ({ flex: "0 0 auto", [prop]: `${from + (end - from) * v}px` }));
        box.animate(frames, { duration: 600, easing: 'linear', fill: 'none' });
      }
      const label = c.querySelector<HTMLElement>('.framer-18935bg');
      if (label && (i === next || i === prev)) {
        label.animate({ opacity: i === next ? [0.4, 1] : [1, 0.4] }, { duration: 600, easing: linearEase(), fill: 'both' });
      }
    });
  };
  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}
