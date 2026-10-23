import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { type PNode, renderNode } from './render';

/**
 * Old "Inspect receipt" chat: a Framer variant component that walks through 7 states on timers
 * (1 Typing, 2a Sent, 2 Thinking, 3 Answered, 3b Typing Follow-up, 4a Follow-up Sent, 4 Follow-up) and stops on the last.
 * `STEP_MS[i]` is how long state i lasts (measured on the old page: typing 40 chars at 50ms + 300ms, then 0.9, 1.2, 0.85,
 * 0.83 and 1.24 seconds). Elements whose opacity/transform change between states are animated like Framer does
 * (300ms cubic-bezier(.44,0,.56,1)); per-character typing spans reveal at 10ms + 50ms stagger.
 */
const STEP_MS = [2500, 900, 1215, 850, 830, 1240];
/**
 * The old sequence is anchored to page load, not to mount: its state changes land at these `performance.now()` times
 * (mean of two quiet-machine measurements of the old page: Sent, Thinking, Answered, Typing Follow-up, Follow-up Sent, Follow-up).
 * A late mount (slow hydration) jumps to the state the old page would be in, so a frozen capture sees the same state.
 */
const AT_MS = [3300, 4630, 6300, 7400, 8650, 10330];
const EASE = 'cubic-bezier(0.44, 0, 0.56, 1)';

type Snap = { o: string; t: string };

export function ChatPanel({ states, override }: { states: PNode[]; override?: Parameters<typeof renderNode>[3] }): ReactNode {
  const last = states.length - 1;
  // SSR / no-JS / reduced motion show the final state; the client replays the sequence from the first.
  const [i, setI] = useState(last);
  const box = useRef<HTMLDivElement>(null);
  const prev = useRef(new Map<Element, Snap>());
  const started = useRef(false);

  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    started.current = true;
    setI(AT_MS.filter((t) => t <= performance.now()).length);
  }, []);

  useEffect(() => {
    if (!started.current || i >= last) return;
    const wait = Math.max(0, (AT_MS[i] ?? 0) - performance.now());
    const t = setTimeout(() => setI(i + 1), wait || (STEP_MS[i] ?? 1000));
    return () => clearTimeout(t);
  }, [i, last]);

  useLayoutEffect(() => {
    const root = box.current;
    if (!root) return;
    const now = new Map<Element, Snap>();
    for (const el of root.querySelectorAll<HTMLElement>('*')) {
      const s = { o: el.style.opacity, t: el.style.transform };
      now.set(el, s);
      const p = prev.current.get(el);
      if (p && started.current && (p.o !== s.o || p.t !== s.t) && !el.hasAttribute('data-pp-ch')) {
        el.animate(
          [
            { opacity: p.o || 1, transform: p.t || 'none' },
            { opacity: s.o || 1, transform: s.t || 'none' },
          ],
          { duration: 300, easing: EASE },
        );
      }
    }
    // typing: reveal each character (opacity 0.001 -> 1, 10ms, 50ms apart)
    if (started.current) {
      const chars = root.querySelectorAll<HTMLElement>('[data-pp-ch]');
      const seen = new Map<Element | null, number>();
      for (const c of chars) {
        const host = c.closest('p');
        const n = seen.get(host) ?? 0;
        seen.set(host, n + 1);
        c.animate([{ opacity: 0.001 }, { opacity: 1 }], { duration: 10, delay: 300 + n * 50, easing: EASE, fill: 'backwards' });
      }
    }
    prev.current = now;
  }, [i]);

  return (
    <div ref={box} style={{ display: 'contents' }}>
      {renderNode(states[i] as PNode, "s", "chat", override)}
    </div>
  );
}
