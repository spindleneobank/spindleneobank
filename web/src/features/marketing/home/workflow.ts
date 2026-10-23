/**
 * Port of the old "Workflow" Framer code component's signal animation (trigger -> action -> approve/review -> complete).
 * Six signal dots travel along the transparent hit paths of the diagram: a square on the first two legs, then a pill
 * ("84%" approve / "16%" review) with a ten-segment streak on the last leg. All constants are the original ones.
 */
const LIFE = 6720; // Ho: lifetime of one signal
const P0 = 0; // Vo = [0, 1280, 3680, 6080]
const P1 = 1280;
const P2 = 3680;
const P3 = 6080;
const SEED_AGE = [3400, 2300, 1200]; // Yo: signals already under way at start
const SPAWN_MIN = 1360;
const SPAWN_MAX = 2160;
const STREAKS = 10;
const STREAK_LEN = 5;
const GREY = '#4a4a4a';
const RED = '#FF596B';
const DARK = '#111111';

const ease = (e: number) => (e < 0.5 ? 2 * e * e : 1 - (-2 * e + 2) ** 2 / 2);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const out3 = (e: number) => 1 - (1 - clamp01(e)) ** 3;

type Sig = {
  dot: SVGGElement;
  halo: SVGElement;
  square: SVGGElement;
  core: SVGElement;
  pill: SVGGElement;
  pillRect: SVGElement;
  pillText: SVGElement;
  streaks: SVGPathElement[]; // index = streak number (0 = nearest the head)
};

