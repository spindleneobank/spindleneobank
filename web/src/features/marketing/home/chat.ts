import { morph, snapshot } from './behaviors';

/**
 * "Inspect receipt" chat: a Framer variant component walking through 7 states on timers
 * (1 Typing, 2a Sent, 2 Thinking, 3 Answered, 3b Typing Follow-up, 4a Follow-up Sent, 4 Follow-up) and stopping on the last.
 * STEP_MS[i] is how long state i lasts (same machine and timings as the old product chat: typing 40 characters at 50ms
 * + 300ms, then 0.9, 1.2, 0.85, 0.83 and 1.24 s). Elements whose opacity/transform change between states animate like
 * Framer does (300ms cubic-bezier(.44,0,.56,1)); typed characters reveal at 10ms with a 50ms stagger.
 * The server renders the final state; the client replays from the first one (skipped for reduced motion).
 */
export type ChatState = { name: string; html: string };
const STEP_MS = [2500, 900, 1215, 850, 830, 1240];
const EASE = 'cubic-bezier(0.44, 0, 0.56, 1)';

export function initChat(tree: HTMLElement, states: ChatState[]): () => void {
  const root = tree.querySelector<HTMLElement>('.framer-ami7h');
  if (!root || states.length < 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};
  const anims: Animation[] = [];
  let timer = 0;
  const typed = () => {
    for (const host of root.querySelectorAll<HTMLElement>('[data-framer-name^="Typed"]')) {
      const chars = host.querySelectorAll<HTMLElement>('p span > span');
      chars.forEach((c, n) => {
        c.style.opacity = '';
        anims.push(
          c.animate([{ opacity: 0.001 }, { opacity: 1 }], {
            duration: 10,
            delay: 300 + n * 50,
            easing: 'linear',
            fill: 'backwards',
          }),
        );
      });
    }
  };
  const show = (i: number, animate: boolean) => {
    const before = new Map<Element, { o: string; t: string }>();
    for (const el of root.querySelectorAll<HTMLElement>('*'))
      before.set(el, { o: el.style.opacity, t: el.style.transform });
    morph(root, snapshot((states[i] as ChatState).html));
    if (!animate) return;
    for (const el of root.querySelectorAll<HTMLElement>('*')) {
      const p = before.get(el);
      if (p && (p.o !== el.style.opacity || p.t !== el.style.transform)) {
        anims.push(
          el.animate(
            [
              { opacity: p.o || 1, transform: p.t || 'none' },
              { opacity: el.style.opacity || 1, transform: el.style.transform || 'none' },
            ],
            { duration: 300, easing: EASE },
          ),
        );
      }
    }
    typed();
  };
  let i = 0;
  const step = () => {
    if (i >= states.length - 1) return;
    timer = window.setTimeout(() => {
      i += 1;
      show(i, true);
      step();
    }, STEP_MS[i] ?? 1000);
  };
  show(0, false);
  typed();
  step();
  return () => {
    clearTimeout(timer);
    for (const a of anims) a.cancel();
  };
}
