import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { HEADER_NAV, type HeaderNavEntry } from '../content/nav';
import { PixelIcon } from './PixelIcon';

const href = (to: string, hash?: string) => (hash ? `${to}#${hash}` : to);

function NavMenu({
  entry,
  open,
  onToggle,
  onClose,
}: {
  entry: Extract<HeaderNavEntry, { kind: 'menu' }>;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const id = `sp-dd-${entry.label.toLowerCase()}`;
  return (
    <div className="sp-dd" data-open={open || undefined} data-wide={entry.aside ? 'yes' : undefined}>
      <button type="button" className="sp-dd-btn" aria-expanded={open} aria-controls={id} onClick={onToggle}>
        {entry.label}
        <PixelIcon name="chevron-down" size={10} />
      </button>
      <div id={id} className="sp-dd-panel">
        <ul>
          {entry.items.map((i) => (
            <li key={i.label}>
              <a href={href(i.to, i.hash)} onClick={onClose}>
                <strong>{i.label}</strong>
                <span>{i.note}</span>
              </a>
            </li>
          ))}
        </ul>
        {entry.aside ? (
          <div className="sp-dd-aside">
            <p>{entry.aside.title}</p>
            <a href={entry.aside.to} onClick={onClose}>
              {entry.aside.label}
            </a>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null);
    const onDown = (e: MouseEvent) => {
      if (!navRef.current?.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [menu]);

  return (
    <header className="sp-header">
      <div className="sp-header-inner">
        <Link to="/" className="sp-brand" aria-label="Spindle home">
          <img src="/assets/brand/mark.svg" alt="" width={28} height={28} />
          <span>Spindle</span>
        </Link>
        <nav className="sp-nav" aria-label="Primary" ref={navRef}>
          {HEADER_NAV.map((n) =>
            n.kind === 'link' ? (
              <a key={n.to} href={n.to}>
                {n.label}
              </a>
            ) : (
              <NavMenu
                key={n.label}
                entry={n}
                open={menu === n.label}
                onToggle={() => setMenu((m) => (m === n.label ? null : n.label))}
                onClose={() => setMenu(null)}
              />
            ),
          )}
        </nav>
        <Link to="/dashboard/$tab" params={{ tab: 'overview' }} className="sp-header-cta">
          Open dashboard
        </Link>
        <button
          type="button"
          className="sp-menu-btn"
          aria-expanded={open}
          aria-controls="sp-mobile-menu"
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((o) => !o)}
        >
          <PixelIcon name={open ? 'close' : 'menu'} size={20} />
        </button>
      </div>
      <nav id="sp-mobile-menu" className="sp-mobile-menu" aria-label="Mobile" hidden={!open}>
        {HEADER_NAV.map((n) =>
          n.kind === 'link' ? (
            <a key={n.to} href={n.to} onClick={() => setOpen(false)}>
              {n.label}
            </a>
          ) : (
            <div key={n.label} className="sp-mobile-group">
              <p>{n.label}</p>
              {n.items.map((i) => (
                <a key={i.label} href={href(i.to, i.hash)} onClick={() => setOpen(false)}>
                  {i.label}
                </a>
              ))}
            </div>
          ),
        )}
        <Link
          to="/dashboard/$tab"
          params={{ tab: 'overview' }}
          className="sp-header-cta"
          onClick={() => setOpen(false)}
        >
          Open dashboard
        </Link>
      </nav>
    </header>
  );
}
