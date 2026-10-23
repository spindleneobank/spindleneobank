import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { type Breakpoint, useBreakpoint } from '../../../components/marketing/motion';
import desktopHtml from './markup/desktop.html?raw';
import phoneHtml from './markup/phone.html?raw';
import tabletHtml from './markup/tablet.html?raw';
import './home.generated.css';
import './home.css';

const TREES: Record<Breakpoint, string> = { desktop: desktopHtml, tablet: tabletHtml, phone: phoneHtml };
const ORDER: Breakpoint[] = ['desktop', 'tablet', 'phone'];

/**
 * Home page body. The markup is the rendered DOM of the old site per Framer breakpoint (one tree each); the server
 * renders all three (hidden by media query, like Framer's SSR variants) and after hydration only the active one stays.
 */
export function HomePage() {
  const bp = useBreakpoint();
  const [live, setLive] = useState(false);
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => setLive(true), []);

  // Internal links go through the router (no full reload), everything else behaves as a normal link.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element).closest('a[href]');
      if (!a || a.getAttribute('target') === '_blank') return;
      const href = a.getAttribute('href') ?? '';
      if (!href || href.startsWith('#') || /^[a-z]+:/i.test(href) || href.startsWith('//')) return;
      const path = new URL(href, location.href).pathname;
      if (path.startsWith('/dashboard')) return;
      e.preventDefault();
      void navigate({ to: path });
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, [navigate]);

  return (
    <div
      ref={rootRef}
      className="framer-x8qsM framer-g5ch1c"
      data-layout-template="true"
      style={{ minHeight: '100vh', width: 'auto' }}
    >
      {ORDER.filter((k) => !live || k === bp).map((k) => (
        <div
          key={k}
          data-framer-root=""
          data-hm-tree={k}
          className="framer-VSipU framer-CN5FS framer-XY1Uj framer-wDRoJ framer-D72R9 framer-IakAr framer-F7K8o framer-72rtr7"
          style={{ minHeight: '100vh', width: 'auto', display: 'contents' }}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: static markup generated from the old rendered DOM, no user input
          dangerouslySetInnerHTML={{ __html: TREES[k] }}
        />
      ))}
    </div>
  );
}
