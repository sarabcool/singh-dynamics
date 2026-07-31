# DNS records for singhdynamics.com

Add these in Cloudflare: dash.cloudflare.com → singhdynamics.com → DNS → Records.

**Set every one of these to DNS only (grey cloud), not Proxied (orange).**
Proxying breaks mail authentication, and this is the single most common way a
sending domain silently fails to verify.

---

## 1. DKIM, TXT

Proves the mail actually came from you. Without it every message lands in spam.

```
Type:    TXT
Name:    resend._domainkey
TTL:     Auto
Content: p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDsmFIgdQT8iarxoMMuf/0spxR9Euy2iZ/N4ksHELWGI42elCFfgNci8D8e5OxU4i0mOU+0XovCDp2CjhoVAuDYBIIvgl72p5+RItgYvGyMh/ae+GWhpuP6pfBwgWG8SUFGD1x0Y9/Pzgr7q0RBfdtX5SzB6PzipZ9GdFCK4PWucwIDAQAB
```

Paste that value as one unbroken line. A stray space or line break invalidates
the whole key and the failure looks exactly like "not verified yet."

## 2. SPF, MX

Handles bounces and complaints on the return path.

```
Type:     MX
Name:     send
TTL:      Auto
Priority: 10
Content:  feedback-smtp.us-east-1.amazonses.com
```

## 3. SPF, TXT

Authorizes Resend's servers to send as your domain.

```
Type:    TXT
Name:    send
TTL:     Auto
Content: v=spf1 include:amazonses.com ~all
```

## 4. DMARC, TXT

Not required by Resend, and I am recommending it anyway.

You are about to send cold email from a brand new domain with no sending
reputation. That is the exact profile spam filters distrust most. DMARC tells
receiving servers you have deliberately configured authentication, and Gmail in
particular treats its absence as a negative signal for bulk senders.

```
Type:    TXT
Name:    _dmarc
TTL:     Auto
Content: v=DMARC1; p=none; rua=mailto:dmarc@singhdynamics.com
```

`p=none` means monitor without rejecting anything, which is correct while you
have no sending history. Tighten it to `p=quarantine` after a month of clean
reports. Do not start at `quarantine` or `reject`: a misconfiguration there
silently kills your own mail.

---

## After adding them

Records propagate in seconds on Cloudflare. Then verification runs against
Resend, and the domain flips from `not_started` to `verified`.

Do not send anything until it reads verified. Mail sent from an unverified
domain fails authentication, and early spam complaints permanently damage a
domain's reputation. There is no undo on that.

---

## Warming, before the first real campaign

A brand new domain sending 40 cold emails on day one looks exactly like a
spammer, because that is what spammers do.

- Week 1: fewer than 10 a day, ideally to people who will reply
- Week 2: up to 20 a day
- Week 3 onward: normal volume

The nightly draft job respects this automatically. It is worth knowing why the
cap exists so you do not raise it out of impatience: domain reputation takes
weeks to build and one bad week to destroy, and you cannot buy a new one to
escape it because the new one starts with no reputation either.

---

## Current state

| Thing | Status |
|---|---|
| Domain registered | done, singhdynamics.com |
| DKIM | **verified** 31 Jul 2026 |
| SPF MX | **verified** 31 Jul 2026 |
| SPF TXT | **verified** 31 Jul 2026 |
| Resend sending | **enabled and verified** |
| D1 database | live, `231279c0-6589-47a3-a3cc-ae7ba8713670` |
| Schema applied | 8 tables, 7 indexes |

Sending is live. The remaining blocker on outbound is not technical: it is the
CAN-SPAM physical address, which needs the virtual mailbox and the notarized
Form 1583. No cold email goes out before that exists.
