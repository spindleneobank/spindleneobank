import { Badge, CommunityCard } from './ui';

const STATS = [
  ['2', 'LANES'],
  ['03', 'ROUTES'],
  ['01', 'HOUR'],
  ['01', 'CHAIN'],
];

export function CommunityPage() {
  return (
    <div className="ab">
      <section className="ab-cm" data-framer-name="Hero Section">
        <div className="ab-cm-w">
          <div className="ab-cm-bg">
            <img src="/assets/graphics/e522881bd27e10.svg" alt="" />
          </div>
          <div className="ab-cm-c">
            <div className="ab-cm-t">
              <Badge tone="black">SPECIFICATION PREVIEW</Badge>
              <h1 className="ab-ch1">Follow the network</h1>
              <p>
                Explore Spindle’s compute and payout design. Community links and launch details are coming
                soon.
              </p>
            </div>
            <div className="ab-cnt">
              {STATS.map(([n, l]) => (
                <div key={l}>
                  <div className="ab-cnt-i">
                    <div className="ab-cnt-n">{n}</div>
                    <div className="ab-cnt-l">{l}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="ab-cm-form">
              <CommunityCard />
              <div className="ab-cm-av">
                <div className="ab-cm-faces">
                  <img src="/assets/pixel/receipt-verifier.svg" alt="" style={{ left: 0 }} />
                  <img src="/assets/pixel/epoch.svg" alt="" style={{ left: 24 }} />
                  <img src="/assets/pixel/cards.svg" alt="" style={{ left: 48 }} />
                </div>
                <p>Follow the network on Telegram and X</p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