function mount(svg: SVGSVGElement): () => void {
  const hit = Array.from(svg.querySelectorAll<SVGPathElement>(':scope > path[stroke="transparent"]'));
  if (hit.length < 5) return () => {};
  const [p1, p2, p2Review, p3, p3Review] = hit as [
    SVGPathElement,
    SVGPathElement,
    SVGPathElement,
    SVGPathElement,
    SVGPathElement,
  ];
  const sigs: Sig[] = Array.from(svg.querySelectorAll<SVGGElement>(':scope > g'))
    .filter((g) => g.children.length === STREAKS + 1 && g.lastElementChild?.tagName === 'g')
    .map((g) => {
      const dot = g.lastElementChild as SVGGElement;
      const kids = Array.from(g.children).slice(0, STREAKS) as SVGPathElement[];
      const pill = dot.children[2] as SVGGElement;
      const square = dot.children[1] as SVGGElement;
      return {
        dot,
        halo: dot.children[0] as SVGElement,
        square,
        core: square.firstElementChild as SVGElement,
        pill,
        pillRect: pill.children[0] as SVGElement,
        pillText: pill.children[1] as SVGElement,
        // DOM order is streak 9 ... 0
        streaks: kids.reverse(),
      };
    });
  if (!sigs.length) return () => {};
  const gradId = svg.querySelector('linearGradient')?.id ?? '';
  const lengths = new Map<SVGPathElement, { d: string; len: number }>();
  const lengthOf = (p: SVGPathElement) => {
    const d = p.getAttribute('d') ?? '';
    if (!d) return 0;
    const c = lengths.get(p);
    if (c && c.d === d) return c.len;
    const len = p.getTotalLength();
    lengths.set(p, { d, len });
    return len;
  };
  const clearStreaks = (s: Sig) => {
    for (const e of s.streaks) {
      e.style.opacity = '0';
      e.setAttribute('d', '');
    }
  };
  const hide = (s: Sig) => {
    s.dot.style.opacity = '0';
    clearStreaks(s);
  };
  const segment = (p: SVGPathElement, from: number, to: number) => {
    if (to <= from) return '';
    let d = '';
    for (let i = 0; i <= 3; i++) {
      const pt = p.getPointAtLength(from + ((to - from) * i) / 3);
      d += i === 0 ? `M ${pt.x} ${pt.y}` : ` L ${pt.x} ${pt.y}`;
    }
    return d;
  };
  const streak = (s: Sig, p: SVGPathElement, prog: number, color: string, alpha: number) => {
    const len = lengthOf(p);
    if (!Number.isFinite(len) || len <= 0) return clearStreaks(s);
    const at = clamp01(prog) * len;
    s.streaks.forEach((e, n) => {
      const head = at - n * STREAK_LEN;
      const tail = head - STREAK_LEN;
      if (head <= 0) {
        e.style.opacity = '0';
        e.setAttribute('d', '');
        return;
      }
      e.setAttribute('d', segment(p, Math.max(0, tail), Math.min(len, head)));
      e.style.stroke = color;
      e.style.opacity = `${Math.max(0, (1 - n / STREAKS) * 0.85 * alpha)}`;
    });
  };
  const color = (stage: number, branch: string) =>
    stage === 1 ? GREY : stage === 2 ? RED : branch === 'approve' ? DARK : RED;
  for (const p of hit) p.style.opacity = '1';

  const slots: Array<{ startAt: number; branch: 'approve' | 'review' } | null> = sigs.map(() => null);
  let nextSpawn = 0;
  let started = false;
  const spawn = (now: number, age: number) => {
    const i = slots.findIndex((s) => s === null);
    if (i < 0) return false;
    const branch = Math.random() < 0.84 ? 'approve' : 'review';
    slots[i] = { startAt: now - age, branch };
    const txt = branch === 'approve' ? '84%' : '16%';
    const pt = (sigs[i] as Sig).pillText;
    if (pt.textContent !== txt) pt.textContent = txt;
    return true;
  };
  let raf = 0;
  let visible = false;
  const frame = (now: number) => {
    raf = 0;
    if (!visible || document.hidden) return;
    if (!started) {
      started = true;
      for (const a of SEED_AGE) spawn(now, a);
      nextSpawn = now;
    }
    if (now >= nextSpawn && spawn(now, 0))
      nextSpawn = now + SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
    sigs.forEach((s, c) => {
      const slot = slots[c];
      if (!slot) return;
      const age = now - slot.startAt;
      if (age >= LIFE) {
        slots[c] = null;
        hide(s);
        return;
      }
      const approve = slot.branch === 'approve';
      const second = approve ? p2 : p2Review;
      const third = approve ? p3 : p3Review;
      let stage: number;
      let path: SVGPathElement;
      let t: number;
      if (age < P1) {
        stage = 1;
        path = p1;
        t = age / (P1 - P0);
      } else if (age < P2) {
        stage = 2;
        path = second;
        t = (age - P1) / (P2 - P1);
      } else if (age < P3) {
        stage = 3;
        path = third;
        t = (age - P2) / (P3 - P2);
      } else {
        stage = 3;
        path = third;
        t = 1;
      }
      const eased = ease(t);
      const col = color(stage, slot.branch);
      const fade = age > P3 ? 1 - (age - P3) / (LIFE - P3) : 1;
      const wob = 1 + 0.1 * Math.sin(now / 110 + c * 1.7);
      const scale =
        stage < 3
          ? Math.min(out3(t / 0.25), 1 - clamp01((t - 0.75) / 0.25) ** 3)
          : (0.4 + 0.6 * out3((age - P2) / 480)) * fade * wob;
      if (s.dot.style.opacity !== '1') s.dot.style.opacity = '1';
      const len = lengthOf(path);
      if (!Number.isFinite(len) || len <= 0) s.dot.style.opacity = '0';
      else {
        const pt = path.getPointAtLength(clamp01(eased) * len);
        s.dot.setAttribute('transform', `translate(${pt.x} ${pt.y}) scale(${scale})`);
      }
      const sq = stage < 3 ? 'block' : 'none';
      const pl = stage === 3 ? 'block' : 'none';
      if (s.square.style.display !== sq) s.square.style.display = sq;
      if (s.pill.style.display !== pl) s.pill.style.display = pl;
      const fill = `url(#${gradId})`;
      if (s.core.getAttribute('fill') !== fill) s.core.setAttribute('fill', fill);
      if (s.pillRect.getAttribute('fill') !== col) s.pillRect.setAttribute('fill', col);
      if (stage < 3) {
        if (s.halo.style.opacity !== '0') s.halo.style.opacity = '0';
        clearStreaks(s);
      } else {
        if (s.halo.style.color !== col) s.halo.style.color = col;
        s.halo.style.opacity = `${0.55 + 0.25 * Math.sin(now / 180 + c)}`;
        streak(s, path, eased, col, Math.max(0, fade));
      }
    });
    raf = requestAnimationFrame(frame);
  };
  const wake = () => {
    if (!raf && visible && !document.hidden) raf = requestAnimationFrame(frame);
  };
  const io = new IntersectionObserver((e) => {
    visible = e[0]?.isIntersecting === true;
    if (visible) wake();
  });
  io.observe(svg);
  document.addEventListener('visibilitychange', wake);
  return () => {
    io.disconnect();
    cancelAnimationFrame(raf);
    document.removeEventListener('visibilitychange', wake);
    for (const s of sigs) hide(s);
  };
}

export function initWorkflow(tree: HTMLElement): () => void {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};
  const offs = Array.from(tree.querySelectorAll<SVGSVGElement>('svg[data-workflow-overlay]')).map(mount);
  return () => {
    for (const o of offs) o();
  };
}
