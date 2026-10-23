import { useEffect, useState } from 'react';

const RAMP = ['#62539b', '#8e5691', '#b86a92', '#cc6c78', '#d37f59', '#ce9755'];
const KEY = 'spindle-intro-v2';

/**
 * Port of preloader.js. Prerendered visible; hides once fonts are ready (max 5s). Skipped after the first view in
 * a session and for reduced motion. Never mounted on /dashboard.
 */
export function Preloader() {
  const [done, setDone] = useState(false);
  const [gone, setGone] = useState(false);
  const [count, setCount] = useState(1);
  useEffect(() => {
    let seen = false;
    try {
      seen = sessionStorage.getItem(KEY) === '1';
    } catch {
      // ignore
    }
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const finish = () => {
      setDone(true);
      try {
        sessionStorage.setItem(KEY, '1');
      } catch {
        // ignore
      }
      setTimeout(() => setGone(true), 340);
    };
    if (seen || reduced) {
      finish();
      return;
    }
    const ticker = setInterval(() => setCount((c) => Math.min(94, c + 7)), 65);
    const cap = setTimeout(finish, 5000);
    const min = new Promise((r) => setTimeout(r, 900));
    Promise.all([document.fonts?.ready ?? Promise.resolve(), min]).then(finish, finish);
    return () => {
      clearInterval(ticker);
      clearTimeout(cap);
    };
  }, []);
  if (gone) return null;
  return (
    <div
      id="sp-preloader"
      className={`sp-loader${done ? ' gone' : ''}`}
      role="status"
      aria-label="Loading Spindle"
    >
      <div className="sp-loader-inner">
        <div className="sp-loader-word">Spindle</div>
        <div className="sp-loader-grid" aria-hidden="true">
          {Array.from({ length: 105 }, (_, i) => (
            <i key={i} style={{ '--i': i, '--c': RAMP[i % RAMP.length] } as React.CSSProperties} />
          ))}
        </div>
        <div className="sp-loader-progress">
          <i />
        </div>
        <div className="sp-loader-readout">
          <span>{done ? 'READY' : 'ASSEMBLING THE NETWORK'}</span>
          <span>{done ? '100' : String(count).padStart(3, '0')}</span>
        </div>
        <div className="sp-loader-caption">COMPUTE / VERIFY / CHOOSE</div>
      </div>
    </div>
  );
}
