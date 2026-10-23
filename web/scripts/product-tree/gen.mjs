import fs from 'node:fs';
// Usage: node gen.mjs <extDir> <out.json> <out.css>
const EXT = process.argv[2], OUT_JSON = process.argv[3], OUT_CSS = process.argv[4];
const BPS = ['desktop','tablet','phone'];
const X = Object.fromEntries(BPS.map(b => [b, JSON.parse(fs.readFileSync(`${EXT}/ext-${b}.json`, 'utf8'))]));

// ---------- tree normalisation
const DROP = new Set(['data-sp-slot','data-sp-ready','data-framer-appear-id','parentsize','_constraints','rotation','shadows','name','data-code-component-plugin-id','data-framer-ssr-released-at','data-framer-page-optimized-at','data-framer-generated-page']);
const stripCls = (c) => c.split(/\s+/).filter((x) => x && x !== 'sp-motion-visible').join(' ');
function splitDecl(s) { const out=[]; let d=0,q='',cur=''; for (const ch of s) { if (q) { cur+=ch; if (ch===q) q=''; continue; } if (ch==='"'||ch==="'") { q=ch; cur+=ch; continue; } if (ch==='(') d++; if (ch===')') d--; if (ch===';'&&d===0) { out.push(cur); cur=''; } else cur+=ch; } if (cur.trim()) out.push(cur); return out; }
function normStyle(s) {
  const parts = splitDecl(s).map((x) => x.trim()).filter(Boolean).filter((x) => !/^will-change\s*:/.test(x));
  return parts.join('; ');
}
const LM_KIND = [['framer-1aggivb-container', 'badge'], ['framer-86hip0-container', 'button'], ['framer-1gko5oh-container', 'card'], ['framer-1070xoh-container', 'mark'], ['framer-5sml28-container', 'hero']];
// Approved text exceptions for /product (docs/plan/parity-text-exceptions.md); everything else is verbatim.
const TEXT = {
  'Claim USDG, quote a canonical Stock Token, or route a claim to a virtual card.': 'Claim USDG, then quote a Stock Token or fund a virtual card.',
  'Sealed lane': 'Sealed testing',
  'Sealed jobs require eligible confidential GPUs and attestation. Open jobs are non-sensitive workloads.': 'Sealed jobs (in testing) need confidential GPUs and attestation. Open jobs are non-sensitive workloads.',
};
// per-instance ids (React useId: r18 vs r1k per breakpoint) are made equal so the instances merge
const fixIds = (s) => s.replace(/(workflow-(?:halo|signal-square|flow))-r[0-9a-z]+/g, '$1-p3');
function norm(n, anc = []) {
  if (typeof n === 'string') n = fixIds(n);
  if (typeof n === 'string' && n === '16%') return '84%'; // workflow pill label is set live; the snapshot value is arbitrary
  if (typeof n === 'string') return TEXT[n.trim()] ? n.replace(n.trim(), TEXT[n.trim()]) : n;
  // Liquid Metal / hero shader hosts: a div whose only child is a canvas -> marker rendered by a real component
  if (n.t === 'div' && n.c.length === 1 && typeof n.c[0] !== 'string' && n.c[0].t === 'canvas') {
    const cl = anc.join(' ');
    const k = LM_KIND.find(([c]) => cl.includes(c));
    if (k) return { t: 'div', a: { 'data-pp-shader': k[1] }, c: [] };
  }
  const a = {};
  for (const [k, v] of Object.entries(n.a)) {
    if (DROP.has(k)) continue;
    if (k === 'class') { const c = stripCls(v); if (c) a.class = c; continue; }
    if (k === 'style') {
      let s = fixIds(normStyle(v));
      // per-character reveal spans (Framer text effect): final state in the markup, replayed at runtime
      if (n.t === 'span' && /display:\s*inline-block/.test(s) && /opacity:\s*0\.001/.test(s) && n.c.length === 1 && typeof n.c[0] === 'string') { s = s.replace(/opacity:\s*0\.001/, 'opacity: 1'); a['data-pp-ch'] = '1'; }
      if (s) a.style = s;
      continue;
    }
    a[k] = typeof v === 'string' ? fixIds(v) : v;
  }
  // the old page resolves this background to the 800w stock file on every breakpoint (its script rewrites srcset after load)
  if (n.t === 'img' && /soap-film-web-v10/.test(a.src || '')) { delete a.srcset; delete a.sizes; }
  // hero comet groups (g > 9 circles) rest at opacity 0 between cycles; a live hook animates them
  if (n.t === 'g' && n.c.length === 9 && n.c.every((c) => typeof c !== 'string' && c.t === 'circle')) a.opacity = '0';
  const cls = a.class || ''; return { t: n.t, a, c: n.c.map((c) => norm(c, [...anc.slice(-8), cls])) };
}
const trees = Object.fromEntries(BPS.map((b) => [b, norm(X[b].tree)]));

