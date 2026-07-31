# Authorization Checklist

Everything I need to run the studio autonomously. Nothing on this list is
optional, and nothing that is not on this list is needed.

Costs are marked one-time or recurring. Total recurring lands at **$36-81/month**.

**Read section 0 first.** Two items have to start this week or the whole August
timeline slips by two weeks, and neither of them is the one you would guess.

---

## 0. The two long poles, start these within 48 hours

Everything that lets you accept money is chained behind the LLC:

```
LLC filed  ->  7-10 business days  ->  EIN (instant)  ->  bank (1-3 days)  ->  Stripe (1-2 days)
```

If you file on 7 August as originally planned, you cannot accept a payment until
roughly 25 August. If you file this week, you can accept payment the week of 11
August. Same work, two weeks earlier, and it costs nothing extra to start now.

The virtual mailbox has the same problem for a different reason: it needs a
notarized form, and scheduling a notary is the slow part.

| # | Item | Who | Cost | Notes |
|---|---|---|---|---|
| 0.1 | **Michigan LLC, Articles of Organization** | Dad | **$50** one-time | File at LARA. Dad as member/manager, you as operator. 7-10 business days standard. Expedited is available for an extra fee and is worth it if you want to compress further. Annual statement is $25/yr due 15 Feb |
| 0.2 | **Virtual mailbox** | Dad | **$10-15/mo** | Required for CAN-SPAM, see section 4. Needs USPS Form 1583 plus **two forms of ID and a notary**. Remote online notarization is accepted in Michigan. Anytime Mailbox or Stable both work |

Do not wait for the 7 August batch on these two.

---

## 1. Legal and financial. Dad only, identity-gated

These require a legal adult and a real identity. No architecture removes them.

| # | Item | Who | Cost | Unlocks |
|---|---|---|---|---|
| 1.1 | **EIN from the IRS** | Dad | **Free** | Instant online once the LLC exists. Required for everything below. Never pay a service for this |
| 1.2 | **Business bank account** | Dad | **$0** | Mercury or a local credit union. Needs EIN plus LLC documents. Do not run business money through a personal account |
| 1.3 | **Stripe account** | Dad | **2.9% + 30c** per charge | Build fees and recurring retainers. Stripe Billing handles subscriptions natively, so no separate billing tool |
| 1.4 | **Operating agreement + your equity MOU** | Dad + you | **$0** | Already flagged as pending. Put your split in writing before there is money to argue about. This is the single cheapest thing on this list and the one people skip |

**Why the LLC and not just a sole proprietorship:** contracts signed by a minor
are voidable, which makes your agreements weak and makes clients hesitant. The
LLC contracts, not you. It also separates business liability from your family's
personal assets, which matters the first time a client site goes down.

---

## 2. Infrastructure. Dad's card, I operate

| # | Item | Who | Cost | What I do with it |
|---|---|---|---|---|
| 2.1 | **Anthropic API account + billing** | Dad creates, 18+ | **$20-60/mo** usage | This is the brain. Without it there is no autonomous loop, only this chat window. Set a monthly spend cap in the console so it cannot surprise you |
| 2.2 | **Cloudflare account + Workers Paid** | Dad creates, I operate | **$5/mo** | Workers, Pages, D1, R2, Queues, Cron. Hosts every client site and the always-on layer |
| 2.3 | **GitHub account or org** | Either | **$0** | Repo, Actions, secrets. Free tier is genuinely enough: unlimited Actions minutes on public repos, 2,000/mo private |
| 2.4 | **Studio domain** | Dad | **~$12/yr** | Sending domain for outbound email and the studio's own site. Never send business email from a gmail address. Buy through Cloudflare at cost |
| 2.5 | **Resend account** | Either | **$0** | Free tier covers 3,000 emails/mo. Needs DNS records on 2.4, which I set up through Cloudflare |

**Set the Anthropic spend cap on day one.** An agent loop with a bug can burn
budget quietly. A hard cap turns a bad night into an annoyance instead of a bill.

---

## 3. Cowork connectors. You, in the app, about two minutes

These are the click-to-connect ones. **Connect them after the accounts in section
2 exist**, since each one authenticates against an account.

