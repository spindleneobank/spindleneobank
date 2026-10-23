import { FOOTER_NAV } from '../content/nav';

export function SiteFooter() {
  return (
    <footer className="sp-footer">
      <div className="sp-container sp-footer-grid">
        <div className="sp-footer-brand">
          <img src="/assets/brand/wordmark.svg" alt="Spindle" width={120} height={28} />
          <p>GPU supply, verified work, USDG payouts.</p>
        </div>
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
      <div className="sp-container sp-footer-legal">
        <small>
          © {new Date().getUTCFullYear()} Spindle. Network figures are illustrative until stated otherwise.
        </small>
      </div>
    </footer>
  );
}