// ---------- live widgets whose states were captured from the old site (capture-states.mjs)
const CHAT = 'framer-1n6f6e8-container';
const chatStates = {};
for (const b of BPS) {
  const f = `${EXT}/chat-${b}.json`;
  if (!fs.existsSync(f)) continue;
  chatStates[b] = JSON.parse(fs.readFileSync(f, 'utf8')).map((s) => ({ name: s.name, node: norm(s.tree) }));
}
// Framer "Typewriter" code component ("Spend Typewriter"): rendered live by <Typewriter>, keeping the wrapper's own styles
function stubTypewriter(n) {
  if (typeof n === 'string') return;
  if ((n.a.class || '').split(' ').includes('framer-1ged15i-container') && n.c.length === 1 && typeof n.c[0] !== 'string') {
    const box = n.c[0];
    const cursor = box.c[1]?.c?.[1]?.a?.style || '';
    n.c = [{ t: 'div', a: { 'data-pp-typewriter': '1', role: 'text', style: box.a.style, 'data-pp-cursor': cursor }, c: [] }];
    return;
  }
  n.c.forEach(stubTypewriter);
}
function stubChat(n) { // replace the chat container's content with a marker
  if (typeof n === 'string') return;
  if ((n.a.class || '').split(' ').includes(CHAT)) { n.c = [{ t: 'div', a: { 'data-pp-chat': '1' }, c: [] }]; return; }
  n.c.forEach(stubChat);
}
if (Object.keys(chatStates).length === BPS.length) for (const b of BPS) stubChat(trees[b]);
for (const b of BPS) stubTypewriter(trees[b]);

// FAQ accordion (capture-faq.mjs): items keep their container, the state root is rendered by <FaqItem>
const faqRaw = {};
for (const b of BPS) { const f = `${EXT}/faq-${b}.json`; if (fs.existsSync(f)) faqRaw[b] = JSON.parse(fs.readFileSync(f, 'utf8')); }
const hasFaq = Object.keys(faqRaw).length === BPS.length;
function stubFaq(n) {
  if (typeof n === 'string') return;
  const m = /^Question ([1-6])$/.exec(n.a['data-framer-name'] || '');
  if (m && (n.a.class || '').includes('-container') && n.c.length === 1) { n.c = [{ t: 'div', a: { 'data-pp-faq': m[1] }, c: [] }]; return; }
  n.c.forEach(stubFaq);
}
if (hasFaq) for (const b of BPS) stubFaq(trees[b]);

