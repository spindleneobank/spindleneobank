import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Appear, LiquidMetal } from '../../../components/marketing/motion';
import tree from '../../../content/marketing/product-tree.json';
import { ChatPanel } from './ChatPanel';
import { HeroShader } from './HeroShader';
import { type Override, type PNode, renderNode } from './render';
import { TabGroup } from './TabGroup';
import { Typewriter } from './Typewriter';
import { useHeroGraph } from './useHeroGraph';
import { useMotionVisible } from './useMotionVisible';
import { useOrbit } from './useOrbit';
import { useReceiptEnter } from './useReceiptEnter';
import { useSlideshow } from './useSlideshow';
import { useVisibleBox } from './useVisibleBox';
import { useWorkflowSignal } from './useWorkflowSignal';
import './product.css';
import './product-extra.css';

const data = tree as unknown as {
  chat: { names: string[]; states: PNode[] } | null;
  tabs: { states: PNode[] } | null;
  faq: { initial: number; single: boolean; items: { opened: PNode; closed: PNode }[] } | null;
  root: { cls: string; style: Record<string, string> };
  tree: PNode;
  templates: Record<string, string>;
};

/** Liquid Metal settings of the old Framer instances (angle, distortion, softness, speed). */
/** LiquidMetal host that only mounts its canvas while the node has a layout box (hidden breakpoint variants stay empty). */
function Metal({ m }: { m: { angle: number; distortion: number; softness: number; speed: number } }) {
  const ref = useRef<HTMLDivElement>(null);
  const on = useVisibleBox(ref);
  return (
    <div
      ref={ref}
      style={{
        position: 'relative',
        display: 'block',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: 'transparent',
      }}
    >
      {on ? <LiquidMetal {...m} /> : null}
    </div>
  );
}

const METAL: Record<string, { angle: number; distortion: number; softness: number; speed: number }> = {
  badge: { angle: 70, distortion: 0.01, softness: 0.1, speed: 1.4 },
  button: { angle: 45, distortion: 0.08, softness: 0.1, speed: 1 },
  card: { angle: 70, distortion: 0.07, softness: 0.1, speed: 0.6 },
  mark: { angle: 70, distortion: 0.07, softness: 0.1, speed: 1 },
};

/** Framer appear animation of the quote block (`__framer__appearAnimationsContent`, same values on all breakpoints). */
const APPEAR = {
  initial: { opacity: 0.001, x: 0, y: 0, scale: 1, rotate: 0 },
  animate: { opacity: 1, x: 0, y: 0, scale: 1, rotate: 0 },
  transition: { type: 'spring', bounce: 0, delay: 0.2, duration: 0.6 },
};

/** Builds the tree override; `faqOpen`/`toggleFaq` drive the single-open accordion (old Framer FAQ variants). */
const makeOverride =
  (faqOpen: number, toggleFaq: (i: number) => void): Override =>
  (el, key, kids): ReactNode | undefined => {
    const p = el[1] as Record<string, unknown> | 0;
    if (p && typeof p['data-pp-html'] === 'string')
      // biome-ignore lint/security/noDangerouslySetInnerHtml: static SVG templates extracted from the old page
      return (
        <div
          key={key}
          id="pp-svg-templates"
          aria-hidden="true"
          style={p.style as never}
          dangerouslySetInnerHTML={{ __html: p['data-pp-html'] }}
        />
      );
    if (p && p['data-pp-faq'] && data.faq) {
      const i = Number(p['data-pp-faq']) - 1;
      const item = data.faq.items[i];
      if (!item) return undefined;
      const open = faqOpen === i;
      return (
        // biome-ignore lint/a11y/useKeyWithClickEvents: the question header is the old Framer tap target; its inner button is focusable
        <div
          key={key}
          data-pp-faq-item={i}
          style={{ display: 'contents' }}
          onClick={(e) => {
            if ((e.target as Element).closest('[data-framer-name="Question"]')) toggleFaq(i);
          }}
        >
          {renderNode(open ? item.opened : item.closed, `faq${i}${open ? 'o' : 'c'}`, `faq${i}`, undefined)}
        </div>
      );
    }
    if (p && p['data-pp-tabs'] && data.tabs)
      return <TabGroup key={key} states={data.tabs.states} override={chatOverride} />;
    if (p && p['data-pp-typewriter'])
      return (
        <Typewriter
          key={key}
          style={p.style as never}
          cursor={JSON.parse(String(p['data-pp-cursor'] ?? '{}'))}
        />
      );
    if (p && p['data-pp-chat'] && data.chat)
      return <ChatPanel key={key} states={data.chat.states} override={chatOverride} />;
    if (p && typeof p.className === 'string' && p.className.split(' ').includes('framer-1uny542'))
      return (
        <Appear key={key} as={el[0] as 'div'} spec={APPEAR} className={p.className} style={p.style as never}>
          {kids}
        </Appear>
      );
    const kind = p ? (p['data-pp-shader'] as string | undefined) : undefined;
    if (!kind) return undefined;
    if (kind === 'hero') return <HeroShader key={key} />;
    const m = METAL[kind];
    return m ? <Metal key={key} m={m} /> : undefined;
  };

