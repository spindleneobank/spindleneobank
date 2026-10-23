import { Money } from './Money';
import { PixelIcon } from './PixelIcon';

const NAV = ['overview', 'earnings', 'cards', 'payouts', 'receipts', 'nodes'] as const;

/** Static, illustrative dashboard mock for marketing pages. No data fetching; sample numbers only. */
export function DashboardPreview() {
  return (
    <div className="sp-dprev" role="img" aria-label="Illustrative Spindle dashboard preview, sample data">
      <aside>
        {NAV.map((n, i) => (
          <span key={n} className={i === 0 ? 'on' : ''}>
            <PixelIcon name={n} size={14} />
          </span>
        ))}
      </aside>
      <div className="sp-dprev-main">
        <small>USDG ACCOUNT · SAMPLE</small>
        <strong>
          <Money micros="1284500000" unit={null} />
          <em> USDG</em>
        </strong>
        <div className="sp-dprev-bars" aria-hidden="true">
          {[34, 52, 41, 66, 58, 77, 64, 88, 72, 95].map((h, i) => (
            <i key={`${i}-${h}`} style={{ height: `${h}%` }} />
          ))}
        </div>
        <small>Signed receipts · hourly epochs</small>
      </div>
    </div>
  );
}
