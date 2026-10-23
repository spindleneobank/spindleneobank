import cardsHtml from './cards.html?raw';
import overviewHtml from './overview.html?raw';
import './preview.css';

/** Static sample dashboard (markup recorded from the old preview, sample data only, no wallet or API calls). */
export function PreviewDashboard({ view }: { view: 'overview' | 'cards' }) {
  return (
    <div
      id="preview"
      className="pv-root"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: static recorded markup, no user input
      dangerouslySetInnerHTML={{ __html: view === 'cards' ? cardsHtml : overviewHtml }}
    />
  );
}