// ---------- merge
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const key = { desktop: 'd', tablet: 't', phone: 'p' };
let variantNodes = 0;
function merge(ns) { // ns: {desktop,tablet,phone}
  const [d, t, p] = BPS.map((b) => ns[b]);
  if (eq(d, t) && eq(d, p)) return d;
  const allStr = [d, t, p].every((x) => typeof x === 'string');
  const allEl = [d, t, p].every((x) => typeof x !== 'string');
  // <style> blocks (per-instance keyframe names differ per breakpoint): one block holding every variant's text
  if (allEl && d.t === 'style' && t.t === 'style' && p.t === 'style') return { t: 'style', a: d.a, c: [...new Set([d, t, p].map((x) => x.c.join('')))] };
  if (allEl && d.t === t.t && d.t === p.t && d.c.length === t.c.length && d.c.length === p.c.length) {
    const sameAttrs = eq(d.a, t.a) && eq(d.a, p.a);
    const children = d.c.map((_, i) => merge({ desktop: d.c[i], tablet: t.c[i], phone: p.c[i] }));
    if (sameAttrs) return { t: d.t, a: d.a, c: children };
    // attrs differ: one element per distinct attr set, same merged children
    variantNodes++;
    return { t: d.t, c: children, va: groupVariants(BPS.map((b) => ({ b, node: ns[b].a }))) };
  }
  variantNodes++;
  return { v: groupVariants(BPS.map((b) => ({ b, node: ns[b] }))) };
}
function groupVariants(list) { // merge bps with identical nodes: {bps:[..], node}
  const groups = [];
  for (const { b, node } of list) { const g = groups.find((x) => eq(x.node, node)); if (g) g.bps.push(key[b]); else groups.push({ bps: [key[b]], node }); }
  return groups.map((g) => ({ bp: g.bps.join(''), n: g.node }));
}
const merged = merge(trees);

// ---------- to React props
const camelAttr = (k) => k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const MAP = { class: 'className', for: 'htmlFor', tabindex: 'tabIndex', srcset: 'srcSet', fetchpriority: 'fetchPriority', crossorigin: 'crossOrigin', 'xlink:href': 'href', maxlength: 'maxLength', readonly: 'readOnly', playsinline: 'playsInline', autoplay: 'autoPlay' };
function styleObj(s) {
  const o = {};
  for (const decl of splitDecl(s)) {
    const i = decl.indexOf(':'); if (i < 0) continue;
    let k = decl.slice(0, i).trim(), v = decl.slice(i + 1).trim();
    if (!k) continue;
    if (!k.startsWith('--')) k = k.startsWith('-ms-') ? 'ms' + camelAttr(k.slice(3)).replace(/^./, (c) => c.toUpperCase()) : camelAttr(k.replace(/^-webkit-/, 'Webkit-').replace(/^-moz-/, 'Moz-')).replace(/^webkit/, 'Webkit');
    o[k] = v;
  }
  return o;
}
function props(a) {
  const o = {};
  for (const [k, v] of Object.entries(a)) {
    if (k === 'style') { o.style = styleObj(v); continue; }
    if (k === 'class') { o.className = v; continue; }
    if (k === 'data-pp-cursor') { o[k] = JSON.stringify(styleObj(v)); continue; }
    if (MAP[k]) { o[MAP[k]] = v; continue; }
    if (k.startsWith('data-') || k.startsWith('aria-')) { o[k] = v; continue; }
    o[k.includes('-') ? camelAttr(k) : k] = v;
  }
  return o;
}
// compact format: element = [tag, props|0, ...children]; variant = {v:[[bp, node],...]}
function conv(n) {
  if (typeof n === 'string') return n;
  if (n.va) return { va: n.va.map((g) => [g.bp, props(g.n)]), t: n.t, c: n.c.map(conv) };
  if (n.v) return { v: n.v.map((g) => [g.bp, conv(g.n)]) };
  const p = props(n.a);
  return Object.keys(p).length ? [n.t, p, ...n.c.map(conv)] : [n.t, 0, ...n.c.map(conv)];
}
const tpl = {}; for (const b of BPS) Object.assign(tpl, X[b].tpl);
let chat = null;
if (Object.keys(chatStates).length === BPS.length) {
  const n = chatStates.desktop.length;
  chat = { names: chatStates.desktop.map((s) => s.name), states: [] };
  for (let i = 0; i < n; i++) chat.states.push(conv(merge({ desktop: chatStates.desktop[i].node.c[0], tablet: chatStates.tablet[i].node.c[0], phone: chatStates.phone[i].node.c[0] })));
}
let faq = null;
if (hasFaq) {
  faq = { initial: faqRaw.desktop.initial.findIndex((x) => x === 'Opened'), single: faqRaw.desktop.single, items: [] };
  for (let i = 0; i < 6; i++) {
    const item = {};
    for (const st of ['opened', 'closed']) item[st] = conv(merge(Object.fromEntries(BPS.map((b) => [b, norm(faqRaw[b].items[i][st]).c[0]]))));
    faq.items.push(item);
  }
}
const out = { faq, chat, root: { cls: X.desktop.rootCls, style: styleObj(X.desktop.rootStyle || '') }, tree: conv(merged), templates: tpl };
fs.writeFileSync(OUT_JSON, JSON.stringify(out));
console.log('variantNodes', variantNodes, 'json', JSON.stringify(out).length);

