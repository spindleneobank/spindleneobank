/** JS-driven motion of the old home page, ported with the original constants. Each init returns a dispose function. */

/** Framer spring (bounce 0, 0.4s) sampled as a linear() easing, as recorded on the old capability nav. */
const NAV_EASING =
  'linear(0, 0.0235, 0.083, 0.1647, 0.2582, 0.3557, 0.4517, 0.5423, 0.6252, 0.6991, 0.7636, 0.8186, 0.8647, 0.9025, 0.933, 0.9571, 0.9756, 0.9895, 0.9996, 1.0065, 1.0111, 1.0137, 1.0149, 1.0151, 1.0146, 1.0136, 1.0123, 1.0108, 1.0093, 1.0079, 1.0066, 1.0053, 1.0043, 1.0033, 1.0025, 1.0019, 1.0013, 1.0009, 1.0006, 1)';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** "Rotating Integrations": the orbit turns 12deg/s, every badge counter-rotates by orbit + arm angle. */
export function initOrbit(tree: HTMLElement): () => void {
  const orbit = tree.querySelector<HTMLElement>('[data-framer-name="Rotating Orbit"]');
  if (!orbit) return () => {};
  const arms = Array.from(orbit.querySelectorAll<HTMLElement>('[data-framer-name^="Orbit Arm"]')).map(
    (arm) => {
      const m = /rotate\((-?[\d.]+)deg\)/.exec(arm.style.transform);
      return { badge: arm.firstElementChild as HTMLElement | null, angle: m ? Number(m[1]) : 0 };
    },
  );
  const base = Number(/rotate\((-?[\d.]+)deg\)/.exec(orbit.style.transform)?.[1] ?? 0);
  let raf = 0;
  let t0 = 0;
  // Like the old Framer motion value, it keeps turning wherever the page is scrolled; only a hidden tab pauses it.
  const frame = (now: number) => {
    raf = 0;
    if (document.hidden) return;
    if (!t0) t0 = now;
    const a = (base + ((now - t0) / 1000) * 12) % 360;
    orbit.style.transform = `rotate(${a}deg)`;
    for (const { badge, angle } of arms) if (badge) badge.style.transform = `rotate(${-(a + angle)}deg)`;
    raf = requestAnimationFrame(frame);
  };
  const wake = () => {
    if (!raf && !document.hidden && !reduced()) {
      t0 = 0;
      raf = requestAnimationFrame(frame);
    }
  };
  wake();
  document.addEventListener('visibilitychange', wake);
  return () => {
    cancelAnimationFrame(raf);
    document.removeEventListener('visibilitychange', wake);
  };
}

const API_STAGES = [
  {
    name: 'Request accepted',
    status: '01 / REQUEST',
    detail: 'POST /v1/chat/completions',
    output: 'X-Spindle-Lane: open',
  },
  {
    name: 'Eligible GPU selected',
    status: '02 / ROUTE',
    detail: 'Open lane GPU matched to the request.',
    output: 'Open-lane prompts → eligible compute',
  },
  {
    name: 'Work recorded',
    status: '03 / RECEIPT',
    detail: 'The node signs a COSE receipt for the job.',
    output: 'receipt.cose → verification → USDG ledger',
  },
  {
    name: 'Epoch recorded',
    status: '04 / CLAIM',
    detail: 'Verified work enters the hourly Merkle root.',
    output: 'USDG · Stock Tokens · Virtual Card',
  },
];

/** Port of api-console.js: request -> GPU -> receipt -> claim, a stage every 2.4s while visible. */
export function initApiConsole(tree: HTMLElement): () => void {
  const el = tree.querySelector<HTMLElement>('.sp-api-console');
  if (!el) return () => {};
  let index = 0;
  let timer = 0;
  let visible = false;
  const q = (s: string) => el.querySelector<HTMLElement>(s);
  const draw = () => {
    const s = API_STAGES[index];
    if (!s) return;
    el.dataset.spApiStep = String(index);
    const set = (sel: string, v: string) => {
      const n = q(sel);
      if (n) n.textContent = v;
    };
    set('[data-api-status]', s.status);
    set('[data-api-title]', s.name);
    set('[data-api-detail]', s.detail);
    set('[data-api-output]', s.output);
    el.querySelectorAll('.sp-api-track i').forEach((e, i) => {
      e.classList.toggle('on', i <= index);
    });
  };
  const stop = () => {
    clearInterval(timer);
    timer = 0;
    el.classList.remove('is-running');
  };
  const play = () => {
    stop();
    if (!visible || document.hidden || reduced()) return;
    el.classList.add('is-running');
    timer = window.setInterval(() => {
      index = (index + 1) % API_STAGES.length;
      draw();
    }, 2400);
  };
  const io = new IntersectionObserver(
    (e) => {
      visible = e[0]?.isIntersecting === true;
      if (visible) play();
      else stop();
    },
    { threshold: 0.1 },
  );
  io.observe(el.parentElement ?? el);
  const rm = matchMedia('(prefers-reduced-motion: reduce)');
  document.addEventListener('visibilitychange', play);
  rm.addEventListener('change', play);
  draw();
  return () => {
    stop();
    io.disconnect();
    document.removeEventListener('visibilitychange', play);
    rm.removeEventListener('change', play);
  };
}

