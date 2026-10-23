/**
 * Behaviours for the rendered home markup: tabs, FAQ accordion and in-view videos.
 * Tab/accordion states are recorded snapshots of the old DOM; `morph` patches the live DOM in place so inline-style
 * transitions (the tab indicator, accordion icon) still animate.
 */
export type GroupStates = Record<string, Array<{ key: string; html: string }>>;

export function morph(live: Element, next: Element) {
  for (const a of Array.from(live.attributes)) if (!next.hasAttribute(a.name)) live.removeAttribute(a.name);
  for (const a of Array.from(next.attributes)) if (live.getAttribute(a.name) !== a.value) live.setAttribute(a.name, a.value);
  const lc = Array.from(live.childNodes);
  const nc = Array.from(next.childNodes);
  const same = lc.length === nc.length && lc.every((n, i) => n.nodeType === nc[i]?.nodeType && (n.nodeType !== 1 || (n as Element).tagName === (nc[i] as Element).tagName));
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
    if (id.startsWith('tabs')) {
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
        if (open === i) apply('0');
        else apply(i === 0 ? 'init' : String(i));
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