// ---------- CSS
const all = new Map(); // key -> rule
const order = (k) => k.split(/[s.]/).filter(Boolean).map(Number);
const cmpK = (a, b) => { const x = order(a), y = order(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? -1) - (y[i] ?? -1); if (d) return d; } return 0; };
const splitSel = (s) => s.split(/,(?![^(]*\))(?![^\[]*\])/).map((x) => x.trim()).filter(Boolean);
function collect(rules, into) {
  for (const r of rules) {
    const ex = into.get(r.k);
    if (r.inner) { if (!ex) into.set(r.k, { ...r, inner: new Map() }); collect(r.inner, into.get(r.k).inner); }
    else if (!ex) into.set(r.k, { ...r });
    else if (r.sel && ex.sel !== r.sel) ex.sel = [...new Set([...splitSel(ex.sel), ...splitSel(r.sel)])].join(', '); // each breakpoint keeps only the parts that match its own tree
  }
}
const map = new Map();
for (const b of BPS) for (const sh of X[b].sheets) collect(sh.rules, map);
const treeText = JSON.stringify(out.tree) + JSON.stringify(out.root);
const scopeSel = (s) => {
  s = s.trim();
  if (/^(:root|body|html)$/.test(s)) return '.pp-scope';
  if (s.startsWith('#main')) return s;
  if (s.startsWith('.framer-x8qsM')) return '.pp-scope' + s;
  if (s.startsWith('*')) return '.pp-scope ' + s;
  if (/^\s*(html|body)\b/.test(s)) return null;
  return '.pp-scope ' + s;
};
const cssParts = [];
const usedCss = [];
function emit(m, depth) {
  const keys = [...m.keys()].sort(cmpK);
  let s = '';
  for (const k of keys) {
    const r = m.get(k);
    if (r.inner) { const inner = emit(r.inner, depth + 1); if (inner) s += `${r.at}{${inner}}\n`; }
    else if (r.kf) { if (/^workflow-flow|^shimmer-r/.test(r.kf)) continue; s += `\0KF:${r.kf}\0${r.css}\n`; }
    else { const sels = r.sel.split(/,(?![^(]*\))(?![^\[]*\])/).map(scopeSel).filter(Boolean); if (!sels.length) continue; s += `${sels.join(',')}{${r.css}}\n`; }
  }
  return s;
}
let css = emit(map, 0);
// keep keyframes only if referenced
const refText = css.replace(/\0KF:[^\0]+\0[^\n]*(\n(?!\0|[.#:*@\[a-z]).*)*/g, '') + treeText;
css = css.replace(/\0KF:([^\0]+)\0((?:.|\n)*?\n\})\n/g, (m, name, body) => (refText.includes(name) ? body + '\n' : ''));
fs.writeFileSync(OUT_CSS, '/* Generated from the rendered old /product page (see features/marketing/product/README). Scoped to .pp-scope / #main. */\n' + css);
console.log('css', css.length);
