import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { type Breakpoint, useBreakpoint } from '../../../components/marketing/motion';
import desktopHtml from './markup/desktop.html?raw';
import phoneHtml from './markup/phone.html?raw';
import tabletHtml from './markup/tablet.html?raw';
import desktopStates from './markup/desktop.states.json';
import phoneStates from './markup/phone.states.json';
import tabletStates from './markup/tablet.states.json';
import { type GroupStates, initGroups, initVideos } from './behaviors';
import { initApiConsole, initCapabilityNav, initOrbit } from './motion';
import { initShaders } from './shaders';
import { mountDigitalPreview } from './digitalPreview';
import './home.generated.css';
import './home.css';

const TREES: Record<Breakpoint, string> = { desktop: desktopHtml, tablet: tabletHtml, phone: phoneHtml };
const STATES: Record<Breakpoint, GroupStates> = { desktop: desktopStates, tablet: tabletStates, phone: phoneStates };
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

  // Hero cursor-reveal (port of digital-previews.js) and open-the-dashboard on click / Enter / Space.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || !live) return;
    const disposers: Array<() => void> = [];
    const open = (host: Element) => {
      const to = (host as HTMLElement).dataset.spDashboardPreview === 'footer' ? '/dashboard?tab=cards' : '/dashboard';
      location.assign(to);
    };
    const onClick = (e: MouseEvent) => {
      const host = (e.target as Element).closest('[data-sp-dashboard-preview]');
      if (host && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        open(host);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      const host = (e.target as Element).closest('[data-sp-dashboard-preview]');
      if (host && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        open(host);
      }
    };
    const tree = el.querySelector<HTMLElement>(`[data-hm-tree="${bp}"]`);
    if (tree) {
      disposers.push(initGroups(tree, STATES[bp]));
      disposers.push(initVideos(tree));
      disposers.push(initOrbit(tree), initApiConsole(tree), initCapabilityNav(tree), initShaders(tree));
    }
    for (const host of el.querySelectorAll<HTMLElement>('[data-sp-dashboard-preview]')) disposers.push(mountDigitalPreview(host));
    el.addEventListener('click', onClick, true);
    el.addEventListener('keydown', onKey, true);
    return () => {
      for (const d of disposers) d();
      el.removeEventListener('click', onClick, true);
      el.removeEventListener('keydown', onKey, true);
    };
  }, [live, bp]);

  return (
    <div
      ref={rootRef}
      className="framer-x8qsM framer-g5ch1c"
      data-layout-template="true"
      data-hm-page="home"
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