| Connector | Why | When |
|---|---|---|
| **Cloudflare Developer Platform** | I manage Workers, KV, D1 and deploys directly instead of handing you commands to paste | After 2.2 |
| **Resend** | I send and monitor transactional email, manage domains and templates | After 2.5 |
| **Stripe** | I create products, prices, customers and invoices for retainers | After 1.3 |

Already connected and working: **Gmail**, **Google Drive**, **Google Calendar**,
**Claude in Chrome**. Chrome is what ran the Maps sweep that produced your shop
list, so keep it.

**There is no GitHub connector in the registry.** Not a problem. I drive GitHub
through the API with a scoped token, and Actions is configured by committed YAML,
which is better anyway because the automation itself is version controlled.

---

## 4. Secrets, after the accounts exist

You create each token and paste it into GitHub repo secrets. I never see them in
chat and they never touch a file.

| Secret | Created in | Scope it to |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic console | Its own key for CI, separate from any you use elsewhere |
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard | **A scoped token, not the Global API Key.** Workers Scripts Edit, Pages Edit, D1 Edit, Zone DNS Edit. Nothing else |
| `RESEND_API_KEY` | Resend dashboard | Sending only |

**On the Cloudflare token specifically:** the Global API Key grants full account
access including billing and domain transfers, and it cannot be scoped down. Use
a custom token with only the four permissions above. If it ever leaks, the blast
radius is four services instead of your entire account.

---

## 5. What I do not need, and am not asking for

Worth stating plainly so the list stays honest.

- **No Lovable, n8n, Zapier, or Make.** Roughly $75/mo avoided. Workers plus
  Actions covers all of it and stays in version control
- **No VPS.** It would add a server you have to patch and secure
- **No SMS or voice provider.** TCPA damages are $500 to $1,500 per message with
  no cap, and the B2B carve-out does not cover automated messages to mobile
  numbers. I am not building this at any autonomy tier
- **No Meta or Facebook automation.** Violates their terms, and you already ruled
  out the channel
- **No CRM subscription.** D1 holds lead state. A CRM at this scale is a monthly
  fee for a table
- **No bookkeeping software yet.** Revisit when there are more than about five
  recurring clients
- **Not your bank login, card numbers, or personal identity documents.** I do not
  need them and should not have them. If any tool ever asks me for these, that is
  the signal something is wrong

---

## 6. Timeline

| When | What | Who | Time |
|---|---|---|---|
| **This week** | LLC filed. Virtual mailbox started with notary appointment | Dad | ~45 min |
| **Now to 7 Aug** | M0 validation, ten conversations. No infrastructure needed | You | The real work |
| **7 Aug, one sitting** | Anthropic, Cloudflare, GitHub, domain, Resend. All five | Dad + you | ~60 min |
| **7 Aug, right after** | Connect the three connectors, create and paste the three secrets | You | ~15 min |
| **~18 Aug, once the LLC clears** | EIN, bank, Stripe | Dad | ~45 min |
| **From 8 Aug** | I build. First autonomous loop is nightly lead discovery | Me | Continuous |

**Total of your dad's time across the whole thing: about two and a half hours,
across three sittings.** That is the real number, and after the last sitting he
is not in the loop again except for signatures and money decisions.

---

## 7. The honest caveat

Once these exist I can run the reversible parts of this business unattended:
discovery, enrichment, site generation, deploys, monitoring, drafting,
reporting, and my own code.

What stays yours, permanently, is not a tooling gap:

- The ten M0 conversations that decide whether the invoice product is real
- First contact with any stranger
- Anything that quotes a price or gets signed
- Approving the daily batch, about three minutes

That last list does not shrink with more connectors. It shrinks only if you
decide to accept the legal and reputational risk of automating it, and my
recommendation is that you do not.

---

## Sources

- [Michigan LLC filing fees](https://www.llcuniversity.com/michigan-llc/costs/)
- [USPS Form 1583 notarization](https://www.anytimemailbox.com/usps-form-1583)
- [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [GitHub Actions billing](https://docs.github.com/billing/managing-billing-for-github-actions/about-billing-for-github-actions)
- [TCPA damages and B2B limits](https://www.text-em-all.com/blog/sms-compliance-checklist-for-tcpa-safe-business-messaging)
