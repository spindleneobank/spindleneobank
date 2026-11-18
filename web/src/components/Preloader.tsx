import { useEffect, useState } from 'react';

const RAMP = ['#62539b', '#8e5691', '#b86a92', '#cc6c78', '#d37f59', '#ce9755'];
const KEY = 'spindle-intro-v2';
/** Fired on window once #sp-preloader has left the DOM. */
const INTRO_DONE = 'spindle:intro-done';

/**
 * Runs `run` once the page is no longer locked by the intro: right away when no intro is playing, otherwise when the
 * preloader is removed. Returns a cancel function.
 */
export function afterIntro(run: () => void): () => void {
  const playing =
    document.documentElement.classList.contains('sp-intro') &&
    document.getElementById('sp-preloader') !== null;
  if (!playing) {
    run();
    return () => {};
  }
  addEventListener(INTRO_DONE, run, { once: true });
  return () => removeEventListener(INTRO_DONE, run);
}

/**
 * Port of preloader.js. Prerendered visible; hides once fonts are ready (max 5s). Skipped after the first view in
 * a session and for reduced motion. Never mounted on /dashboard.
 */
export function Preloader() {
  const [done, setDone] = useState(false);
  const [gone, setGone] = useState(false);
  const [count, setCount] = useState(1);
  useEffect(() => {
    const enabled = document.documentElement.classList.contains('sp-intro');
    let finished = false;
    const ticker = enabled ? setInterval(() => setCount((c) => Math.min(94, c + 7)), 65) : 0;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearInterval(ticker);
      setDone(true);
      setTimeout(() => setGone(true), 220);
      try {
        sessionStorage.setItem(KEY, '1');
      } catch {
        // ignore
      }
    };
    const cap = setTimeout(finish, 5000);
    (document.fonts?.ready ?? Promise.resolve()).then(finish, finish);
    return () => {
      clearInterval(ticker);
      clearTimeout(cap);
    };
  }, []);
  useEffect(() => {
    if (gone) dispatchEvent(new Event(INTRO_DONE));
  }, [gone]);
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
            <i
              key={i}
              style={
                { '--i': i, '--c': RAMP[(((i % 15) % 6) + Math.floor(i / 15)) % 6] } as React.CSSProperties
              }
            />
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
