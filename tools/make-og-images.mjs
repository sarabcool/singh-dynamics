// Generates the og:image link-preview card for each marketing site.
//
// Runs in CI as a step of deploy-marketing-sites.yml, writing og-image.png into
// site/<dir>/ just before that folder is deployed to Cloudflare Pages. The PNGs
// are therefore never committed to git: the deploy artifact has them, the repo
// does not. Change a headline below, push, and the card regenerates.
//
// Fonts: CI runners have no SF Pro, so the site's system-ui stack would fall
// back to something ugly and non-deterministic. Inter is loaded from Google
// Fonts instead, the closest widely available analogue, so every runner renders
// the same card.
//
// Usage: node tools/make-og-images.mjs [dir]
// With no argument it generates all four.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const BG = '#0d1117';
const FG = '#e6edf3';
const MUTED = '#8b949e';
const ACCENT = '#f0883e';
const BORDER = '#21262d';
const SITES = [
  { dir: 'root', brandA: 'Singh', brandB: 'Dynamics', eyebrow: 'METRO DETROIT', foot: 'singhdynamics.com', headline: 'Software that runs the boring parts of a business on its own.' },
  { dir: 'sales', brandA: 'Singh', brandB: 'Dynamics', eyebrow: 'WEBSITE SALES', foot: 'sales.singhdynamics.com', headline: 'Websites for Michigan small businesses.' },
  { dir: 'singhar', brandA: 'Singh', brandB: 'AR', eyebrow: 'B2B ACCOUNTS RECEIVABLE', foot: 'singhar.singhdynamics.com', headline: 'Chasing unpaid invoices shouldn’t be a full-time job.' },
  { dir: 'websiteqc', brandA: 'Website', brandB: 'QC', eyebrow: 'FOR AI-GENERATED SITES', foot: 'websiteqc.singhdynamics.com', headline: 'Find the bugs your AI builder left behind.' },
  ];
function html(s) {
  const size = s.headline.length > 52 ? 62 : 70;
  return `<!doctype html><html><head><meta charset="utf-8">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700;800&display=swap" rel="stylesheet">
  <style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{width:1200px;height:630px;background:${BG};color:${FG};overflow:hidden;
  font:400 17px/1.7 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  -webkit-font-smoothing:antialiased}
  .card{position:relative;width:100%;height:100%;padding:76px 84px;
  display:flex;flex-direction:column;justify-content:space-between}
  .glow{position:absolute;top:-220px;right:-160px;width:620px;height:620px;
  background:radial-gradient(circle,${ACCENT}26 0%,transparent 68%)}
  .brand{font-weight:800;letter-spacing:-.03em;font-size:30px}
  .brand i{font-style:normal;color:${ACCENT}}
  .bar{height:8px;width:120px;background:${ACCENT};border-radius:4px;margin-bottom:30px}
  .eyebrow{font-size:16px;font-weight:700;letter-spacing:.15em;color:${ACCENT};margin-bottom:26px}
  h1{font-size:${size}px;font-weight:800;line-height:1.1;letter-spacing:-.025em;max-width:1000px}
  .foot{display:flex;align-items:center;justify-content:space-between;
</style></head><body><div class="card">
  <div class="glow"></div>
  <div class="brand">${s.brandA}<i>.</i>${s.brandB}</div>
  <div>
  <div class="bar"></div>
  <div class="eyebrow">${s.eyebrow}</div>
  <h1>${s.headline}</h1>
  </div>
  <div class="foot"><span>${s.foot}</span><span>Novi, Michigan</span></div>
  </div></body></html>`;
}
const only = process.argv[2];
const targets = only ? SITES.filter((s) => s.dir === only) : SITES;
if (targets.length === 0) {
  console.error('No site matches: ' + only);
  process.exit(1);
}
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
for (const s of targets) {
  await page.setContent(html(s), { waitUntil: 'load' });
  // Webfonts finish loading after the document does. Without this the card
// renders in the fallback face and loading Inter accomplishes nothing.
await page.evaluate(() => document.fonts.ready);
  mkdirSync('site/' + s.dir, { recursive: true });
  await page.screenshot({ path: 'site/' + s.dir + '/og-image.png' });
  console.log('wrote site/' + s.dir + '/og-image.png');
}
await browser.close();
