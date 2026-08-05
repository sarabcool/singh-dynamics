/**
 * Deep enrichment for qualified leads from the active website offer.
 * Tier A: research, scoring refinement and preview generation only. Never sends.
 */
import { query } from '@anthropic-ai/claude-agent-sdk';
import { writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { OFFER, offerContext } from './config/offer.mjs';

const { ANTHROPIC_API_KEY, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, D1_DATABASE_ID, MAX_LEADS='15', MAX_COST_CENTS='150' } = process.env;
if (!ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY missing'); process.exit(1); }

async function d1(sql, params=[]) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database/${D1_DATABASE_ID}/query`, {
    method:'POST', headers:{authorization:`Bearer ${CLOUDFLARE_API_TOKEN}`,'content-type':'application/json'}, body:JSON.stringify({sql,params}),
  });
  const body=await res.json();
  if(!body.success) throw new Error(`D1 error: ${JSON.stringify(body.errors)}`);
  return body.result?.[0]?.results ?? [];
}

const SYSTEM = `
You are the research arm of Singh Dynamics, running unattended.
${offerContext()}

Research only. Never contact anyone. Never invent facts. A field that cannot be verified stays null.
A score without a concrete reason is invalid. A business with a functioning website is disqualified from this offer.
Prefer independent auto repair businesses where a simple fast website can turn local search traffic into phone calls.
`.trim();

const started=Date.now(); let costCents=0, enriched=0;
const leads=await d1(`SELECT id, slug, name, city, state, phone, website, maps_url, review_count, score, storefront, primary_type
  FROM leads WHERE vertical=? AND disqualified=0 AND website IS NULL AND phone IS NOT NULL
  AND storefront='yes' AND (email IS NULL OR score IS NULL) ORDER BY COALESCE(score,0) DESC, first_seen_at LIMIT ?`, [OFFER.vertical, Number(MAX_LEADS)]);
console.log(`enriching ${leads.length} lead(s) for offer=${OFFER.id}`);
mkdirSync('sites/shops',{recursive:true});

for(const lead of leads){
  if(costCents>=Number(MAX_COST_CENTS)){console.log('cost ceiling reached');break;}
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
  }
}
await d1(`INSERT INTO runs (job,trigger,finished_at,ok,items_in,items_out,cost_cents,gh_run_url,summary) VALUES ('discover-leads',?,datetime('now'),1,?,?,?,?,?)`,[process.env.GITHUB_EVENT_NAME||'manual',leads.length,enriched,costCents,process.env.GITHUB_RUN_URL||null,`offer=${OFFER.id}; enriched ${enriched}/${leads.length} in ${Math.round((Date.now()-started)/1000)}s`]);
console.log(`done. ${enriched} enriched, ${costCents}c spent.`);
if(process.env.GITHUB_OUTPUT){execSync(`echo "enriched=${enriched}" >> "$GITHUB_OUTPUT"`);execSync(`echo "cost_cents=${costCents}" >> "$GITHUB_OUTPUT"`);}
