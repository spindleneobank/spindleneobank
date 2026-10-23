import { type CSSProperties, useEffect, useState } from 'react';

/**
 * Port of the old Framer "Typewriter" code component (runtime/FlutedSwirl.mjs `kt`) as used by "Spend Typewriter":
 * types each message (55ms/char), holds it 1200ms, deletes it (35ms/char), moves to the next and loops; the cursor
 * blinks every 500ms (80ms opacity transition). Reduced motion shows the first message. Markup is the original's.
 */
const MESSAGES = ['What happens after a job completes?', 'Which payout route fits me?', 'What does a signed receipt show?'];
const TYPE_MS = 55;
const DELETE_MS = 35;
const PAUSE_MS = 1200;
const BLINK_MS = 500;

type Phase = 'typing' | 'deleting';

export function Typewriter({ style, cursor }: { style?: CSSProperties; cursor?: CSSProperties }) {
  const [live, setLive] = useState(false);
  const [w, setW] = useState(0);
  const [n, setN] = useState(0);
  const [phase, setPhase] = useState<Phase>('typing');
  const [on, setOn] = useState(true);
  const msg = MESSAGES[w] as string;
  const longest = MESSAGES.reduce((a, b) => (b.length > a.length ? b : a));

  useEffect(() => {
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) setLive(true);
  }, []);

  useEffect(() => {
    if (!live) return;
    let t: number;
    if (phase === 'typing') {
      t = n < msg.length ? window.setTimeout(() => setN((x) => x + 1), TYPE_MS) : window.setTimeout(() => setPhase('deleting'), PAUSE_MS);
    } else if (n > 0) {
      t = window.setTimeout(() => setN((x) => x - 1), DELETE_MS);
    } else {
      t = window.setTimeout(() => {
        setW((x) => (x + 1) % MESSAGES.length);
        setPhase('typing');
      }, 0);
    }
    return () => clearTimeout(t);
  }, [live, phase, n, msg]);

  useEffect(() => {
    if (!live) return;
    const i = window.setInterval(() => setOn((x) => !x), BLINK_MS);
    return () => clearInterval(i);
  }, [live]);

  const shown = live ? msg.slice(0, n) : (MESSAGES[0] as string);
  return (
    <div role="text" style={style}>
      <span aria-hidden="true" style={{ visibility: 'hidden', display: 'block', whiteSpace: 'nowrap', minHeight: 22 }}>
        {longest}
      </span>
      <span aria-hidden="true" style={{ position: 'absolute', inset: 0, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'baseline', minHeight: 22 }}>
        <span>{shown}</span>
        <span style={{ ...cursor, opacity: live ? +on : 1 }} />
      </span>
      <span style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0 }}>{live ? msg : (MESSAGES[0] as string)}</span>
    </div>
  );
}
