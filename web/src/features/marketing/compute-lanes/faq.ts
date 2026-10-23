import { FAQ_ANSWERS } from './faqData';
import { applyExceptions } from './exceptions';

/**
 * Old FAQ accordion (Framer "Question" component, variants Opened/Closed): one item open at a time, click or
 * Enter/Space on the row toggles, the vertical bar of the plus icon is removed while open, and the item height
 * eases over 0.4s (cubic-bezier .44,0,.56,1, the Framer default tween).
 */
const OPEN = 'framer-v-v32ldq';
const CLOSED = 'framer-v-1k5bvof';
const EASE = 'cubic-bezier(0.44, 0, 0.56, 1)';

const answerHtml = () =>
  `<div class="framer-i0kiun" data-framer-name="Answer"><div class="framer-1cqouj1" data-framer-name="Answer" data-framer-component-type="RichTextContainer" style="--extracted-r6o4lv: var(--sp-fg-token-f6a8d8cb-9e85-4bc1-a178-0191b832f963, rgba(243, 218, 205, 0.66)); --framer-link-text-color: rgba(190, 140, 168, 1); --framer-link-text-decoration: underline; transform: none;"><p dir="auto" class="framer-text framer-styles-preset-19rt131"></p></div></div>`;

export function runFaq(root: HTMLElement) {
  const items = () => [...root.querySelectorAll<HTMLElement>('.framer-5aNe3[name^="Question"]')];
  const first = items();
  if (!first.length) return () => {};
  const closedIcon = first.find((i) => i.dataset.framerName === 'Closed')?.querySelector('.framer-94cer6')?.innerHTML ?? '';
  const openIcon = first.find((i) => i.dataset.framerName === 'Opened')?.querySelector('.framer-94cer6')?.innerHTML ?? '';
  const index = (el: HTMLElement) => Number((el.getAttribute('name') ?? '').replace(/\D/g, '')) - 1;

  const setState = (el: HTMLElement, open: boolean) => {
    el.classList.toggle(OPEN, open);
    el.classList.toggle(CLOSED, !open);
    el.dataset.framerName = open ? 'Opened' : 'Closed';
    const icon = el.querySelector('.framer-94cer6');
    if (icon) icon.innerHTML = open ? openIcon : closedIcon;
    const has = el.querySelector(':scope > .framer-i0kiun');
    if (open && !has) {
      el.insertAdjacentHTML('beforeend', answerHtml());
      const p = el.querySelector('.framer-i0kiun p');
      if (p) p.textContent = applyExceptions(FAQ_ANSWERS[index(el)] ?? '');
    } else if (!open && has) has.remove();
  };

  const toggle = (target: HTMLElement) => {
    const wasOpen = target.dataset.framerName === 'Opened';
    const changed: Array<{ el: HTMLElement; from: number }> = [];
    const all = items();
    for (const el of all) changed.push({ el, from: el.getBoundingClientRect().height });
    for (const el of all) setState(el, el === target ? !wasOpen : false);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    for (const { el, from } of changed) {
      const to = el.getBoundingClientRect().height;
      if (Math.abs(to - from) < 1) continue;
      el.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: 400, easing: EASE });
      const prev = el.style.overflow;
      el.style.overflow = 'hidden';
      setTimeout(() => {
        el.style.overflow = prev;
      }, 400);
    }
  };

  const onClick = (e: Event) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('.framer-5aNe3[name^="Question"]');
    if (t && root.contains(t)) toggle(t);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const t = (e.target as HTMLElement).closest<HTMLElement>('.framer-5aNe3[name^="Question"]');
    if (t && e.target === t) {
      e.preventDefault();
      toggle(t);
    }
  };
  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKey);
  return () => {
    root.removeEventListener('click', onClick);
    root.removeEventListener('keydown', onKey);
  };
}
