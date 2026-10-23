import { createRoot } from 'react-dom/client';
import { LiquidMetal } from '../../../components/marketing/motion';
import { mountHeroShader } from './heroShader';

/**
 * Replaces the empty WebGL canvases of the rendered markup with live shaders:
 * the hero Fluted Swirl, and the Liquid Metal rims behind buttons, chips and the hero mark.
 */
export function initShaders(tree: HTMLElement): () => void {
  const off: Array<() => void> = [];
  const hero = tree.querySelector<HTMLElement>('[data-framer-name="Hero Shader"] > div');
  if (hero) {
    for (const c of hero.querySelectorAll('canvas')) c.remove();
    off.push(mountHeroShader(hero));
  }
  for (const c of tree.querySelectorAll<HTMLCanvasElement>(
    '.framer-1aggivb-container canvas, .framer-86hip0-container canvas',
  )) {
    const box = c.parentElement;
    if (!box) continue;
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
    c.replaceWith(host);
    const root = createRoot(host);
    root.render(<LiquidMetal angle={45} distortion={0.08} softness={0.1} speed={1} />);
    off.push(() => queueMicrotask(() => root.unmount()));
  }
  return () => {
    for (const f of off) f();
  };
}