/** Capability nav: the link of the block past 60% of the viewport is active (opacity 0.4 <-> 1, spring 0.4s). */
export function initCapabilityNav(tree: HTMLElement): () => void {
  const ids = ['ai-analysis', 'realtime-dashboards', 'flow-automation', 'smart-integrations'];
  const links = Array.from(tree.querySelectorAll<HTMLElement>('a.framer-JhBcR')).filter((a) =>
    /(^|\/|\.)#?(ai-analysis|realtime-dashboards|flow-automation|smart-integrations)$/.test(
      a.getAttribute('href') ?? '',
    ),
  );
  if (links.length !== ids.length) return () => {};
  let current = Math.max(
    0,
    links.findIndex((a) => a.dataset.framerName === 'Active'),
  );
  // Inline styles of the link's descendants differ between the Active and Inactive variants (the bar, the text colour).
  const kidStyles = (a: HTMLElement) =>
    Array.from(a.querySelectorAll<HTMLElement>('*')).map((k) => k.getAttribute('style') ?? '');
  const activeStyles = kidStyles(links[current] as HTMLElement);
  const inactiveStyles = kidStyles(links.find((a) => a.dataset.framerName !== 'Active') as HTMLElement);
  // The step marker beside the links: Framer variants "Step 1..4" move the bar one link down (42px) with the same spring.
  const marker = tree.querySelector<HTMLElement>('.framer-1n71hhg[data-framer-name^="Step "]');
  const bar = marker?.querySelector<HTMLElement>('.framer-orfdfa') ?? null;
  const STEP_CLASS = ['framer-v-1n71hhg', 'framer-v-z3ja9q', 'framer-v-j4smim', 'framer-v-1mqsd2n'];
  const setMarker = (i: number, animate: boolean) => {
    if (!marker || !bar) return;
    const before = bar.getBoundingClientRect();
    marker.dataset.framerName = `Step ${i + 1}`;
    for (const c of STEP_CLASS) marker.classList.remove(c);
    marker.classList.add(STEP_CLASS[i] as string);
    if (!animate || reduced()) return;
    const after = bar.getBoundingClientRect();
    const dy = before.top - after.top;
    if (!dy && before.height === after.height) return;
    bar.animate(
      [
        {
          transform: `translateY(${dy}px) scaleY(${before.height / (after.height || 1)})`,
          transformOrigin: '50% 0',
        },
        { transform: 'none', transformOrigin: '50% 0' },
      ],
      { duration: 400, easing: NAV_EASING },
    );
  };
  const set = (i: number, animate: boolean) => {
    setMarker(i, animate);
    links.forEach((a, k) => {
      const on = k === i;
      const was = a.dataset.framerName === 'Active';
      if (on === was) return;
      a.dataset.framerName = on ? 'Active' : 'Inactive';
      a.classList.toggle('framer-v-1jn7imm', on);
      a.classList.toggle('framer-v-7jhj1k', !on);
      const styles = on ? activeStyles : inactiveStyles;
      a.querySelectorAll<HTMLElement>('*').forEach((k, n) => {
        const st = styles[n];
        if (st === undefined) return;
        if (st) k.setAttribute('style', st);
        else k.removeAttribute('style');
      });
      if (animate && !reduced())
        a.animate({ opacity: on ? [0.4, 1] : [1, 0.4] }, { duration: 400, easing: NAV_EASING, fill: 'both' });
    });
    current = i;
  };
  let raf = 0;
  const update = () => {
    raf = 0;
    let idx = 0;
    ids.forEach((id, k) => {
      const e = document.getElementById(id);
      if (e && e.getBoundingClientRect().top <= innerHeight * 0.6) idx = k;
    });
    if (idx !== current) set(idx, true);
  };
  const onScroll = () => {
    if (!raf) raf = requestAnimationFrame(update);
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  return () => {
    removeEventListener('scroll', onScroll);
    cancelAnimationFrame(raf);
  };
}

const EASE = 'cubic-bezier(0.44, 0, 0.56, 1)';

