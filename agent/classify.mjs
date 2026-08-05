import { d1, assertD1Env, logRun } from './lib/d1.mjs';
import { OFFER, offerContext } from './config/offer.mjs';

const { ANTHROPIC_API_KEY, MAX_COST_CENTS='100' }=process.env;
const DRY=process.argv.includes('--dry-run');
function argOf(flag,fallback){const i=process.argv.indexOf(flag);return i>-1?process.argv[i+1]:fallback;}
const LIMIT=Number(argOf('--limit',120));
const BATCH=20;
assertD1Env();
if(!ANTHROPIC_API_KEY&&!DRY){console.error('ANTHROPIC_API_KEY missing');process.exit(1);}
let anthropic=null;
if(!DRY){const {default:Anthropic}=await import('@anthropic-ai/sdk');anthropic=new Anthropic({apiKey:ANTHROPIC_API_KEY});}

const SYSTEM=`
You classify leads for Singh Dynamics. You run unattended.
${offerContext()}

Every row has already passed deterministic checks for no website, a working phone, and a street address.
Your main judgement is whether it is a real customer-facing commercial location and whether it fits the active offer.
If the address does not settle storefront status, answer unclear. Never invent facts.
Set disqualify=true for a franchise/chain, manufacturer dealership, obviously residential-only operation, or a business that plainly cannot buy this offer.
fit_score is 0-100. Favor established independent auto repair businesses where local search visibility can drive calls.
`.trim();

function buildPrompt(rows){return `Return ONLY a JSON array with one object per business, matched by id:\n[{"id":number,"storefront":"yes"|"no"|"unclear","reason":string,"fit_score":0-100,"disqualify":boolean,"disqualify_reason":string|null}]\n\n${rows.map(r=>`id: ${r.id}\nname: ${r.name}\ntype: ${r.primary_type??'unknown'}\naddress: ${r.address_street??'?'}, ${r.city}, MI ${r.address_zip??''}\nreviews: ${r.review_count??'unknown'} rating: ${r.rating??'unknown'}`).join('\n\n')}`;}

const leads=await d1(`SELECT id,name,city,address_street,address_zip,review_count,rating,primary_type FROM leads
 WHERE vertical=? AND storefront IS NULL AND disqualified=0 AND website IS NULL AND phone IS NOT NULL
 ORDER BY review_count DESC NULLS LAST LIMIT ?`,[OFFER.vertical,LIMIT]);
console.log(`classify: offer=${OFFER.id} -> ${leads.length} lead(s)`);
if(!leads.length){
  const elsewhere=await d1(`SELECT vertical,COUNT(*) AS n FROM leads WHERE storefront IS NULL AND disqualified=0 AND website IS NULL AND phone IS NOT NULL GROUP BY vertical ORDER BY n DESC`);
  const stranded=elsewhere.filter(r=>r.vertical!==OFFER.vertical);
  const detail=stranded.map(r=>`${r.vertical}=${r.n}`).join(', ');
  await logRun({job:'classify',ok:1,itemsIn:0,itemsOut:0,summary:`offer=${OFFER.id}; queue empty${detail?`; legacy/unrelated rows: ${detail}`:''}`});
  if(detail) console.log(`::notice::active offer queue empty; unrelated verticals remain: ${detail}`);
  process.exit(0);
}
if(DRY){console.log(SYSTEM);console.log(buildPrompt(leads.slice(0,BATCH)));process.exit(0);}

let costCents=0,classified=0,batchErrors=0;const tally={yes:0,no:0,unclear:0,disqualified:0};
for(let i=0;i<leads.length;i+=BATCH){
  if(costCents>=Number(MAX_COST_CENTS)){console.log('cost ceiling reached');break;}
  const batch=leads.slice(i,i+BATCH);let msg;
  try{msg=await anthropic.messages.create({model:'claude-sonnet-5',max_tokens:16000,system:SYSTEM,messages:[{role:'user',content:buildPrompt(batch)}]});}
  catch(err){console.error(`batch api error: ${err.message}`);batchErrors++;continue;}
  costCents+=(msg.usage.input_tokens/1e6)*3*100+(msg.usage.output_tokens/1e6)*15*100;
  const raw=msg.content.filter(b=>b.type==='text').map(b=>b.text).join('');
  let verdicts;try{verdicts=JSON.parse(raw.replace(/^```(?:json)?|```$/gm,'').trim());}catch{console.error('unparseable batch');batchErrors++;continue;}
  if(!Array.isArray(verdicts)){batchErrors++;continue;}
  const ids=new Set(batch.map(b=>b.id));
  for(const v of verdicts){
    if(!ids.has(v.id)) continue;
    const storefront=['yes','no','unclear'].includes(v.storefront)?v.storefront:'unclear';
    const score=Number.isFinite(v.fit_score)?Math.max(0,Math.min(100,Math.round(v.fit_score))):null;
    const priority=score===null?null:score>=OFFER.scoring.high?'HIGH':score>=OFFER.scoring.medium?'MEDIUM':'LOW';
    await d1(`UPDATE leads SET storefront=?,storefront_reason=?,score=?,score_reason=?,priority=?,disqualified=?,disqualify_reason=?,last_seen_at=datetime('now') WHERE id=?`,[storefront,v.reason??null,score,v.reason??null,priority,v.disqualify?1:0,v.disqualify_reason??null,v.id]);
    classified++;tally[storefront]++;if(v.disqualify)tally.disqualified++;
  }
}
const summary=`offer=${OFFER.id}; yes:${tally.yes} no:${tally.no} unclear:${tally.unclear} disqualified:${tally.disqualified}`;
await logRun({job:'classify',ok:batchErrors===0?1:0,itemsIn:leads.length,itemsOut:classified,costCents:Math.round(costCents),summary,error:batchErrors?`${batchErrors} batch(es) failed`:null});
console.log(`done. ${classified}/${leads.length}. ${summary}`);
if(batchErrors)process.exit(1);
