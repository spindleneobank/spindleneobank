import { FOOTER_NAV } from '../content/nav';
import { EXTERNAL, SOCIALS } from './marketing/shell/nav-data';
import { PixelIcon } from './PixelIcon';

export function SiteFooter() {
  const socials = SOCIALS.map((s) => (
    <a
      key={s.key}
      href={s.href}
      {...EXTERNAL}
      className="sp-footer-social"
      aria-label={`Spindle on ${s.label}`}
    >
      <PixelIcon name={s.key} size={16} />
    </a>
  ));
  return (
    <footer className="sp-footer">
      <div className="sp-footer-frame">
        <div className="sp-container sp-footer-grid">
          <div className="sp-footer-brand">
            <a href="/" className="sp-footer-logo" aria-label="Spindle home">
              <img src="/assets/brand/mark.svg" alt="" width={24} height={24} />
              <span>Spindle</span>
            </a>
            <p>GPU compute, signed receipts and payout choice. Built on Robinhood Chain.</p>
            <div className="sp-footer-connect">
              <span>Connect</span>
              {socials}
            </div>
          </div>
          <div className="sp-footer-cols">
            {FOOTER_NAV.map((col) => (
              <nav key={col.title} aria-label={col.title}>
                <h3>{col.title}</h3>
                <ul>
                  {col.items.map((i) => (
                    <li key={i.to}>
                      <a href={i.to}>{i.label}</a>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>
        <div className="sp-container sp-footer-wordmark" aria-hidden="true">
          Spindle
        </div>
        <div className="sp-container sp-footer-legal">
          <small>© {new Date().getUTCFullYear()} Spindle Compute. Verify. Choose.</small>
          <div className="sp-footer-social-row">{socials}</div>
        </div>
      </div>
    </footer>
  );
}