function textP(root: ParentNode, text: string): HTMLElement | null {
  for (const p of root.querySelectorAll<HTMLElement>('p')) if (p.textContent?.trim() === text) return p;
  return null;
}

/** Smallest ancestor of `start` whose text also contains `other`. */
function ancestorWith(start: HTMLElement | null, other: string): HTMLElement | null {
  let el = start?.parentElement ?? null;
  while (el && !el.textContent?.includes(other)) el = el.parentElement;
  return el;
}

/** Receipt-flow cards: fade and settle into place the first time they scroll into view (Framer in-view effects). */
export function initReceiptReveals(tree: HTMLElement): () => void {
  if (reduced()) return () => {};
  const verified = textP(tree, 'Receipt verified for the epoch');
  const cose = textP(tree, 'receipt.cose');
  const root = textP(tree, 'epoch.root');
  // [element, from, duration, delay] measured on the old page: spring-like settle, staggered one after another.
  const items: Array<[HTMLElement | null, Keyframe, number, number]> = [
    [
      ancestorWith(verified, 'receipt.cose'),
      { opacity: 0, transform: 'translateY(16px) scale(0.97)' },
      784,
      0,
    ],
    [verified?.parentElement ?? null, { opacity: 0, transform: 'translateY(6px)' }, 471, 150],
    [ancestorWith(cose, 'Job proof'), { opacity: 0, transform: 'translateX(-12px)' }, 523, 300],
    [ancestorWith(root, 'Merkle proof'), { opacity: 0, transform: 'translateX(-12px)' }, 461, 460],
  ];
  const cfg = new Map<Element, [Keyframe, number, number]>();
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        const c = cfg.get(e.target);
        if (c)
          (e.target as HTMLElement).animate([c[0], { opacity: 1, transform: 'none' }], {
            duration: c[1],
            delay: c[2],
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            fill: 'backwards',
          });
      }
    },
    { threshold: 0.2 },
  );
  for (const [el, from, ms, delay] of items) {
    if (!el) continue;
    cfg.set(el, [from, ms, delay]);
    io.observe(el);
  }
  return () => io.disconnect();
}

/**
 * Compute-stack icon track: the old Framer Slideshow (auto-play, direction left, interval 1.4s, gap 20, itemAmount 1,
 * playOffscreen, infinite). Every 1.4s it moves one item (icon + gap) with a spring (stiffness 200, damping 40, mass 1),
 * wrapping one set width. The centre mark loops a 1.6s linear scale 1 -> 1.1 (Framer loop effect, restarts from 1).
 */
export function initTicker(tree: HTMLElement): () => void {
  const ul = Array.from(tree.querySelectorAll<HTMLElement>('ul')).find(
    (u) => u.children.length > 6 && u.style.transform.includes('translateX'),
  );
  if (!ul || reduced()) return () => {};
  const disposers: Array<() => void> = [];
  const pulse = tree.querySelector<HTMLElement>('.framer-p8xmwf');
  if (pulse) {
    const a = pulse.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.1)' }], {
      duration: 1600,
      iterations: Number.POSITIVE_INFINITY,
      easing: 'linear',
    });
    disposers.push(() => a.cancel());
  }
  // the <li>s are display: contents, so measure their first child
  const first = ((ul.children[0] as HTMLElement).firstElementChild ?? ul).getBoundingClientRect();
  const second = ((ul.children[1] as HTMLElement).firstElementChild ?? ul).getBoundingClientRect();
  const step = Math.abs(second.x - first.x); // item width + gap
  const setW = (ul.children.length / 4) * step; // the slideshow renders four copies of the slots
  if (!step || !setW) return () => disposers.forEach((d) => d());
  const INTERVAL = 1400;
  const wrap = (v: number) => {
    // framer wrap(-setW, -2 * setW, v)
    const range = -setW;
    return ((((v + setW) % range) + range) % range) - setW;
  };
  let target = -(ul.children.length / 4) * step; // initial: one full set in
  let from = target;
  ul.style.transform = `translateX(${target}px)`;
  let t0 = 0;
  let raf = 0;
  let timer = 0;
  // overdamped spring, x'' = -k (x - target) - c x' with k = 200, c = 40 (m = 1), starting at rest
  const K = 200;
  const C = 40;
  const w0 = Math.sqrt(K);
  const z = C / (2 * w0);
  const r1 = -z * w0 + w0 * Math.sqrt(z * z - 1);
  const r2 = -z * w0 - w0 * Math.sqrt(z * z - 1);
  const frac = (t: number) => 1 - (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1);
  const vel = (t: number) => -(r2 * r1 * Math.exp(r1 * t) - r1 * r2 * Math.exp(r2 * t)) / (r2 - r1);
  const frame = (now: number) => {
    raf = 0;
    const t = (now - t0) / 1000;
    const dist = target - from;
    const done = Math.abs(dist * (1 - frac(t))) < 0.5 && Math.abs(dist * vel(t)) < 2;
    const x = done ? target : from + dist * frac(t);
    ul.style.transform = `translateX(${wrap(x)}px)`;
    if (done) {
      from = target;
      return;
    }
    raf = requestAnimationFrame(frame);
  };
  const advance = () => {
    from = target;
    // carry on from where the previous spring is (it has settled long before the next tick)
    target -= step;
    t0 = performance.now();
    if (!raf) raf = requestAnimationFrame(frame);
    timer = window.setTimeout(advance, INTERVAL);
  };
  timer = window.setTimeout(advance, INTERVAL);
  return () => {
    clearTimeout(timer);
    cancelAnimationFrame(raf);
    for (const d of disposers) d();
  };
}

