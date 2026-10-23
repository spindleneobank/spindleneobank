import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { MAIN_NAV } from '../content/nav';
import { PixelIcon } from './PixelIcon';

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sp-header">
      <div className="sp-header-inner">
        <Link to="/" className="sp-brand" aria-label="Spindle home">
          <img src="/assets/brand/mark.svg" alt="" width={28} height={28} />
          <span>Spindle</span>
        </Link>
        <nav className="sp-nav" aria-label="Primary">
          {MAIN_NAV.map((n) => (
            <a key={n.to} href={n.to}>
              {n.label}
            </a>
          ))}
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
        {MAIN_NAV.map((n) => (
          <a key={n.to} href={n.to} onClick={() => setOpen(false)}>
            {n.label}
          </a>
        ))}
        <Link to="/dashboard/$tab" params={{ tab: 'overview' }} onClick={() => setOpen(false)}>
          Open dashboard
        </Link>
      </nav>
    </header>
  );
}
