import { useRef } from 'react';
import { useBreakpoint } from '../../../components/marketing/motion';
import { useShaderHosts } from '../shaders';
import { applyExceptions } from './exceptions';
import { rootClass, trees, wrapClass } from './markup';
import './old.css';

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
