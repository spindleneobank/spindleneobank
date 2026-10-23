import { useBreakpoint } from '../../../components/marketing/motion';
import { rootClass, trees, wrapClass } from './markup';
import './old.css';

/**
 * Page body rebuilt from the old site's rendered DOM (Framer layer tree after hydration, one per breakpoint).
 * The old wrapper is `display: contents`, so its sections are direct children of the page root, as before.
 * Approved text exceptions are applied here (see docs/plan/parity-text-exceptions.md).
 */
const EXCEPTIONS: Array<[string, string]> = [
  ['serve AI jobs in a sealed or open lane', 'serve AI jobs in the open lane; sealed is in testing'],
];

function applyExceptions(html: string) {
  return EXCEPTIONS.reduce((s, [a, b]) => s.split(a).join(b), html);
}

export function OldTree({ onMount }: { onMount?: (root: HTMLElement) => void | (() => void) }) {
  const bp = useBreakpoint();
  const html = applyExceptions(trees[bp] ?? trees.all);
  return (
    <div className={rootClass} data-p5-root>
      <div
        data-framer-root=""
        className={wrapClass}
        style={{ display: 'contents' }}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: static markup generated from the old rendered DOM
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
