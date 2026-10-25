/**
 * Behaviours for the rendered home markup: tabs, FAQ accordion and in-view videos.
 * Tab/accordion states are recorded snapshots of the old DOM; `morph` patches the live DOM in place so inline-style
 * transitions (the tab indicator, accordion icon) still animate.
 */
import { springEasing } from '../../../components/marketing/motion/framer';

export type GroupStates = Record<string, Array<{ key: string; html: string }>>;

export function morph(live: Element, next: Element) {
  for (const a of Array.from(live.attributes)) if (!next.hasAttribute(a.name)) live.removeAttribute(a.name);
  for (const a of Array.from(next.attributes))
    if (live.getAttribute(a.name) !== a.value) live.setAttribute(a.name, a.value);
  const lc = Array.from(live.childNodes);
  const nc = Array.from(next.childNodes);
  const same =
    lc.length === nc.length &&
    lc.every(
      (n, i) =>
        n.nodeType === nc[i]?.nodeType &&
        (n.nodeType !== 1 || (n as Element).tagName === (nc[i] as Element).tagName),
    );
  if (!same) {
    live.replaceChildren(...nc.map((n) => n.cloneNode(true)));
    return;
  }
  lc.forEach((n, i) => {
    const m = nc[i] as Node;
    if (n.nodeType === 1) morph(n as Element, m as Element);
    else if (n.nodeType === 3 && n.nodeValue !== m.nodeValue) n.nodeValue = m.nodeValue;
  });
}

/**
 * Framer spring {bounce 0, duration 0.6} as measured on the old "Explore the paths" cards: critically damped, w = 15 rad/s
 * (width of the opened card follows 1 - (1 + 15t) e^(-15t); t90 = 260ms, t99 = 450ms as recorded), sampled as linear().
 */
const PATHS_MS = 600;
const PATHS_EASING = springEasing(15, PATHS_MS);

export function snapshot(html: string): Element {
  const t = document.createElement('template');
  t.innerHTML = html;
  return t.content.firstElementChild as Element;
}

