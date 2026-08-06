/**
 * Deep enrichment for qualified leads from the active website offer.
 * Tier A: research, scoring refinement and preview generation only. Never sends.
 */
import { query } from '@anthropic-ai/claude-agent-sdk';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { OFFER, offerContext } from './config/offer.mjs';

const { ANTHROPIC_API_KEY, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, D1_DATABASE_ID, MAX_LEADS='15', MAX_COST_CENTS='150' } = process.env;
const PILOT_PREVIEW_SLUG = String(MAX_LEADS).startsWith('pilot:') ? String(MAX_LEADS).slice('pilot:'.length).trim() : null;
if (!ANTHROPIC_API_KEY && !PILOT_PREVIEW_SLUG) { console.error('ANTHROPIC_API_KEY missing'); process.exit(1); }
const parsedMaxLeads = Number(MAX_LEADS);
const RUN_MAX_LEADS = PILOT_PREVIEW_SLUG ? 0 : Math.min(Number.isFinite(parsedMaxLeads) && parsedMaxLeads >= 0 ? parsedMaxLeads : 8, 8);
const RUN_MAX_COST_CENTS = Math.min(Number(MAX_COST_CENTS) || 75, 75);
const PREVIEW_PROJECT = 'sarabcool-singh-dynamics-previews';

async function d1(sql, params=[]) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database/${D1_DATABASE_ID}/query`, {
    method:'POST', headers:{authorization:`Bearer ${CLOUDFLARE_API_TOKEN}`,'content-type':'application/json'}, body:JSON.stringify({sql,params}),
  });
  const body=await res.json();
  if(!body.success) throw new Error(`D1 error: ${JSON.stringify(body.errors)}`);
  return body.result?.[0]?.results ?? [];
}

async function ensurePagesProject(name) {
  const base = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects`;
  const headers = {
    authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
    'content-type': 'application/json',
  };

  let res = await fetch(`${base}/${encodeURIComponent(name)}`, { headers });
  if (res.ok) {
    const body = await res.json();
    if (!body.success || !body.result?.subdomain) {
      throw new Error(`Pages project lookup failed: ${JSON.stringify(body.errors || body)}`);
    }
    return body.result;
  }
  if (res.status !== 404) {
    throw new Error(`Pages project lookup failed: ${res.status} ${await res.text()}`);
  }

  res = await fetch(base, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name, production_branch: 'main' }),
  });
  const body = await res.json();
  if (!res.ok || !body.success || !body.result?.subdomain) {
    throw new Error(`Pages project create failed: ${res.status} ${JSON.stringify(body.errors || body)}`);
  }
  return body.result;
}

const SYSTEM = `
You are the research arm of Singh Dynamics, running unattended.
${offerContext()}

Research only. Never contact anyone. Never invent facts. A field that cannot be verified stays null.
A score without a concrete reason is invalid. A business with a functioning website is disqualified from this offer.
Prefer independent auto repair businesses where a simple fast website can turn local search traffic into phone calls.
`.trim();

const started=Date.now(); let costCents=0, enriched=0, generated=0;
const leads=await d1(`SELECT id, slug, name, city, state, phone, website, maps_url, review_count, score, storefront, primary_type
  FROM leads WHERE vertical=? AND disqualified=0 AND website IS NULL AND phone IS NOT NULL
  AND storefront='yes' AND COALESCE(score,0) >= ? AND (email IS NULL OR score IS NULL)
  ORDER BY COALESCE(score,0) DESC, first_seen_at LIMIT ?`, [OFFER.vertical, OFFER.scoring.high, RUN_MAX_LEADS]);
console.log(`enriching ${leads.length} lead(s) for offer=${OFFER.id}`);
mkdirSync('sites/shops',{recursive:true});