/** Framer appear of the quote block: held at opacity .001, then 0.6s linear fade (0.2s delay) once it scrolls into view. */
export function initQuoteAppear(tree: HTMLElement): () => void {
  const p = Array.from(tree.querySelectorAll<HTMLElement>('p')).find((x) =>
    x.textContent?.trim().startsWith('“Install a node'),
  );
  const el = p?.closest<HTMLElement>('[data-framer-component-type="RichTextContainer"]') ?? p?.parentElement;
  if (!el || reduced()) return () => {};
  const hold = el.animate([{ opacity: 0.001 }, { opacity: 0.001 }], { duration: 10000, fill: 'both' });
  const io = new IntersectionObserver((e) => {
    if (e[0]?.isIntersecting !== true) return;
    io.disconnect();
    hold.cancel();
    el.animate(
      [
        { opacity: 0.001, transform: 'none' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 600, delay: 200, easing: 'linear', fill: 'backwards' },
    );
  });
  io.observe(el);
  return () => {
    io.disconnect();
    hold.cancel();
  };
}

const TYPEWRITER_MESSAGES = [
  'What happens after a job completes?',
  'Which payout route fits me?',
  'What does a signed receipt show?',
];

/**
 * "Inspect receipt" card typewriter: port of the old Framer typewriter component. It cycles the three messages, typing at
 * 55ms/char, holding 1200ms, deleting at 35ms/char, then the next one (loop); the cursor blinks every 500ms.
 * It starts when the page mounts (the old component has no in-view gate).
 */
export function initTypewriter(tree: HTMLElement): () => void {
  const host = tree.querySelector<HTMLElement>('.framer-1ged15i-container [role="text"]');
  if (!host || reduced()) return () => {};
  const spans = host.querySelectorAll<HTMLElement>(':scope > span');
  const live = spans[1]?.firstElementChild as HTMLElement | null;
  const cursor = spans[1]?.lastElementChild as HTMLElement | null;
  const sr = spans[2];
  if (!live || !cursor || !sr || live === cursor) return () => {};
  const TYPE = 55;
  const DELETE = 35;
  const PAUSE = 1200;
  const BLINK = 500;
  let msg = 0;
  let n = 0;
  let mode: 'typing' | 'deleting' = 'typing';
  let timer = 0;
  const draw = () => {
    const m = TYPEWRITER_MESSAGES[msg] as string;
    live.textContent = m.slice(0, n);
    sr.textContent = m;
  };
  const tick = () => {
    const m = TYPEWRITER_MESSAGES[msg] as string;
    if (mode === 'typing') {
      if (n < m.length) {
        timer = window.setTimeout(() => {
          n += 1;
          draw();
          tick();
        }, TYPE);
      } else {
        timer = window.setTimeout(() => {
          mode = 'deleting';
          tick();
        }, PAUSE);
      }
    } else if (n > 0) {
      timer = window.setTimeout(() => {
        n -= 1;
        draw();
        tick();
      }, DELETE);
    } else {
      msg = (msg + 1) % TYPEWRITER_MESSAGES.length;
      mode = 'typing';
      draw();
      tick();
    }
  };
  const first = host.querySelector<HTMLElement>(':scope > span')?.textContent ?? '';
  msg = Math.max(0, TYPEWRITER_MESSAGES.indexOf(first));
  draw();
  live.textContent = '';
  tick();
  let on = true;
  const blink = window.setInterval(() => {
    on = !on;
    cursor.style.opacity = on ? '1' : '0';
  }, BLINK);
  return () => {
    clearTimeout(timer);
    clearInterval(blink);
  };
}
