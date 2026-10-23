import { type RefObject, useEffect } from 'react';

/**
 * Old Framer slideshow autoplay (the pixel-icon strip): while in view the track steps left by one item (item width +
 * gap, 78px for the 58px icon tiles with a 20px gap) every 1.5s with a ~0.9s ease, and jumps back by one set of 8
 * items (624px) once it has run past the cloned set, so the loop is seamless. Measured on the old page.
 */
const EVERY_MS = 1500;
const MOVE_MS = 900;
const EASE = 'cubic-bezier(0.44, 0, 0.56, 1)';
const SET = 8;

const x = (ul: HTMLElement) =>
  Number.parseFloat(/translateX\((-?[\d.]+)px/.exec(ul.style.transform)?.[1] ?? '0');

function mount(ul: HTMLElement) {
  const items = [...ul.children] as HTMLElement[];
  const first = items[0]?.firstElementChild as HTMLElement | null;
  if (!first) return () => {};
  const gap = Number.parseFloat(getComputedStyle(ul).columnGap || getComputedStyle(ul).gap || '0');
  const step = first.getBoundingClientRect().width + gap;
  if (!(step > 0) || items.length < SET * 2) return () => {};
  const wrapAt = step * SET * 2;
  let timer = 0;
  let anim: Animation | null = null;
  const move = (dir: 1 | -1) => {
    // dir -1: next (track moves left), dir 1: previous
    let base = x(ul);
    if (dir < 0 && -base >= wrapAt - step) {
      base += step * SET;
      ul.style.transform = `translateX(${base}px)`;
    } else if (dir > 0 && -base < step * SET) {
      base -= step * SET;
      ul.style.transform = `translateX(${base}px)`;
    }
    const to = base + dir * step;
    anim?.finish();
    anim = ul.animate([{ transform: `translateX(${base}px)` }, { transform: `translateX(${to}px)` }], {
      duration: MOVE_MS,
      easing: EASE,
    });
    anim.onfinish = () => {
      ul.style.transform = `translateX(${to}px)`;
    };
  };
  const tick = () => {
    move(-1);
    timer = window.setTimeout(tick, EVERY_MS);
  };
  // the section's pagination buttons (hidden in the old design, still wired): Previous / Next step one item
  const section = ul.closest('section');
  const prevBtn = section?.querySelector<HTMLButtonElement>('button[aria-label="Previous"]');
  const nextBtn = section?.querySelector<HTMLButtonElement>('button[aria-label="Next"]');
  const onPrev = () => move(1);
  const onNext = () => move(-1);
  prevBtn?.addEventListener('click', onPrev);
  nextBtn?.addEventListener('click', onNext);
  const stop = () => {
    clearTimeout(timer);
    timer = 0;
    anim?.finish();
  };
  const go = () => {
    if (!timer && !document.hidden) timer = window.setTimeout(tick, EVERY_MS - MOVE_MS);
  };
  const io = new IntersectionObserver((es) => (es.some((e) => e.isIntersecting) ? go() : stop()), {
    threshold: 0.1,
  });
  io.observe(ul.closest('section') ?? ul); // the track itself is translated out of its clip box
  const vis = () => (document.hidden ? stop() : undefined);
  document.addEventListener('visibilitychange', vis);
  return () => {
    io.disconnect();
    document.removeEventListener('visibilitychange', vis);
    prevBtn?.removeEventListener('click', onPrev);
    nextBtn?.removeEventListener('click', onNext);
    stop();
  };
}

export function useSlideshow(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let offs: (() => void)[] = [];
    const setup = () => {
      for (const o of offs) o();
      offs = [...el.querySelectorAll<HTMLElement>('section.framer-slideshow ul')]
        .filter(
          (u) =>
            u.getClientRects().length > 0 &&
            /translateX/.test(u.style.transform) &&
            u.children.length >= SET * 2,
        )
        .map(mount);
    };
    setup();
    const mqs = [matchMedia('(min-width: 810px)'), matchMedia('(min-width: 1200px)')];
    for (const m of mqs) m.addEventListener('change', setup);
    return () => {
      for (const m of mqs) m.removeEventListener('change', setup);
      for (const o of offs) o();
    };
  }, [root]);
}
