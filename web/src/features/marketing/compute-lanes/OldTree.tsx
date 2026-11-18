import { useEffect, useRef } from 'react';
import { useBreakpoint } from '../../../components/marketing/motion';
import { attachNumberShadows, runAppear, runBorderFade } from '../appear';
import { useShaderHosts } from '../shaders';
import { applyExceptions } from './exceptions';
import { runFaq } from './faq';
import { rootClass, trees, wrapClass } from './markup';
import { runSlider } from './slider';
import './old.css';
import './extra.css';

/**
 * Page body rebuilt from the old site's rendered DOM (Framer layer tree after hydration, one per breakpoint).
 * The old wrapper is `display: contents`, so its sections are direct children of the page root, as before.
 * Approved text exceptions are applied here (see docs/plan/parity-text-exceptions.md).
 */

export function OldTree() {
  const bp = useBreakpoint();
  const html = applyExceptions(trees[bp] ?? trees.all ?? '');
  const ref = useRef<HTMLDivElement>(null);
  const shaders = useShaderHosts(ref, bp);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stops = [attachNumberShadows(el), runAppear(el), runBorderFade(el), runFaq(el), runSlider(el, bp)];
    return () => {
      for (const s of stops) s();
    };
  }, [bp]);
  return (
    <div className={rootClass} data-p5-root ref={ref}>
      <div
        data-framer-root=""
        className={wrapClass}
        style={{ display: 'contents' }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {shaders}
    </div>
  );
}
