// Captures the "Explore the paths" tab group (Step 1..3) in each state by clicking the tabs on the old page, per breakpoint.
// Usage: node capture-tabs.mjs <outDir> [oldBase]  -> <outDir>/tabs-<bp>.json = { states: [tree, tree, tree], anims: [...] }
import fs from 'node:fs';
const PW = process.env.PW || 'playwright-core';
const { chromium, devices } = await import(PW);
const OUT = process.argv[2];
const OLD = process.argv[3] || 'http://127.0.0.1:7001';
const ROOT = '.framer-u0pvqb-container';
const TABS = ['framer-aitp2v-container', 'framer-dwvy2q-container', 'framer-1g1so52-container'];
const b = await chromium.launch();
const vps = { desktop: [1440, 900], tablet: [1024, 768], phone: [393, 852] };
for (const [n, [w, h]] of Object.entries(vps)) {
  const opts = n === 'phone' ? { ...devices['iPhone 15'], viewport: { width: w, height: h }, deviceScaleFactor: 1 } : { viewport: { width: w, height: h } };
  const ctx = await b.newContext(opts);
  await ctx.addInitScript(`try{sessionStorage.setItem('spindle-intro-v2','1')}catch{};window.__A=[];const o=Element.prototype.animate;Element.prototype.animate=function(k,op){window.__A.push([Math.round(performance.now()),(this.getAttribute('data-framer-name')||this.className.toString().split(' ')[0]),JSON.stringify(k).slice(0,140),JSON.stringify(op).slice(0,120)]);return o.call(this,k,op)};`);
  const p = await ctx.newPage();
  await p.goto(OLD + '/product', { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.evaluate(() => {
    window.__ser = (e) => { const o = { t: e.localName, a: {}, c: [] }; for (const at of e.attributes) o.a[at.name] = at.value; for (const k of e.childNodes) { if (k.nodeType === 3) o.c.push(k.data); else if (k.nodeType === 1 && !['SCRIPT', 'STYLE'].includes(k.tagName)) o.c.push(window.__ser(k)); } return o; };
  });
  await p.evaluate((r) => document.querySelector(r).scrollIntoView({ block: 'center' }), ROOT);
  await p.waitForTimeout(1500);
  const states = [];
  const anims = [];
  const snap = () => p.evaluate((r) => window.__ser(document.querySelector(r)), ROOT);
  states[0] = await snap();
  for (const k of [1, 2, 0]) {
    const a0 = await p.evaluate(() => window.__A.length);
    await p.locator(`${ROOT} .${TABS[k]}`).first().click({ force: true });
    await p.waitForTimeout(1300);
    if (!states[k]) states[k] = await snap();
    anims.push(...(await p.evaluate((i) => window.__A.slice(i), a0)).map((x) => [k, ...x]));
  }
  fs.writeFileSync(`${OUT}/tabs-${n}.json`, JSON.stringify({ states, anims }));
  console.log(n, states.map((s) => s.c[0]?.a?.['data-framer-name']).join(' | '), 'anims', anims.length);
  await ctx.close();
}
await b.close();
