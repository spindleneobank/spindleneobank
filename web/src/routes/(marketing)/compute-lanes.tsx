import { createFileRoute } from '@tanstack/react-router';
import { ClosingCta, CompareTable, LaneCard, PageHero, pageHead } from '../../components/marketing';
import { PixelIcon } from '../../components/PixelIcon';
import { Section } from '../../components/Section';
import {
  compare,
  lanesHero,
  lanesMeta,
  openLane,
  sealedLane,
  sharedProof,
} from '../../content/marketing/compute-lanes';
import { closing } from '../../content/marketing/home';

export const Route = createFileRoute('/(marketing)/compute-lanes')({
  head: () => pageHead(lanesMeta),
  component: ComputeLanes,
});

function ComputeLanes() {
  return (
    <>
      <PageHero {...lanesHero} />
      <Section id="lanes" tone="night">
        <div className="spm-lanes">
          <LaneCard lane={sealedLane} />
          <LaneCard lane={openLane} />
        </div>
      </Section>
      <Section
        id="shared-proof"
        eyebrow={sharedProof.eyebrow}
        title={sharedProof.title}
        lead={sharedProof.footer}
      >
        <ul className="spm-bullets">
          {sharedProof.items.map((i) => (
            <li key={i}>
              <PixelIcon name="check" size={14} />
              {i}
            </li>
          ))}
        </ul>
      </Section>
      <Section id="compare" eyebrow={compare.eyebrow} title={compare.title}>
        <CompareTable columns={compare.columns} rows={compare.rows} />
      </Section>
      <ClosingCta {...closing} />
    </>
  );
}
