import type { ReactNode } from 'react';
import { LiquidMetal } from '../../../components/marketing/motion';
import tree from '../../../content/marketing/product-tree.json';
import { HeroShader } from './HeroShader';
import { type Override, type PNode, renderNode } from './render';
import './product.css';
import './product-extra.css';

const data = tree as unknown as {
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

const override: Override = (el, key): ReactNode | undefined => {
  const p = el[1] as Record<string, unknown> | 0;
  if (p && typeof p['data-pp-html'] === 'string')
    // biome-ignore lint/security/noDangerouslySetInnerHtml: static SVG templates extracted from the old page
    return <div key={key} id="pp-svg-templates" aria-hidden="true" style={p.style as never} dangerouslySetInnerHTML={{ __html: p['data-pp-html'] }} />;
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
  return (
    <div className={`pp-scope ${data.root.cls.split(/\s+/).slice(0, 2).join(' ')}`} style={data.root.style}>
      {renderNode(withTemplates(data.tree, tpl), 'root', '', override)}
    </div>
  );
}
