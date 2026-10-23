import { createFileRoute } from '@tanstack/react-router';
import {
  ClosingCta,
  CompareTable,
  LaneCard,
  Marquee,
  PageHero,
  pageHead,
  SharedColumn,
} from '../../components/marketing';
import { Section } from '../../components/Section';
import {
  compare,
  lanesHero,
  lanesMeta,
  openLane,
  sealedLane,
  sharedProof,
} from '../../content/marketing/compute-lanes';
import { closing, marquee } from '../../content/marketing/home';

export const Route = createFileRoute('/(marketing)/compute-lanes')({
  head: () => pageHead(lanesMeta),
  component: ComputeLanes,
});

function ComputeLanes() {
  return (
    <div className="spm-page">
      <PageHero {...lanesHero} />
      <Section id="lanes" tone="night">
        <div className="spm-lanes">
          <LaneCard lane={sealedLane} />
          <LaneCard lane={openLane} />
          <SharedColumn {...sharedProof} items={sharedProof.items} footer={sharedProof.footer} />
        </div>
      </Section>
      <Marquee items={marquee} />
      <Section id="compare" tone="night" eyebrow={compare.eyebrow} title={compare.title}>
        <CompareTable columns={compare.columns} groups={compare.groups} />
      </Section>
      <ClosingCta {...closing} />
    </div>
  );
}
