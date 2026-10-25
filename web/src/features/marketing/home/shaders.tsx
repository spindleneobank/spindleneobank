import { createRoot } from 'react-dom/client';
import { LiquidMetal } from '../../../components/marketing/motion';
import { mountAsciiPattern } from './asciiPattern';
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
  const ascii = tree.querySelector<HTMLCanvasElement>('.framer-1hl1ixj-container canvas');
  if (ascii) off.push(mountAsciiPattern(ascii));
  // [selector, Liquid Metal props] from the old components' props.
  const metals: Array<
    [string, { angle: number; distortion: number; softness: number; speed: number; scale: number }]
  > = [
    [
      '.framer-1aggivb-container canvas',
      { angle: 70, distortion: 0.01, softness: 0.1, speed: 1.4, scale: 0.6 },
    ],
    ['.framer-86hip0-container canvas', { angle: 45, distortion: 0.08, softness: 0.1, speed: 1, scale: 0.6 }],
    // "Register your node" centre mark
    ['.framer-1070xoh-container canvas', { angle: 70, distortion: 0.07, softness: 0.1, speed: 1, scale: 1 }],
    // compute-stack centre card
    [
      '.framer-1gko5oh-container canvas',
      { angle: 70, distortion: 0.07, softness: 0.1, speed: 0.6, scale: 1 },
    ],
  ];
  for (const [selector, props] of metals) {
    for (const c of tree.querySelectorAll<HTMLCanvasElement>(selector)) {
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
      c.replaceWith(host);
      const root = createRoot(host);
      root.render(<LiquidMetal {...props} />);
      off.push(() => queueMicrotask(() => root.unmount()));
    }
  }
  return () => {
    for (const f of off) f();
  };
}
