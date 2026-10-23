import { Link } from '@tanstack/react-router';
import { type CSSProperties, Fragment, type ReactNode } from 'react';
import { Appear, type AppearSpec, LiquidMetal } from '../../../components/marketing/motion';
import { ButtonPrimary } from '../../../components/marketing/shell';
import { CTA_LABEL } from '../../../components/marketing/shell/nav-data';
import {
  type FoundationCard,
  foundation,
  type Palette,
  type Photo as PhotoData,
  type Role,
  roles,
  solutionsHero,
} from '../../../content/marketing/solutions';
import {
  arrowUpSvg,
  bulletCheckSvg,
  chipCheckSvg,
  chipFilesSvg,
  chipSendSvg,
  chipSparkleSvg,
  databaseSvg,
  docSvg,
  maskUrl,
} from './icons';
import './solutions.css';

/** Mask-image glyph (old Framer "Icon" component): a flat colour cut by an SVG shape. */
function Glyph({ svg, className }: { svg: string; className: string }) {
  const m = maskUrl(svg);
  const style: CSSProperties = { maskImage: m, WebkitMaskImage: m };
  return <span className={className} style={style} aria-hidden="true" />;
}

/** Old "Border" component: 1px light line plus 1px page-coloured line, pinned to the chosen edges of the box. */
function Edges({ top, bottom, right }: { top?: boolean; bottom?: boolean; right?: boolean }) {
  return (
    <span className="s4-edges" aria-hidden="true">
      {top ? (
        <span className="s4-edge s4-edge-top">
          <i />
          <i />
        </span>
      ) : null}
      {bottom ? (
        <span className="s4-edge s4-edge-bottom">
          <i />
          <i />
        </span>
      ) : null}
      {right ? (
        <span className="s4-edge s4-edge-right">
          <i />
          <i />
        </span>
      ) : null}
    </span>
  );
}

/** Old "Section Label" (White): liquid-metal rim (angle 70, distortion .01, softness .1, speed 1.4, scale 1) around a gradient plate. */
function SectionLabel({ children }: { children: string }) {
  return (
    <div className="s4-pill">
      <div className="s4-pill-metal" aria-hidden="true">
        <LiquidMetal angle={70} distortion={0.01} softness={0.1} speed={1.4} scale={1} />
      </div>
      <div className="s4-pill-plate">
        <img src="/assets/pixel/sunrise.svg" alt="" width={18} height={18} decoding="async" />
        <p>{children}</p>
      </div>
    </div>
  );
}

/** Old Framer image: eager, intrinsic size, mobile twin in srcset, duotone filter via class. */
function Photo({ photo, tone }: { photo: PhotoData; tone: Palette }) {
  const { name } = photo;
  return (
    <img
      src={`/assets/stock/${name}-v10.webp`}
      srcSet={
        photo.mobile
          ? `/assets/mobile/${name}-v10.webp ${photo.mobileW}w, /assets/stock/${name}-v10.webp ${photo.stockW}w`
          : undefined
      }
      sizes={photo.mobile ? '(max-width: 809px) calc(100vw - 32px), 1200px' : undefined}
      alt={photo.alt}
      width={photo.width}
      height={photo.height}
      decoding="async"
      className={`s4-pal s4-pal-${tone}`}
    />
  );
}

function Roll({ children }: { children: string }) {
  return (
    <span className="s4-roll">
      <span>{children}</span>
      <span aria-hidden="true">{children}</span>
    </span>
  );
}

const chipIcons = [chipFilesSvg, chipSparkleSvg, chipCheckSvg, chipSendSvg] as const;
/**
 * Appear JSON of the old page (`__framer__appearAnimationsContent`): chips and the lines between them. The recorded
 * WAAPI animations are 0.4s linear with the JSON's delay (the spring in the JSON is replaced by Framer's linear
 * pre-hydration keyframes), so the port uses the same linear 0.4s tween.
 */
const tween = (delay: number) => ({ duration: 0.4, delay, ease: 'linear' });
const chipAppear = [
  { initial: { opacity: 0.001, y: -24 }, animate: { opacity: 1, y: 0 }, transition: tween(0) },
  {
    initial: { opacity: 0.001, y: -24, scale: 0.9 },
    animate: { opacity: 1, y: 0, scale: 1 },
    transition: tween(0.2),
  },
  {
    initial: { opacity: 0.001, y: -24, scale: 0.8 },
    animate: { opacity: 1, y: 0, scale: 1 },
    transition: tween(0.4),
  },
  {
    initial: { opacity: 0.001, y: -24, scale: 0.7 },
    animate: { opacity: 1, y: 0, scale: 1 },
    transition: tween(0.6),
  },
];
const lineAppear = [0.1, 0.3, 0.5].map((d) => ({
  initial: { opacity: 0.001, y: -24 },
  animate: { opacity: 1, y: 0 },
  transition: tween(d),
}));

