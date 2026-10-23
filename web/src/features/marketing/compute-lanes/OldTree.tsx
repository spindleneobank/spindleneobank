import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBreakpoint } from '../../../components/marketing/motion';
import { ComingDialog } from '../../../components/marketing/shell';
import { SOCIALS } from '../../../components/marketing/shell/nav-data';
import { applyExceptions } from './exceptions';
import { runFaq } from './faq';
import { runSlider } from './slider';
import { runAppear, runBorderFade } from '../appear';
import { useShaderHosts } from '../shaders';
import { rootClass, trees, wrapClass } from './markup';
import './old.css';
import './extra.css';

/**
 * Page body rebuilt from the old site's rendered DOM (Framer layer tree after hydration, one per breakpoint).
 * The old wrapper is `display: contents`, so its sections are direct children of the page root, as before.
 * Approved text exceptions are applied here (see docs/plan/parity-text-exceptions.md).
 */

export function OldTree({ onMount }: { onMount?: (root: HTMLElement) => void | (() => void) }) {
  const bp = useBreakpoint();
  const html = applyExceptions(trees[bp] ?? trees.all ?? '');
  const ref = useRef<HTMLDivElement>(null);
  const shaders = useShaderHosts(ref, bp);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stops = [runAppear(el), runBorderFade(el), runFaq(el), runSlider(el, bp)];
    return () => {
      for (const s of stops) s();
    };
  }, [bp]);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [what, setWhat] = useState<(typeof SOCIALS)[number] | null>(null);
  return (
    <div className={rootClass}
      data-p5-root
      ref={ref}
      onClick={(e) => {
        // old spindle.js coming(): social buttons open the "coming soon" dialog
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-sp-social]');
        const s = b && SOCIALS.find((x) => x.key === b.dataset.spSocial);
        if (s) {
          e.preventDefault();
          setWhat(s);
        }
      }}
    >
      <div
        data-framer-root=""
        className={wrapClass}
        style={{ display: 'contents' }}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: static markup generated from the old rendered DOM
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {shaders}
      {typeof document !== 'undefined' && mounted ? createPortal(<ComingDialog what={what} onClose={() => setWhat(null)} />, document.body) : null}
    </div>
  );
}
