import { type ReactNode, useRef } from 'react';
import { Appear, LiquidMetal } from '../../../components/marketing/motion';
import tree from '../../../content/marketing/product-tree.json';
import { ChatPanel } from './ChatPanel';
import { HeroShader } from './HeroShader';
import { useMotionVisible } from './useMotionVisible';
import { useOrbit } from './useOrbit';
import { type Override, type PNode, renderNode } from './render';
import './product.css';
import './product-extra.css';

const data = tree as unknown as {
  chat: { names: string[]; states: PNode[] } | null;
  root: { cls: string; style: Record<string, string> };
  tree: PNode;
  templates: Record<string, string>;
};

/** Liquid Metal settings of the old Framer instances (angle, distortion, softness, speed). */
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

const override: Override = (el, key, kids): ReactNode | undefined => {
  const p = el[1] as Record<string, unknown> | 0;
  if (p && typeof p['data-pp-html'] === 'string')
    // biome-ignore lint/security/noDangerouslySetInnerHtml: static SVG templates extracted from the old page
    return <div key={key} id="pp-svg-templates" aria-hidden="true" style={p.style as never} dangerouslySetInnerHTML={{ __html: p['data-pp-html'] }} />;
  if (p && p['data-pp-chat'] && data.chat) return <ChatPanel key={key} states={data.chat.states} override={override} />;
  if (p && typeof p.className === 'string' && p.className.split(' ').includes('framer-1uny542'))
    return (
      <Appear key={key} as={el[0]} spec={APPEAR} className={p.className} style={p.style as never}>
        {kids}
      </Appear>
    );
  const kind = p ? (p['data-pp-shader'] as string | undefined) : undefined;
  if (!kind) return undefined;
  if (kind === 'hero') return <HeroShader key={key} />;
  const m = METAL[kind];
  return m ? <LiquidMetal key={key} {...m} /> : undefined;
};

/** The hidden SVG template block is the wrapper's last child so the page body stays a single flat list of sections. */
function withTemplates(t: PNode, tpl: string): PNode {
  if (!Array.isArray(t)) return t;
  const box: PNode = ['div', { id: 'pp-svg-templates', 'aria-hidden': 'true', style: { position: 'absolute', overflow: 'hidden', bottom: 0, left: 0, width: 0, height: 0, zIndex: 0, contain: 'strict' }, 'data-pp-html': tpl }];
  return [...t, box] as PNode;
}

export function ProductBody() {
  const tpl = Object.values(data.templates).join('');
  const root = useRef<HTMLDivElement>(null);
  useMotionVisible(root);
  useOrbit(root);
  return (
    <div ref={root} className={`pp-scope ${data.root.cls.split(/\s+/).slice(0, 2).join(' ')}`} style={data.root.style}>
      {renderNode(withTemplates(data.tree, tpl), 'root', '', override)}
    </div>
  );
}
