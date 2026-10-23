import { createElement, Fragment, type ReactNode } from 'react';

/**
 * Compact tree of the rendered old /product page (see content/marketing/product-tree.json):
 * - string: text
 * - [tag, props | 0, ...children]: element
 * - { v: [[bps, node], ...] }: breakpoint variants of a whole node
 * - { va: [[bps, props], ...], t, c }: same element and children, per-breakpoint attributes
 * `bps` is a subset of "dtp" (desktop, tablet, phone). CSS (product-extra.css) hides the variants that do not apply.
 */
export type PNode =
  | string
  | [string, Record<string, unknown> | 0, ...PNode[]]
  | { v: [string, PNode][] }
  | { va: [string, Record<string, unknown>][]; t: string; c: PNode[] };

export type Override = (
  el: PNode & unknown[],
  key: string,
  children: ReactNode[],
  path: string,
) => ReactNode | undefined;

/** Marks a breakpoint variant with a data attribute (the class list stays identical to the old element's). */
const cls = (p: Record<string, unknown> | 0, bps: string) =>
  ({ ...(p || {}), 'data-pp-b': bps }) as Record<string, unknown>;

export function renderNode(n: PNode, key: string | number, path: string, ov?: Override): ReactNode {
  if (typeof n === 'string') return n;
  if (Array.isArray(n)) {
    const [tag, p, ...rest] = n;
    const kids = rest.map((c, i) => renderNode(c, i, `${path}/${i}`, ov));
    const o = ov?.(n as never, String(key), kids, path);
    if (o !== undefined) return o;
    return createElement(tag, { ...(p || {}), key }, ...kids);
  }
  if ('va' in n) {
    return (
      <Fragment key={key}>
        {n.va.map(([bps, p]) => {
          const kids = n.c.map((c, i) => renderNode(c, i, `${path}/${i}`, ov));
          const el: PNode = [n.t, p, ...n.c];
          const o = ov?.(el as never, `${key}-${bps}`, kids, path);
          if (o !== undefined) return o;
          return createElement(n.t, { ...cls(p, bps), key: bps }, ...kids);
        })}
      </Fragment>
    );
  }
  return (
    <Fragment key={key}>
      {n.v.map(([bps, c]) => {
        if (typeof c === 'string')
          return (
            <span key={bps} data-pp-b={bps}>
              {c}
            </span>
          );
        if (Array.isArray(c)) {
          const [tag, p, ...rest] = c;
          const kids = rest.map((x, i) => renderNode(x, i, `${path}/${bps}/${i}`, ov));
          const o = ov?.(c as never, `${key}-${bps}`, kids, path);
          if (o !== undefined) return o;
          return createElement(tag, { ...cls(p, bps), key: bps }, ...kids);
        }
        return renderNode(c, bps, `${path}/${bps}`, ov);
      })}
    </Fragment>
  );
}
