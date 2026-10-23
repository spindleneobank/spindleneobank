import { createFileRoute } from '@tanstack/react-router';
import { ApiConsole } from '../../components/ApiConsole';
import { CTA } from '../../components/CTA';
import { DashboardPreview } from '../../components/DashboardPreview';
import { Eyebrow } from '../../components/Eyebrow';

export const Route = createFileRoute('/(marketing)/')({ component: Home });

/** PLACEHOLDER: F0m replaces this with the real landing page. Kept minimal so the scaffold prerenders content. */
function Home() {
  return (
    <>
      <div className="sp-container sp-placeholder">
        <Eyebrow tone="light">Spindle / compute payouts</Eyebrow>
        <h1>A neobank for GPU work. Earn in USDG.</h1>
        <p className="sp-lead">Placeholder home page. Marketing content lands in F0m.</p>
        <div>
          <CTA to="/dashboard/overview">Open dashboard</CTA>
        </div>
      </div>
      <div className="sp-container" style={{ display: 'grid', gap: 24, paddingBottom: 72 }}>
        <DashboardPreview />
        <ApiConsole />
      </div>
    </>
  );
}