/** The hidden SVG template block is the wrapper's last child so the page body stays a single flat list of sections. */
function withTemplates(t: PNode, tpl: string): PNode {
  if (!Array.isArray(t)) return t;
  const box: PNode = [
    'div',
    {
      id: 'pp-svg-templates',
      'aria-hidden': 'true',
      style: {
        position: 'absolute',
        overflow: 'hidden',
        bottom: 0,
        left: 0,
        width: 0,
        height: 0,
        zIndex: 0,
        contain: 'strict',
      },
      'data-pp-html': tpl,
    },
  ];
  return [...t, box] as PNode;
}

const FAQ_EASE = 'cubic-bezier(0.44, 0, 0.56, 1)';

/** Heights of the laid-out FAQ item boxes (`item:child`); empty with reduced motion so the accordion just snaps. */
function faqHeights(root: HTMLElement | null): Map<string, number> {
  const m = new Map<string, number>();
  if (!root || matchMedia('(prefers-reduced-motion: reduce)').matches) return m;
  for (const w of root.querySelectorAll<HTMLElement>('[data-pp-faq-item]'))
    [...w.children].forEach((k, c) => {
      const h = k.getBoundingClientRect().height;
      if (h > 0) m.set(`${w.dataset.ppFaqItem}:${c}`, h);
    });
  return m;
}

const chatOverride: Override = makeOverride(-1, () => {});

export function ProductBody() {
  const [faqOpen, setFaqOpen] = useState(data.faq?.initial ?? -1);
  const root = useRef<HTMLDivElement>(null);
  const faqBefore = useRef<Map<string, number> | null>(null);
  const toggleFaq = (i: number) => {
    // item heights before the swap; the layout effect below tweens every item from there to its new height
    faqBefore.current = faqHeights(root.current);
    setFaqOpen((c) => (c === i ? -1 : i));
  };
  const override = makeOverride(faqOpen, toggleFaq);
  const tpl = Object.values(data.templates).join('');
  // Old Framer FAQ: the item height tweens 0.3 s cubic-bezier(.44, 0, .56, 1) (measured: 210 -> 74 px and 74 -> 186 px
  // run together, the closing item's answer is removed at once and the opening item's is clipped by the growing box).
  useLayoutEffect(() => {
    const before = faqBefore.current;
    faqBefore.current = null;
    if (!before) return;
    const now = faqHeights(root.current);
    for (const [k, to] of now) {
      const from = before.get(k);
      const [i, c] = k.split(':').map(Number);
      const el = root.current?.querySelector(`[data-pp-faq-item="${i}"]`)?.children[c as number] as HTMLElement | undefined;
      if (el && from && Math.abs(from - to) > 1)
        el.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: 300, easing: FAQ_EASE });
    }
  }, [faqOpen]);
  useMotionVisible(root);
  useOrbit(root);
  useHeroGraph(root);
  useWorkflowSignal(root);
  useSlideshow(root);
  useReceiptEnter(root);
  // Framer's appear also animates `transform` (none -> none, same spring timing) next to opacity
  useEffect(() => {
    const el = root.current;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const q of el.querySelectorAll<HTMLElement>('.framer-1uny542')) {
      q.animate(
        { transform: ['none', 'none'] },
        { delay: 200, duration: 600, easing: 'linear', fill: 'both' },
      );
    }
  }, []);
  return (
    <div
      ref={root}
      className={`pp-scope ${data.root.cls.split(/\s+/).slice(0, 2).join(' ')}`}
      style={data.root.style}
    >
      {renderNode(withTemplates(data.tree, tpl), 'root', '', override)}
    </div>
  );
}