function Hero() {
  const h = solutionsHero;
  return (
    <div className="s4-hero-wrap">
      <Edges bottom />
      <div className="s4-hero-container">
        <div className="s4-hero-main">
          <div className="s4-hero-copy">
            <div className="s4-hero-title">
              <SectionLabel>{h.eyebrow}</SectionLabel>
              <h1>{h.title}</h1>
            </div>
            <div className="s4-hero-text">
              <p className="s4-hero-lead">{h.lead}</p>
              <div className="s4-hero-btns">
                <Link to={h.explore.to} className="s4-explore">
                  <span className="s4-explore-ico">
                    <img src="/assets/pixel/agent.svg" alt="" width={20} height={20} decoding="async" />
                  </span>
                  <Roll>{h.explore.label}</Roll>
                </Link>
                <ButtonPrimary to="/dashboard/overview" lg className="s4-primary">
                  {CTA_LABEL}
                </ButtonPrimary>
              </div>
            </div>
          </div>
        </div>
        <div className="s4-visual">
          <div className="s4-bg">
            <Photo photo={h.image} tone="orchid" />
          </div>
          <div className="s4-chips">
            {h.chips.map((label, i) => (
              <Fragment key={label}>
                {i > 0 ? <Appear className="s4-line" spec={lineAppear[i - 1] as AppearSpec} /> : null}
                <Appear className="s4-chipc" spec={chipAppear[i] as AppearSpec}>
                  <div className="s4-chip">
                    <span className="s4-chip-ico">
                      <Glyph svg={chipIcons[i] as string} className="s4-chip-glyph" />
                    </span>
                    <p>{label}</p>
                  </div>
                </Appear>
              </Fragment>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function FoundationTitle() {
  return (
    <div className="s4-ftitle">
      <div className="s4-ftitle-in">
        <SectionLabel>{foundation.eyebrow}</SectionLabel>
        <div className="s4-ftitle-h">
          <h2>{foundation.title}</h2>
        </div>
      </div>
    </div>
  );
}

function CardArt({ card }: { card: FoundationCard }) {
  return (
    <div className="s4-card-img">
      <div className="s4-bg">
        <Photo photo={card.image} tone={card.palette} />
      </div>
      {card.kind === 'lanes' ? (
        <div className="s4-tags">
          {card.tags.map(([a, b]) => (
            <div className="s4-tag" key={a}>
              <span className="s4-tag-l">
                <img src="/assets/pixel/chevron-down.svg" alt="" width={14} height={14} decoding="async" />
                <p>{a}</p>
              </span>
              <p className="s4-tag-r">{b}</p>
            </div>
          ))}
        </div>
      ) : null}
      {card.kind === 'receipt' ? (
        <div className="s4-plate s4-plate-receipt">
          <p className="s4-figure">{card.figure}</p>
          <div className="s4-note">
            <Glyph svg={docSvg} className="s4-note-ico" />
            <p>{card.note}</p>
          </div>
        </div>
      ) : null}
      {card.kind === 'claim' ? (
        <div className="s4-plate s4-plate-claim">
          <span className="s4-claim-ico">
            <Glyph svg={databaseSvg} className="s4-claim-glyph" />
          </span>
          <div className="s4-claim-text">
            <p>
              <span>{card.note}</span>
            </p>
          </div>
          <p className="s4-claim-status">{card.status}</p>
        </div>
      ) : null}
    </div>
  );
}

function Foundation() {
  return (
    <>
      <FoundationTitle />
      <div className="s4-cards-wrap">
        <Edges top bottom />
        <div className="s4-cards">
          {foundation.cards.map((card, i) => (
            <div className={`s4-card s4-card-${i + 1}`} key={card.title}>
              <Edges right bottom />
              <CardArt card={card} />
              <div className="s4-card-txt">
                <p className="s4-card-h">{card.title}</p>
                <p className="s4-card-p">{card.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function Caption({ children }: { children: ReactNode }) {
  return (
    <div className="s4-caption">
      <img src="/assets/pixel/verified.svg" alt="" width={22} height={22} decoding="async" />
      <p className="s4-caption-t">
        <span>{children}</span>
      </p>
      <span className="s4-caption-go">
        <Glyph svg={arrowUpSvg} className="s4-caption-arrow" />
      </span>
    </div>
  );
}

function RoleSection({ role }: { role: Role }) {
  const copy = (
    <div className="s4-role-copy">
      <div className="s4-role-title">
        <SectionLabel>{role.eyebrow}</SectionLabel>
        <h2>{role.title}</h2>
        <p className="s4-lead">{role.lead}</p>
      </div>
      <div className="s4-list">
        {role.bullets.map((b) => (
          <div className="s4-li" key={b}>
            <span className="s4-li-ico">
              <Glyph svg={bulletCheckSvg} className="s4-li-glyph" />
            </span>
            <p>{b}</p>
          </div>
        ))}
      </div>
    </div>
  );
  const art = (
    <div className="s4-role-art">
      <div className="s4-bg">
        <Photo photo={role.image} tone={role.palette} />
      </div>
      <Caption>{role.caption}</Caption>
    </div>
  );
  return (
    <section
      className={`s4-role ${role.tall ? 's4-role-tall' : ''} ${role.flip ? 's4-role-flip' : ''}`}
      id={role.id}
    >
      <div className="s4-role-wrap">
        <Edges top bottom />
        <div className="s4-role-container">
          {role.flip ? art : copy}
          {role.flip ? copy : art}
        </div>
      </div>
    </section>
  );
}

export function SolutionsPage() {
  return (
    <>
      <section className="s4-top">
        <Hero />
        <Foundation />
      </section>
      {roles.map((r) => (
        <RoleSection key={r.id} role={r} />
      ))}
    </>
  );
}