export function initGroups(tree: HTMLElement, states: GroupStates): () => void {
  const off: Array<() => void> = [];
  for (const [id, list] of Object.entries(states)) {
    const root = tree.querySelector<HTMLElement>(`[data-hm-grp="${id}"]`);
    if (!root) continue;
    const apply = (key: string) => {
      const s = list.find((x) => x.key === key);
      if (s) morph(root, snapshot(s.html));
    };
    if (id === 'paths') {
      // Hovering a card makes it the open one (and it stays open): 'Step 1' (first card) .. 'Step 3'. The cards resize
      // along the main axis (width on desktop, height when stacked) with the 0.6s spring, inner fades use it too.
      let cur = '0';
      const onOver = (e: Event) => {
        const card = Array.from(root.children).find((c) => c.contains(e.target as Node));
        if (!card) return;
        const key = String(Array.from(root.children).indexOf(card));
        if (key === cur) return;
        cur = key;
        const kids = Array.from(root.children) as HTMLElement[];
        const vertical = kids[0] ? kids[0].getBoundingClientRect().width >= root.getBoundingClientRect().width - 1 : false;
        const before = kids.map((k) => k.getBoundingClientRect());
        const fades = new Map<Element, string>();
        for (const el of root.querySelectorAll<HTMLElement>('[style*="opacity"]')) fades.set(el, el.style.opacity);
        apply(key);
        const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduce) return;
        const kids2 = Array.from(root.children) as HTMLElement[];
        kids2.forEach((k, i) => {
          const from = before[i];
          const to = k.getBoundingClientRect();
          if (!from) return;
          const prop = vertical ? 'height' : 'width';
          const a = vertical ? from.height : from.width;
          const b = vertical ? to.height : to.width;
          if (Math.abs(a - b) < 0.5) return;
          k.animate({ [prop]: [`${a}px`, `${b}px`], flex: ['none', 'none'] }, { duration: PATHS_MS, easing: PATHS_EASING });
        });
        for (const [el, o] of fades) {
          if (!el.isConnected || el.style.opacity === o) continue;
          el.animate([{ opacity: o || 1 }, { opacity: el.style.opacity || 1 }], {
            duration: PATHS_MS,
            easing: PATHS_EASING,
          });
        }
      };
      root.addEventListener('mouseover', onOver);
      off.push(() => root.removeEventListener('mouseover', onOver));
    } else if (id.startsWith('tabs')) {
      const onClick = (e: Event) => {
        const tab = (e.target as Element).closest('[role=tab]');
        if (!tab || !root.contains(tab)) return;
        apply(String(Array.from(root.querySelectorAll('[role=tab]')).indexOf(tab)));
      };
      root.addEventListener('click', onClick);
      off.push(() => root.removeEventListener('click', onClick));
    } else if (id === 'faq') {
      const items = () => Array.from(root.querySelectorAll<HTMLElement>('[role=button][aria-expanded]'));
      const onClick = (e: Event) => {
        const it = (e.target as Element).closest<HTMLElement>('[role=button][aria-expanded]');
        if (!it || !root.contains(it)) return;
        const i = items().indexOf(it);
        // snapshots: 'init' = item 0 open; '0' = all closed; 'i' = item i open.
        const open = items().findIndex((x) => x.getAttribute('aria-expanded') === 'true');
        const before = items().map((x) => x.getBoundingClientRect().height);
        if (open === i) apply('0');
        else apply(i === 0 ? 'init' : String(i));
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        // Old Framer accordion: each item's height tweens 0.3s cubic-bezier(.44, 0, .56, 1) (the item clips its content).
        items().forEach((x, n) => {
          const from = before[n];
          const to = x.getBoundingClientRect().height;
          if (from === undefined || Math.abs(from - to) < 0.5) return;
          x.animate({ height: [`${from}px`, `${to}px`] }, { duration: 300, easing: 'cubic-bezier(0.44, 0, 0.56, 1)' });
        });
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          const it = (e.target as Element).closest('[role=button][aria-expanded]');
          if (it) {
            e.preventDefault();
            onClick(e);
          }
        }
      };
      root.addEventListener('click', onClick);
      root.addEventListener('keydown', onKey);
      off.push(() => {
        root.removeEventListener('click', onClick);
        root.removeEventListener('keydown', onKey);
      });
    }
  }
  return () => {
    for (const f of off) f();
  };
}

/** Port of spindle.js video handling: muted loops, source set on first view, paused offscreen/hidden/reduced motion. */
export function initVideos(tree: HTMLElement): () => void {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const mobile = matchMedia('(max-width: 809px)');
  const play = (v: HTMLVideoElement) => {
    if (document.hidden || reduced.matches || v.dataset.spInView !== '1') return;
    if (!v.getAttribute('src')) {
      v.src = mobile.matches && v.dataset.spMobile ? v.dataset.spMobile : (v.dataset.spSource ?? '');
      v.load();
    }
    v.muted = true;
    void v.play().catch(() => {});
  };
  const vids = Array.from(tree.querySelectorAll<HTMLVideoElement>('video'));
  for (const v of vids) {
    v.muted = true;
    const flag = () => {
      // Old page: Framer swaps the poster <img> node on tablet/phone hydration, so below the desktop breakpoint the
      // poster stays visible (the loaded video covers it either way). Desktop hides it once the video has loaded.
      if (!matchMedia('(min-width: 1200px)').matches) return;
      const img = v.parentElement?.querySelector('img');
      if (img) img.dataset.spVideo = '1';
    };
    v.addEventListener('loadeddata', flag);
    if (v.readyState >= 2) flag();
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const v = e.target as HTMLVideoElement;
        v.dataset.spInView = e.isIntersecting ? '1' : '0';
        if (e.isIntersecting) play(v);
        else v.pause();
      }
    },
    { rootMargin: '180px' },
  );
  for (const v of vids) io.observe(v);
  const vis = () => {
    for (const v of vids) {
      if (document.hidden) v.pause();
      else play(v);
    }
  };
  document.addEventListener('visibilitychange', vis);
  return () => {
    io.disconnect();
    document.removeEventListener('visibilitychange', vis);
  };
}
