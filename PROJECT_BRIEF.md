# Singh Dynamics Project Brief

This document is the single source of truth for ChatGPT, Claude, and human collaborators working on the current Singh Dynamics customer-acquisition strategy. Keep statements neutral and distinguish confirmed facts from open questions.

## Current offer

Build simple websites for independent local businesses that do not already have a functioning website. The immediate objective is to validate demand through a small manual outreach test; Singh Dynamics has not yet attempted customer outreach.

## Current target market

- Primary: independent Metro Detroit auto businesses, including repair, tire, transmission, collision/body, quick-lube, muffler, and brake shops.
- Qualification: the business must be independently verified as having no functioning website before outreach.
- Trades are deprioritized because the tested trade segment was substantially more website-saturated than auto for this offer.

## Findings and tests

- Google Places API has no email field. A dataset of 1,392 leads yielded only 2 emails from other available enrichment paths.
- A plumbing sweep saw 195 businesses and rejected 180 because Google Places reported an existing website (about 92%). Previous auto results were about 24% website-saturated, making auto the stronger market for this offer.
- Emails can appear on Facebook Contact tabs even when search engines do not expose them. Observed coverage was roughly 1 in 6 checked businesses, and about half of the businesses did not have a Facebook page.
- In a small manual sample of 6 leads marked as having no website, 3 actually had websites: Uncle Sam's Tires, Save On Tire, and Advance Tire.

## What failed or proved unreliable

- Treating a missing Google Places `websiteUri` as proof that a business has no website.
- Depending on Google Places for email addresses.
- Using trade sweeps as the next expansion path for this offer; the plumbing test showed much higher website saturation than auto.
- The original email-first outreach plan is not suitable for the immediate validation test because email coverage is too low.

## Known data-quality issues

- A null `websiteUri` means only that the owner did not supply a website to Google Places; it does not prove that no website exists.
- The small verification sample produced roughly 50% false negatives for the Places website field. The sample is small, but the risk is large enough that independent verification is mandatory.
- Before any outreach, search the business name and location and classify the result as `verified_no_website`, `website_found`, or `uncertain`. Only `verified_no_website` leads may receive a no-website pitch.
- Facebook matching must use corroborating details such as location, address, or phone, not business name alone.

## Current outreach method

- First contact: manual Facebook Messenger outreach to an initial test group of approximately 10–20 qualified leads.
- Outreach has not started yet.
- The email pipeline remains built but unused for now.
- No lead should be contacted until its website status and Facebook page match have been independently verified.

## Explicit constraints

- Do not automate Facebook Messenger or other social direct messages. Meta does not permit this business-initiated messaging use case, and the owner's personal account must not be put at risk.
- Do not send email outreach for the current test.
- Do not run HVAC or landscaping sweeps for now.
- Do not describe a business as website-less based only on a missing Google Places `websiteUri`.
- Do not contact any lead whose website status is `uncertain`.

## Backend and pipeline status

- Google Places discovery and lead storage exist.
- The lead schema includes `facebook_url`, but the current dataset is 0% populated in that field.
- The enrichment path can store discovered websites, emails, and Facebook URLs, but the strategy requires a reliable independent website-verification gate before outreach.
- The email pipeline is built and intentionally paused.
- Messenger outreach must remain manual; no Messenger automation should be added.

## Immediate priorities

1. Add or strengthen independent website verification before any outreach. Record `verified_no_website`, `website_found`, or `uncertain` and preserve verification evidence.
2. Populate and verify `facebook_url` using business name plus location, address, or phone.
3. Produce a queue of approximately 10–20 leads that are both `verified_no_website` and matched to a valid Facebook page.
4. Run the first outreach test manually through Facebook Messenger and record outcomes.

## Open questions

- What exact evidence and review process are sufficient to assign `verified_no_website`?
- Should website verification be fully manual for the first 10–20 leads, or should automation propose results for human approval?
- Which fields should record verification evidence, timestamp, reviewer, and confidence?
- What message variants and success metrics should be used for the first manual outreach test?
- After the first test, what response threshold justifies continuing, revising, or stopping the offer?

## Update protocol

When evidence, strategy, scope, or constraints change, update this document first in the same change that affects implementation or operations. ChatGPT, Claude, and human collaborators should read it before proposing or executing work. Do not silently override it in chat, prompts, code, or automation; record the change here, include the supporting evidence, and remove or revise superseded statements.
