import { useEffect, useRef, useState } from 'react';
import { DEFAULTS, FlutedRenderer } from './flutedSwirl';

/** Settings of the old product page's "Hero Shader" (Fluted Swirl instance). */
const PROPS = {
  colorA: 'rgba(89, 62, 78, 1)',
  colorB: 'rgb(240, 240, 240)',
  palette: ['rgb(196, 191, 183)', 'rgb(166, 89, 30)', 'rgb(143, 143, 143)', 'rgb(155, 170, 207)', 'rgb(60, 83, 133)'],
  aberration: DEFAULTS.aberration * 0.9,
  paletteGain: DEFAULTS.paletteGain,
  interactive: true,
  inkBase: 'rgb(255, 255, 255)',
  inkUp: 'rgba(243, 218, 205, 1)',
  inkDown: 'rgba(243, 218, 205, 1)',
  inkLeft: 'rgba(243, 218, 205, 1)',
  inkRight: 'rgba(243, 218, 205, 1)',
  inkRadius: 3.5,
  angle: 31,
  frequency: 10,
  refraction: 4.9,
};

/**
 * Fluted Swirl canvas: animates while visible (pointer ink trail on fine pointers), a still frame on phones,
 * reduced motion and data-saver, pauses offscreen and when the tab is hidden. Same rules as the original component.
 */
export function HeroShader() {
  const box = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement | null>(null);
  const [, setFailed] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // A fresh canvas per effect run: dispose() loses the GL context, and StrictMode re-runs effects on the same node.
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block', opacity: '0', transition: 'opacity 0.6s ease' });
    el.appendChild(canvas);
    cv.current = canvas;
    let r: InstanceType<typeof FlutedRenderer>;
    try {
      r = new FlutedRenderer(canvas);
    } catch {
      setFailed(true);
      return;
    }
    const phone = matchMedia('(max-width: 809.98px)');
    const tablet = matchMedia('(max-width: 1199.98px)');
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    const fine = matchMedia('(pointer: fine)');
    const conn = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    const saver = () => !!conn?.saveData || /(^|-)2g$/.test(conn?.effectiveType ?? '');
    const animated = () => !phone.matches && !reduce.matches && !saver();
    let visible = false;
    let raf = 0;
    let last = 0;
    let time = 0;
    let px = 0.5;
    let py = 0.5;
    let cx = -1;
    let cy = -1;
    let maxDpr = 2;
    let frames = 0;
    let slow = 0;
    let degraded = false;
    const size = () => {
      const b = el.getBoundingClientRect();
      r.resize(b.width, b.height, Math.min(window.devicePixelRatio || 1, Math.min(maxDpr, tablet.matches ? 1.5 : 2)), 4.2e6);
    };
    const still = () => {
      size();
      r.draw(time, PROPS);
    };
    const loop = (t: number) => {
      raf = 0;
      if (!visible || document.hidden || !animated() || degraded) return;
      const dt = last ? Math.min((t - last) / 1000, 0.1) : 0;
      last = t;
      time += dt;
      if (dt > 0) {
        frames++;
        if (dt > 0.022) slow++;
        if (frames >= 45) {
          if (slow > 15) {
            if (maxDpr > 1) {
              maxDpr = Math.max(1, maxDpr - 0.25);
              size();
            } else degraded = true;
          }
          frames = 0;
          slow = 0;
        }
      }
      if (fine.matches) {
        if (cx >= 0) {
          const b = el.getBoundingClientRect();
          if (cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom) {
            px = (cx - b.left) / Math.max(b.width, 1);
            py = (cy - b.top) / Math.max(b.height, 1);
          }
        }
        r.stepInk(dt, px, py, PROPS);
      }
      r.draw(time, PROPS);
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (raf || !visible || document.hidden) return;
      if (!animated()) {
        still();
        return;
      }
      last = 0;
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    const onMove = (e: PointerEvent) => {
      cx = e.clientX;
      cy = e.clientY;
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    const ro = new ResizeObserver(() => {
      size();
      if (!raf) r.draw(time, PROPS);
    });
    ro.observe(el);
    const io = new IntersectionObserver(
      (e) => {
        visible = e.some((x) => x.isIntersecting);
        if (visible) start();
        else stop();
      },
      { rootMargin: '100px 0px' },
    );
    io.observe(el);
    const vis = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', vis);
    const restart = () => {
      stop();
      start();
    };
    phone.addEventListener('change', restart);
    reduce.addEventListener('change', restart);
    const lost = (e: Event) => {
      e.preventDefault();
      stop();
      setFailed(true);
    };
    canvas.addEventListener('webglcontextlost', lost);
    still();
    canvas.style.opacity = '1';
    return () => {
      canvas.remove();
      stop();
      canvas.removeEventListener('webglcontextlost', lost);
      io.disconnect();
      ro.disconnect();
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('visibilitychange', vis);
      phone.removeEventListener('change', restart);
      reduce.removeEventListener('change', restart);
      r.dispose();
    };
  }, []);

  return (
    <div ref={box} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: PROPS.colorB }}>
    </div>
  );
}
