export const CARD_DESIGNS = [
  {
    key: 'orchid',
    name: 'Orchid',
    material: 'Titanium',
    detail: 'Pixel petal interference',
    color: '#b5a3cb',
  },
  {
    key: 'obsidian',
    name: 'Obsidian',
    material: 'Brushed black',
    detail: 'Offset Spindle engraving',
    color: '#393638',
  },
  {
    key: 'platinum',
    name: 'Platinum',
    material: 'Brushed platinum',
    detail: 'Pixel cascade',
    color: '#c6bdb1',
  },
  { key: 'copper', name: 'Copper', material: 'Warm copper', detail: 'Orbital arcs', color: '#b66d43' },
  { key: 'amethyst', name: 'Amethyst', material: 'Violet metal', detail: 'Contour petals', color: '#77518d' },
  { key: 'rose', name: 'Rose', material: 'Rose metal', detail: 'Pixel flower', color: '#dfa08e' },
  { key: 'slate', name: 'Slate', material: 'Brushed slate', detail: 'Coordinate orbit', color: '#737374' },
  {
    key: 'champagne',
    name: 'Champagne',
    material: 'Champagne gold',
    detail: 'Diagonal pixel field',
    color: '#dbbe96',
  },
  {
    key: 'garnet',
    name: 'Garnet',
    material: 'Wine metal',
    detail: 'Concentric Spindle engraving',
    color: '#814663',
  },
] as const;

export type CardFinish = (typeof CARD_DESIGNS)[number]['key'];

export const cardDesign = (key: string) => CARD_DESIGNS.find((c) => c.key === key) ?? CARD_DESIGNS[0];

/** Port of card-collection.js `cardFace`: one engraved metal finish (9 finishes). */
export function CardFace({
  finish,
  decorative = false,
  frozen = false,
}: {
  finish: string;
  decorative?: boolean;
  frozen?: boolean;
}) {
  const c = cardDesign(finish);
  const file = c.key === 'orchid' ? 'orchid.svg' : `${c.key}-v9.svg`;
  return (
    <img
      className={`sp-card-face${frozen ? ' is-frozen' : ''}`}
      src={`/assets/cards/${file}`}
      alt={decorative ? '' : `Spindle ${c.name} engraved ${c.material.toLowerCase()} card`}
      draggable={false}
      width={1016}
      height={640}
    />
  );
}

export function CardFinishPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (key: CardFinish) => void;
}) {
  const c = cardDesign(value);
  return (
    <div className="sp-finish-picker">
      <div className="sp-finish-selected">
        <strong>
          {c.name} / {c.material}
        </strong>
        <span>
          {String(CARD_DESIGNS.findIndex((d) => d.key === c.key) + 1).padStart(2, '0')} /{' '}
          {CARD_DESIGNS.length}
        </span>
      </div>
      <div className="sp-finish-options" role="radiogroup" aria-label="Card finish">
        {CARD_DESIGNS.map((d) => (
          <button
            key={d.key}
            type="button"
            role="radio"
            aria-checked={d.key === c.key}
            className={d.key === c.key ? 'active' : ''}
            onClick={() => onChange(d.key)}
          >
            <i style={{ background: d.color }} />
            <span className="sp-sr-only">{d.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
