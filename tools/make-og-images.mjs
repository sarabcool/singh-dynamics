// Generates the og:image link-preview card for each marketing site.
//
// Runs in CI as a step of deploy-marketing-sites.yml, writing og-image.png into
// site/<dir>/ just before that folder is deployed to Cloudflare Pages. The PNGs
// are therefore never committed to git: the deploy artifact has them, the repo
// does not. Change a headline below, push, and the card regenerates.
//
// Each card carries its own sub-brand mark and accent but shares the parent
// canvas, type and layout, so the four read as a family in a message thread.
//
// Usage: node tools/make-og-images.mjs [dir]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const CANVAS = '#F4F2ED';
const INK    = '#111315';
const MUTED  = '#687078';
const RULE   = '#D9D4C8';

const MARKS = {
  sd:  `<path d="M23 11H13.2v4.2H23V21h-9.8" stroke="${CANVAS}" stroke-width="3.6" fill="none"/>`,
  web: `<path d="M9 11.4h15" stroke="${CANVAS}" stroke-width="3.2"/><path d="M13.2 22.2l4.4-4.6 4.4 4.6" stroke="${CANVAS}" stroke-width="3.2" fill="none"/>`,
  ar:  `<path d="M23 11H13.2v4.2H23V21h-4.4" stroke="${CANVAS}" stroke-width="3.6" fill="none"/><rect x="11.4" y="19.2" width="5.4" height="5.4" fill="${CANVAS}"/>`,
  qc:  `<path d="M23 11H13.2v4.2H20" stroke="${CANVAS}" stroke-width="3.6" fill="none" opacity=".42"/><path d="M23 21h-9.8" stroke="${CANVAS}" stroke-width="3.6"/><path d="M20 15.2h3" stroke="${CANVAS}" stroke-width="3.6"/>`,
};

const SITES = [
  { dir: 'root',      mark: 'sd',  accent: '#2457FF', name: 'Singh Dynamics', kicker: 'Novi, Michigan', headline: 'We build systems that remove work.', foot: 'singhdynamics.com' },
  { dir: 'sales',     mark: 'web', accent: '#2457FF', name: 'Singh Dynamics', kicker: 'Websites for local business', headline: 'We build it first. Then you decide.', foot: 'sales.singhdynamics.com' },
  { dir: 'singhar',   mark: 'ar',  accent: '#0F6B57', name: 'Singh AR', kicker: 'B2B accounts receivable', headline: 'Automate the routine. Gate the exceptions.', foot: 'singhar.singhdynamics.com' },
  { dir: 'websiteqc', mark: 'qc',  accent: '#5237B8', name: 'Website QC', kicker: 'For AI-generated sites', headline: 'Find the bugs your AI builder left behind.', foot: 'websiteqc.singhdynamics.com' },
];

function html(s) {
  const size = s.headline.length > 44 ? 68 : 78;
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600&family=Inter:wght@400&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{width:1200px;height:630px;background:${CANVAS};color:${INK};overflow:hidden;font:400 17px/1.6 Inter,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
.card{position:relative;width:100%;height:100%;padding:74px 82px;display:flex;flex-direction:column;justify-content:space-between}
.lock{display:flex;align-items:center;gap:14px}.nm{font-family:Archivo,sans-serif;font-weight:600;font-size:27px;letter-spacing:-.025em}.kick{display:block;font-size:17px;color:${MUTED};margin-top:2px}
h1{font-family:Archivo,sans-serif;font-size:${size}px;font-weight:600;line-height:1.06;letter-spacing:-.035em;max-width:16ch}.bar{height:7px;width:104px;background:${s.accent};margin-bottom:26px}.foot{display:flex;justify-content:space-between;align-items:center;border-top:1px solid ${RULE};padding-top:24px;font-size:19px;color:${MUTED}}.geo{position:absolute;right:-70px;top:118px;width:430px;opacity:.5}
</style></head><body><div class="card">
<div class="lock"><svg width="42" height="42" viewBox="0 0 32 32"><path d="M4 4h13a11 11 0 0 1 11 11v2a11 11 0 0 1-11 11H4z" fill="${s.accent}"/>${MARKS[s.mark]}</svg><span><span class="nm">${s.name}</span><span class="kick">${s.kicker}</span></span></div>
<svg class="geo" viewBox="0 0 380 300" fill="none"><path d="M20 20h150a120 120 0 0 1 120 120v20a120 120 0 0 1-120 120H20z" stroke="${s.accent}" stroke-width="1.25" opacity=".4"/><path d="M380 96H128v48h252v52H128" stroke="${s.accent}" stroke-width="2.25"/><rect x="20" y="96" width="11" height="152" fill="${s.accent}"/></svg>
<div><div class="bar"></div><h1>${s.headline}</h1></div><div class="foot"><span>${s.foot}</span><span>Singh Dynamics</span></div></div></body></html>`;
}

const only = process.argv[2];
const targets = only ? SITES.filter((s) => s.dir === only) : SITES;
if (targets.length === 0) { console.error('No site matches: ' + only); process.exit(1); }
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
for (const s of targets) {
  await page.setContent(html(s), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  mkdirSync('site/' + s.dir, { recursive: true });
  await page.screenshot({ path: 'site/' + s.dir + '/og-image.png' });
  console.log('wrote site/' + s.dir + '/og-image.png');
}
await browser.close();
