// Captures every FAQ item (Question 1..6) in its Closed and Opened state from the old /product page, per breakpoint, by clicking.
// Usage: node capture-faq.mjs <outDir> [oldBase]   -> <outDir>/faq-<bp>.json = { items: [{ closed: tree, opened: tree }], initial: ['Opened','Closed',...], single: bool }
import fs from 'node:fs';
const PW = process.env.PW || 'playwright-core';
const { chromium, devices } = await import(PW);
const OUT = process.argv[2];
const OLD = process.argv[3] || 'http://127.0.0.1:7001';
const b = await chromium.launch();
const vps = { desktop: [1440, 900], tablet: [1024, 768], phone: [393, 852] };
for (const [n, [w, h]] of Object.entries(vps)) {
  const opts = n === 'phone' ? { ...devices['iPhone 15'], viewport: { width: w, height: h }, deviceScaleFactor: 1 } : { viewport: { width: w, height: h } };
  const ctx = await b.newContext(opts);
  await ctx.addInitScript(`try{sessionStorage.setItem('spindle-intro-v2','1')}catch{}`);
  const p = await ctx.newPage();
  await p.goto(OLD + '/product', { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.evaluate(() => {
    window.__ser = (e) => { const o = { t: e.localName, a: {}, c: [] }; for (const at of e.attributes) o.a[at.name] = at.value; for (const k of e.childNodes) { if (k.nodeType === 3) o.c.push(k.data); else if (k.nodeType === 1 && !['SCRIPT', 'STYLE'].includes(k.tagName)) o.c.push(window.__ser(k)); } return o; };
    window.__q = (i) => document.querySelector(`[data-framer-name="Question ${i}"][class*="-container"]`);
    window.__names = () => [1, 2, 3, 4, 5, 6].map((i) => window.__q(i)?.firstElementChild?.getAttribute('data-framer-name'));
    document.querySelector('[data-framer-name="Question 1"]').scrollIntoView({ block: 'center' });
  });
  await p.waitForTimeout(1200);
  const initial = await p.evaluate(() => window.__names());
  const items = [];
  const snap = (i) => p.evaluate((k) => window.__ser(window.__q(k)), i);
  for (let i = 1; i <= 6; i++) items.push({});
  // closed/opened trees: toggle each item twice
  let single = null;
  for (let i = 1; i <= 6; i++) {
    const was = (await p.evaluate(() => window.__names()))[i - 1];
    items[i - 1][was.toLowerCase()] = await snap(i);
    await p.locator(`[data-framer-name="Question ${i}"][class*="-container"] [data-framer-name="Question"]`).first().click();
    await p.waitForTimeout(900);
    const names = await p.evaluate(() => window.__names());
    const now = names[i - 1];
    items[i - 1][now.toLowerCase()] = await snap(i);
    if (single === null && names.filter((x) => x === 'Opened').length === 1) single = true;
    if (names.filter((x) => x === 'Opened').length > 1) single = false;
    await p.locator(`[data-framer-name="Question ${i}"][class*="-container"] [data-framer-name="Question"]`).first().click();
    await p.waitForTimeout(900);
  }
  fs.writeFileSync(`${OUT}/faq-${n}.json`, JSON.stringify({ initial, single, items }));
  console.log(n, initial, 'single', single, items.map((x) => Object.keys(x).join('/')).join(' '));
  await ctx.close();
}
await b.close();
