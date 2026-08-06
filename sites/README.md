# shopsites

Static site generator for small local businesses. One JSON file per shop becomes
one complete, self-contained website. Python 3.8+, zero dependencies.

Built for the venture studio's website line: find shops with no website in Google
Maps, build the site before the conversation, sell it already finished.

```bash
python3 build.py            # build every shop in shops/
python3 build.py 2wheelmax  # build one
python3 build.py --check                    # validate configs, write nothing
python3 build.py --generated-only --preview # noindex staging previews
```

Output lands in `dist/<slug>/` as a single `index.html` plus `robots.txt` and
`sitemap.xml`. A full six-service page is about 14 KB. That is the entire site.

---

## Why it is built this way

**Single file, inlined CSS, no JavaScript.** One request, instant paint on a phone
on rural LTE, which is the actual device and connection your customer's customer is
using. Nothing to build, nothing to version, no framework to go stale in eight
months when you have two hours a week.

**Every page is a phone call funnel.** The number is in the sticky header, the hero,
the location block, the closing section, and a fixed bar pinned to the bottom of
every mobile screen. A local service business does not need a contact form. It needs
someone to tap a button.

**Server-rendered HTML, not a React app.** Search and answer engines receive the
actual business facts in the first response instead of waiting for client-side
JavaScript. That makes the page simpler to crawl, quote and verify.

**Answer-engine readable by default.** Live builds include a visible Quick answers
section plus LocalBusiness, WebSite and Service JSON-LD built only from verified
config fields. `robots.txt` explicitly allows OAI-SearchBot in addition to the normal
open crawler rule. Prospect previews use `noindex,nofollow` so unfinished drafts do
not become search results. We intentionally do not emit FAQPage schema for ordinary
local businesses, and none of this guarantees a ranking or an AI citation.

**Four themes.** Set `theme` to `steel`, `pine`, `clay`, or `ice`. Each changes hue,
accent, heading weight and corner radius together. Vary it between shops in the same
town. Two clients who look like the same template is how the whole line loses its
credibility at once.

---

## Adding a shop

1. Copy `shops/_TEMPLATE.json` to `shops/<slug>.json`. Files starting with `_`
   are skipped by the builder.
2. Fill in the required fields from the shop's Google Maps listing: name, city,
   state, phone, and at least three services.
3. Run `python3 build.py --check` until it reports clean.
4. Run `python3 build.py <slug>` and open `dist/<slug>/index.html` in a browser.

`shops/demo-shop.json` is a fully filled fictional example. `shops/2wheelmax.json`
is a real lead with the unknown fields marked `TODO`, which is what a config looks
like before you have talked to the owner.

### The validator will stop you

`build.py` refuses to build on missing required fields, a phone number that is not
ten or eleven digits, or an unknown theme. It warns loudly on leftover `TODO`
markers, missing hours, missing street address, and fewer than three services.
The warnings are all things that make a page look unfinished to a paying customer.

### Never invent data

No fabricated phone numbers, addresses, hours, or reviews. Quote Google reviews
verbatim or leave the section out. Beyond being dishonest, a wrong phone number on a
real business's website is the single fastest way to lose the client and the referral
chain behind them.

### One thing that can earn a Google penalty

`aggregate_rating.enabled` defaults to `false`. Leave it there. Marking up review
scores collected on Google as your client's own structured data violates Google's
guidelines and can trigger a manual action against the site. The rating still shows
as an on-page trust chip when you fill in `value` and `count`, which is fine and
carries no risk. Only set `enabled: true` if the shop collects reviews on their own
domain, which none of these will.

---

## Deploying

Cloudflare Pages, free tier. Unlimited sites, unlimited bandwidth, global CDN,
automatic SSL, $0 forever at this scale.

```bash
npx wrangler pages deploy dist/<slug> --project-name=<slug>
```

Then point the domain at it in the Cloudflare dashboard.

**Have the client buy their own domain, in their own name, on their own card.**
About $12/year. This costs you nothing and removes the objection that you are holding
their business hostage. It also means when they leave, they leave with their domain
and no hard feelings, which is where referrals come from. Registering domains under
your own account to create lock-in is the thing that makes local web guys hated.

---

## Pricing

**$400 to $700 one-time build, then $50 to $75 a month optional.**

The retainer covers hosting, Google Business Profile management, content updates,
seasonal hours changes, and new photos. Roughly zero marginal cost to you, which is
the entire reason it is worth more than the build.

Sell the build first, offer the retainer at handoff once they have seen the thing
exist. Do not bundle it into the opening pitch. It doubles the number of decisions
and halves the close rate.

### Two things to be honest with yourself about

**The retainer is the business, not the builds.** A $500 build is a one-time $500.
Ten clients at $60 a month is $7,200 a year at near-zero cost, and it keeps you in
the door of the exact shops you want parts invoices from in 2027. Track retainer
conversion, not build count.

**You cannot collect money yet.** Stripe, Square, and business bank accounts all
require 18+. At 16 you need an adult on the account. This is a hard blocker on the
whole line and it is worth solving before the first pitch, not after the first yes.

---

## Google Business Profile

For roughly half these shops, a fully completed GBP is worth more than the website,
and it is free. Categories, services, hours, photos, and Q&A drive the Maps ranking
that actually produces their phone calls.

You cannot claim a listing on someone's behalf. Verification goes to the business
itself by phone, postcard, or video. The owner has to do that step, ideally with you
on the phone walking them through it, and can add you as a manager afterward.

Sell it as part of the retainer, not as a separate product.

---

## Files

```
build.py                 generator, themes, validator, schema
shops/_TEMPLATE.json     annotated blank, copy this
shops/demo-shop.json     fictional, fully filled reference
shops/2wheelmax.json     real lead, unknown fields marked TODO
dist/                    generated output, safe to delete and rebuild
```
