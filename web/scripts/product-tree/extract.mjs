import fs from 'node:fs';
// Usage: node extract.mjs <outDir> [oldBase]   (needs playwright-core; set PW to its index.mjs if it is not installed here)
const PW = process.env.PW || 'playwright-core';
const { chromium, devices } = await import(PW);
const OUT = process.argv[2] || '.';
const OLD = process.argv[3] || 'http://127.0.0.1:7001';
const b=await chromium.launch();
const vps={desktop:[1440,900],tablet:[1024,768],phone:[393,852]};
for(const [n,[w,h]] of Object.entries(vps)){
const opts = n==='phone'?{...devices['iPhone 15'],viewport:{width:w,height:h},deviceScaleFactor:1}:{viewport:{width:w,height:h}};
const ctx=await b.newContext(opts);
await ctx.addInitScript(`try{sessionStorage.setItem('spindle-intro-v2','1')}catch{}`);
const p=await ctx.newPage();
await p.goto(OLD + '/product',{waitUntil:'domcontentloaded'});
await p.waitForLoadState('networkidle').catch(()=>{});
let y=0;for(let i=0;i<40;i++){const H=await p.evaluate(()=>document.documentElement.scrollHeight);if(y>H)break;await p.evaluate(yy=>scrollTo(0,yy),y);await p.waitForTimeout(380);y+=h;}
await p.evaluate(()=>scrollTo(0,0));await p.waitForTimeout(800);
const r=await p.evaluate(()=>{
 const main=document.getElementById('main');
 const q=[main];let wrap=null;
 while(q.length&&!wrap){const e=q.shift();for(const c of e.children){if(getComputedStyle(c).display==='contents'&&c.children.length>2&&[...c.children].some(k=>k.getBoundingClientRect().height>100)){wrap=c;break;}q.push(c);}}
 const SKIP=new Set(['SCRIPT','STYLE','NOSCRIPT','TEMPLATE']);
 const ser=(e)=>{
  const o={t:e.localName,a:{},c:[]};
  for(const at of e.attributes){o.a[at.name]=at.value;}
  for(const k of e.childNodes){
   if(k.nodeType===3){o.c.push(k.data);}
   else if(k.nodeType===1&&!SKIP.has(k.tagName)){o.c.push(ser(k));}
  }
  return o;
 };
 // css
 const subtree=wrap;
 const outCss=[];
 const STRIP=/:(hover|focus|active|focus-visible|focus-within|visited|link|target)\b/g;
 const PSEUDO=/::?(before|after|first-line|first-letter|placeholder|selection|-webkit-[a-z-]+|-moz-[a-z-]+|marker|backdrop)\b/g;
 const used=(sel)=>{
   let s=sel.replace(/\.sp-motion-visible\b/g,'').replace(STRIP,'').replace(PSEUDO,'');
   s=s.replace(/\(\s*\)/g,'');
   try{ if(subtree.matches(s)||subtree.querySelector(s)||subtree.parentElement.matches(s))return true; }catch(e){ return false;}
   // root-level
   return false;
 };
 const rootLike=/^(:root|html|body|\*)$/;
 const kfNeeded=new Set();
 const rules=[];
 const procRule=(r,ctx)=>{
   if(r.type===1){ // style
     const sels=r.selectorText;
     const parts=splitSel(sels);
     const keep=parts.filter(s=>{ const t=s.trim(); if(/^(:root|html|body)\b/.test(t)) return /^(:root|html|body)$/.test(t)&&hasVarsOnly(r); return used(t);});
     if(!keep.length) return null;
     return {sel:keep.join(','),css:r.style.cssText};
   }
   return null;
 };
 function hasVarsOnly(r){ for(let i=0;i<r.style.length;i++) if(!r.style[i].startsWith('--')) return false; return r.style.length>0; }
 function splitSel(s){const out=[];let d=0,cur='',q='';for(const ch of s){if(q){cur+=ch;if(ch===q)q='';continue;}if(ch==='"'||ch==="'"){q=ch;cur+=ch;continue;}if(ch==='('||ch==='[')d++;if(ch===')'||ch===']')d--;if(ch===','&&d===0){out.push(cur);cur='';}else cur+=ch;}if(cur.trim())out.push(cur);return out;}
 const walk=(list,pre)=>{
   const res=[];let i=0;
   for(const r of list){
     const key=pre+'.'+(i++);
     if(r.type===1){const k=procRule(r);if(k){k.k=key;res.push(k);}}
     else if(r.type===3&&r.styleSheet){ let ir; try{ir=r.styleSheet.cssRules}catch(e){continue} res.push(...walk(ir,key)); }
     else if(r.type===4||r.type===12){ // media / supports
       const inner=walk(r.cssRules,key);
       if(inner.length) res.push({k:key,at:r.type===4?'@media '+r.conditionText:'@supports '+r.conditionText,inner});
     } else if(r.type===7){ res.push({k:key,kf:r.name,css:r.cssText}); }
   }
   return res;
 };
 const sheets=[];
 for(const s of document.styleSheets){ let rl; try{rl=s.cssRules;}catch(e){continue;} const si=sheets.length;sheets.push({si,href:s.href||'inline',owner:s.ownerNode&&s.ownerNode.getAttribute&&(s.ownerNode.getAttribute('data-framer-html-style')!==null?'html-style':s.ownerNode.getAttribute('data-framer-css-ssr-minified')!==null?'ssr':''),rules:walk(rl,'s'+si)}); }
 const rect=wrap.getBoundingClientRect();
 const tpl={};
 for(const u of wrap.querySelectorAll('use')){const id=(u.getAttribute('href')||'').slice(1);const t=document.getElementById(id);if(t)tpl[id]=t.outerHTML;}
 return {tpl,tree:ser(wrap),sheets,wrapCls:wrap.className,parentCls:wrap.parentElement.className,parentStyle:wrap.parentElement.getAttribute('style'),rootStyle:wrap.parentElement.getAttribute('style'),rootCls:wrap.parentElement.className};
});
fs.writeFileSync(`${OUT}/ext-${n}.json`,JSON.stringify(r));
console.log(n,JSON.stringify(r.tree).length,r.sheets.map(s=>s.href.split('/').pop()+':'+s.rules.length).join(' '),r.wrapCls,'|',r.parentCls);
await ctx.close();
}
await b.close();
