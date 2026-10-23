import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBreakpoint } from '../../../components/marketing/motion';
import { ComingDialog } from '../../../components/marketing/shell';
import { SOCIALS } from '../../../components/marketing/shell/nav-data';
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
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [what, setWhat] = useState<(typeof SOCIALS)[number] | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // old spindle.js coming(): social buttons open the "coming soon" dialog
    const onClick = (e: Event) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-sp-social]');
      const s = b && SOCIALS.find((x) => x.key === b.dataset.spSocial);
      if (s) {
        e.preventDefault();
        setWhat(s);
      }
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, []);
  return (
    <div className={rootClass} data-p5-root ref={ref}>
      <div
        data-framer-root=""
        className={wrapClass}
        style={{ display: 'contents' }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {shaders}
      {typeof document !== 'undefined' && mounted
        ? createPortal(<ComingDialog what={what} onClose={() => setWhat(null)} />, document.body)
        : null}
    </div>
  );
}
