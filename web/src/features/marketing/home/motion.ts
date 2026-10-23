/** JS-driven motion of the old home page, ported with the original constants. Each init returns a dispose function. */

/** Framer spring (bounce 0, 0.4s) sampled as a linear() easing, as recorded on the old capability nav. */
const NAV_EASING =
  'linear(0, 0.0235, 0.083, 0.1647, 0.2582, 0.3557, 0.4517, 0.5423, 0.6252, 0.6991, 0.7636, 0.8186, 0.8647, 0.9025, 0.933, 0.9571, 0.9756, 0.9895, 0.9996, 1.0065, 1.0111, 1.0137, 1.0149, 1.0151, 1.0146, 1.0136, 1.0123, 1.0108, 1.0093, 1.0079, 1.0066, 1.0053, 1.0043, 1.0033, 1.0025, 1.0019, 1.0013, 1.0009, 1.0006, 1)';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** "Rotating Integrations": the orbit turns 12deg/s, every badge counter-rotates by orbit + arm angle. */
export function initOrbit(tree: HTMLElement): () => void {
  const orbit = tree.querySelector<HTMLElement>('[data-framer-name="Rotating Orbit"]');
  if (!orbit) return () => {};
  const arms = Array.from(orbit.querySelectorAll<HTMLElement>('[data-framer-name^="Orbit Arm"]')).map((arm) => {
    const m = /rotate\((-?[\d.]+)deg\)/.exec(arm.style.transform);
    return { badge: arm.firstElementChild as HTMLElement | null, angle: m ? Number(m[1]) : 0 };
  });
  const base = Number(/rotate\((-?[\d.]+)deg\)/.exec(orbit.style.transform)?.[1] ?? 0);
  let raf = 0;
  let visible = false;
  let t0 = 0;
  const frame = (now: number) => {
    raf = 0;
    if (!visible || document.hidden) return;
    if (!t0) t0 = now;
    const a = (base + ((now - t0) / 1000) * 12) % 360;
    orbit.style.transform = `rotate(${a}deg)`;
    for (const { badge, angle } of arms) if (badge) badge.style.transform = `rotate(${-(a + angle)}deg)`;
    raf = requestAnimationFrame(frame);
  };
  const wake = () => {
    if (!raf && visible && !document.hidden && !reduced()) {
      t0 = 0;
      raf = requestAnimationFrame(frame);
    }
  };
  const io = new IntersectionObserver((e) => {
    visible = e[0]?.isIntersecting === true;
    if (visible) wake();
    else cancelAnimationFrame(raf);
  });
  io.observe(orbit);
  document.addEventListener('visibilitychange', wake);
  return () => {
    io.disconnect();
    cancelAnimationFrame(raf);
    document.removeEventListener('visibilitychange', wake);
  };
}

const API_STAGES = [
  { name: 'Request accepted', status: '01 / REQUEST', detail: 'POST /v1/chat/completions', output: 'X-Spindle-Lane: open' },
  { name: 'Eligible GPU selected', status: '02 / ROUTE', detail: 'Attestation checked for the sealed lane.', output: 'Encrypted prompts → eligible compute' },
  { name: 'Work recorded', status: '03 / RECEIPT', detail: 'The node signs a COSE receipt for the job.', output: 'receipt.cose → verification → USDG ledger' },
  { name: 'Epoch recorded', status: '04 / CLAIM', detail: 'Verified work enters the hourly Merkle root.', output: 'USDG · Stock Tokens · Virtual Card' },
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
  const io = new IntersectionObserver((e) => {
    visible = e[0]?.isIntersecting === true;
    if (visible) play();
    else stop();
  }, { threshold: 0.1 });
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
  const links = Array.from(tree.querySelectorAll<HTMLElement>('a.framer-JhBcR')).filter((a) => /(^|\/|\.)#?(ai-analysis|realtime-dashboards|flow-automation|smart-integrations)$/.test(a.getAttribute('href') ?? ''));
  if (links.length !== ids.length) return () => {};
  let current = Math.max(0, links.findIndex((a) => a.dataset.framerName === 'Active'));
  const set = (i: number, animate: boolean) => {
    links.forEach((a, k) => {
      const on = k === i;
      const was = a.dataset.framerName === 'Active';
      if (on === was) return;
      a.dataset.framerName = on ? 'Active' : 'Inactive';
      a.classList.toggle('framer-v-1jn7imm', on);
      a.classList.toggle('framer-v-7jhj1k', !on);
      if (animate && !reduced()) a.animate({ opacity: on ? [0.4, 1] : [1, 0.4] }, { duration: 400, easing: NAV_EASING, fill: 'both' });
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
  return () => {
    removeEventListener('scroll', onScroll);
    cancelAnimationFrame(raf);
  };
}
