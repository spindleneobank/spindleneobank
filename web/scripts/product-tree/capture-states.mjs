// Captures the DOM of a Framer variant component in every state it passes through (old site, live), per breakpoint.
// Usage: node capture-states.mjs <outDir> <selector> <name> [oldBase]
// Output: <outDir>/<name>-<bp>.json = [{ name: <data-framer-name of the first child>, at: <ms since in view>, tree }]
import fs from 'node:fs';
const PW = process.env.PW || 'playwright-core';
const { chromium, devices } = await import(PW);
const [OUT, SEL, NAME] = process.argv.slice(2, 5);
const OLD = process.argv[5] || 'http://127.0.0.1:7001';
const SECS = +(process.env.SECS || 14);
const b = await chromium.launch();
const vps = { desktop: [1440, 900], tablet: [1024, 768], phone: [393, 852] };
for (const [n, [w, h]] of Object.entries(vps)) {
  const opts = n === 'phone' ? { ...devices['iPhone 15'], viewport: { width: w, height: h }, deviceScaleFactor: 1 } : { viewport: { width: w, height: h } };
  const ctx = await b.newContext(opts);
  await ctx.addInitScript(`try{sessionStorage.setItem('spindle-intro-v2','1')}catch{}`);
  const p = await ctx.newPage();
  await p.goto(OLD + '/product', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector(SEL, { state: 'attached' });
  await p.evaluate(() => {
    window.__ser = (e) => {
      const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
      const o = { t: e.localName, a: {}, c: [] };
      for (const at of e.attributes) o.a[at.name] = at.value;
      for (const k of e.childNodes) { if (k.nodeType === 3) o.c.push(k.data); else if (k.nodeType === 1 && !SKIP.has(k.tagName)) o.c.push(window.__ser(k)); }
      return o;
    };
  });
  const out = [];
  const snap = async (at) => {
    const r = await p.evaluate((s) => { const e = document.querySelector(s); return { name: e?.firstElementChild?.getAttribute('data-framer-name'), tree: window.__ser(e) }; }, SEL);
    if (!out.some((x) => x.name === r.name)) out.push({ at, ...r });
  };
  await p.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'center' }), SEL);
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < SECS * 1000) {
    const nm = await p.evaluate((s) => document.querySelector(s)?.firstElementChild?.getAttribute('data-framer-name'), SEL);
    if (nm !== last) { last = nm; const at = Date.now() - t0; await p.waitForTimeout(650); await snap(at); }
    else await p.waitForTimeout(50);
  }
  fs.writeFileSync(`${OUT}/${NAME}-${n}.json`, JSON.stringify(out));
  console.log(n, out.map((x) => `${x.name}@${x.at}`).join(' '));
  await ctx.close();
}
await b.close();