for(const lead of leads){
  if(costCents>=RUN_MAX_COST_CENTS){console.log('cost ceiling reached');break;}
  const prompt=`Research this business. Return ONLY JSON, no code fence.
name: ${lead.name}\ncity: ${lead.city}, ${lead.state}\ntype: ${lead.primary_type??'unknown'}\nmaps: ${lead.maps_url||'unknown'}\nphone: ${lead.phone}\nreviews: ${lead.review_count??'unknown'}
Return exactly: {"still_operating":boolean,"disqualified":boolean,"disqualify_reason":string|null,"score":number,"score_reason":string,"priority":"HIGH"|"MEDIUM"|"LOW","phone":string|null,"email":string|null,"website":string|null,"facebook_url":string|null,"address_street":string|null,"address_zip":string|null,"services":[{"name":string,"desc":string}],"review_quotes":[{"text":string,"author":string,"stars":number}]}`;
  let raw='';
  try{
    for await(const msg of query({prompt,options:{model:'claude-sonnet-5',systemPrompt:SYSTEM,allowedTools:['WebSearch','WebFetch'],permissionMode:'bypassPermissions',maxTurns:12}})){
      if(msg.type==='assistant') for(const block of msg.message.content??[]) if(block.type==='text') raw+=block.text;
      if(msg.type==='result') costCents+=Math.round((msg.total_cost_usd??0)*100);
    }
  }catch(err){console.error(`[${lead.slug}] agent error: ${err.message}`);continue;}
  let data; try{data=JSON.parse(raw.replace(/^```(?:json)?|```$/gm,'').trim());}catch{console.error(`[${lead.slug}] unparseable response`);continue;}
  const discoveredWebsite=data.website??null;
  const disqualified=Boolean(data.disqualified || discoveredWebsite);
  const disqualifyReason=discoveredWebsite ? 'functioning website found during enrichment' : (data.disqualify_reason??null);
  await d1(`UPDATE leads SET score=?,score_reason=?,priority=?,disqualified=?,disqualify_reason=?,phone=COALESCE(?,phone),email=COALESCE(?,email),website=COALESCE(?,website),facebook_url=COALESCE(?,facebook_url),address_street=COALESCE(?,address_street),address_zip=COALESCE(?,address_zip),last_seen_at=datetime('now') WHERE id=?`, [data.score??lead.score??null,data.score_reason??null,data.priority??null,disqualified?1:0,disqualifyReason,data.phone??null,data.email??null,discoveredWebsite,data.facebook_url??null,data.address_street??null,data.address_zip??null,lead.id]);
  enriched++;
  if(!disqualified && (data.score??0)>=OFFER.scoring.high && data.phone){
    writeFileSync(`sites/shops/${lead.slug}.json`,JSON.stringify({_generated:`discover.mjs ${new Date().toISOString()}`,_offer:OFFER.id,_review_before_shipping:true,slug:lead.slug,name:lead.name,city:lead.city,state:lead.state,phone:data.phone,theme:OFFER.site.themes[lead.id%OFFER.site.themes.length],schema_type:OFFER.site.schemaType,services:data.services??[],address:{street:data.address_street??'',zip:data.address_zip??''},maps_url:lead.maps_url??'',reviews:data.review_quotes??[],aggregate_rating:{enabled:false,value:'',count:lead.review_count??''}},null,2));
    generated++;
  }
}

let pilotPreviewUrl = null;
if (generated > 0 || PILOT_PREVIEW_SLUG) {
  if (PILOT_PREVIEW_SLUG) {
    const configPath = `sites/shops/${PILOT_PREVIEW_SLUG}.json`;
    if (!existsSync(configPath)) throw new Error(`pilot preview config not found: ${configPath}`);
    console.log(`building zero-AI pilot preview: ${PILOT_PREVIEW_SLUG}`);
    const buildCommand = PILOT_PREVIEW_SLUG === 'khalsa-computers'
      ? 'python3 sites/build_khalsa.py --preview'
      : `python3 sites/build.py ${PILOT_PREVIEW_SLUG} --preview`;
    execSync(buildCommand, { stdio: 'inherit' });
  } else {
    console.log(`building and deploying ${generated} deterministic preview config(s)`);
    execSync('python3 sites/build.py --generated-only --preview', { stdio: 'inherit' });
  }

  const project = await ensurePagesProject(PREVIEW_PROJECT);
  const previewBaseUrl = project.subdomain.startsWith('http')
    ? project.subdomain
    : `https://${project.subdomain}`;

  const commitHash = process.env.GITHUB_SHA ? ` --commit-hash=${process.env.GITHUB_SHA}` : '';
  execSync(
    `npx --yes wrangler@latest pages deploy sites/dist --project-name=${PREVIEW_PROJECT} --branch=main${commitHash}`,
    { stdio: 'inherit', env: process.env }
  );

  if (PILOT_PREVIEW_SLUG) {
    pilotPreviewUrl = `${previewBaseUrl}/${encodeURIComponent(PILOT_PREVIEW_SLUG)}/`;
    console.log(`pilot preview: ${pilotPreviewUrl}`);
  } else {
    execSync('node agent/publish-previews.mjs', {
      stdio: 'inherit',
      env: { ...process.env, PREVIEW_BASE_URL: previewBaseUrl },
    });
  }
}

await d1(`INSERT INTO runs (job,trigger,finished_at,ok,items_in,items_out,cost_cents,gh_run_url,summary) VALUES ('discover-leads',?,datetime('now'),1,?,?,?,?,?)`,[process.env.GITHUB_EVENT_NAME||'manual',leads.length,enriched,costCents,process.env.GITHUB_RUN_URL||null,`offer=${OFFER.id}; enriched ${enriched}/${leads.length}; generated ${generated} preview config(s) in ${Math.round((Date.now()-started)/1000)}s`]);
console.log(`done. ${enriched} enriched, ${generated} preview config(s), ${costCents}c spent.`);
if(process.env.GITHUB_OUTPUT){execSync(`echo "enriched=${enriched}" >> "$GITHUB_OUTPUT"`);execSync(`echo "generated=${generated}" >> "$GITHUB_OUTPUT"`);execSync(`echo "cost_cents=${costCents}" >> "$GITHUB_OUTPUT"`);}
