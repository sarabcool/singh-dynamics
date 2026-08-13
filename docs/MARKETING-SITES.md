# Marketing sites

Singh Dynamics runs four static marketing sites, one per subchannel plus a hub
at the root domain. None of these are the product itself, the product code
lives elsewhere (`agent/`, `sites/`, `docs/singh-ar/`). These are just the
public-facing pitch for each.

| Site | Path | Domain | Pages project | Subchannel |
|---|---|---|---|---|
| Hub | `site/root/` | `singhdynamics.com` and `www.` | `singh-dynamics-root` | none, links out to the three below |
| Website Sales | `site/sales/` | `sales.singhdynamics.com` | `singh-dynamics-sales` | `docs/website-sales/` |
| Singh AR | `site/singhar/` | `singhar.singhdynamics.com` | `singh-dynamics-singhar` | `docs/singh-ar/` |
| Website QC | `site/websiteqc/` | `websiteqc.singhdynamics.com` | `singh-dynamics-websiteqc` | `docs/website-qc/` |

Each is a single static `index.html`, no build step, no framework. Keep it that
way unless a real requirement forces otherwise; a static file is one less thing
that can break.

`www.singhdynamics.com` is attached to the same `singh-dynamics-root` project
as the apex. Cloudflare Pages redirects `www` to the apex automatically, so
there is no redirect rule to maintain.

## Root domain no longer sells websites

`singhdynamics.com` used to serve the Website Sales pitch directly (the old
`site/index.html`, before this split). That content now lives at
`site/sales/index.html` and is served from `sales.singhdynamics.com`. The root
domain is a hub that names all three products and links out. This matches the
repository's own rule that none of the three subchannels is "the real business"
with the others as side projects.

## Deployment

`.github/workflows/deploy-marketing-sites.yml` deploys each `site/<name>/`
folder to its own Cloudflare Pages project on every push to `main` that touches
`site/**`, using the existing `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`
repo secrets. This is confirmed working: all four projects exist and have
deployed.

## Why the apex was broken for nine days, and what to remember

The three subdomains attached to their Pages projects on the first try. The
apex did not, and kept serving the old TanStack marketing site from the
`singh-dynamics-site` Worker.

The reason is worth remembering, because it produces a silent failure:
**a Worker custom domain or Worker route on a hostname takes priority over a
Pages custom domain on the same hostname.** The old Worker held
`singhdynamics.com` as a Worker custom domain. Attaching the apex to the Pages
project in the dashboard would have appeared to succeed and changed nothing
visible on the page.

This also explains the "read-only DNS error" recorded in the 4 August handoff as
an unresolved blocker. The Worker custom domain owned the apex DNS record, so
the Pages activation flow could not write it. Nothing was ever wrong with the
zone status or the account role.

The fix was to remove the custom domain from the Worker first, then attach the
apex and `www` to `singh-dynamics-root`. If a hostname on this zone ever serves
the wrong content again, check for a competing Worker custom domain or route
before touching DNS.

## Status as of 13 August 2026

Verified live by loading each hostname and matching a string unique to its own
page, from two independent networks.

| Hostname | Serves | Verified |
|---|---|---|
| `singhdynamics.com` | hub | yes |
| `www.singhdynamics.com` | redirects to apex, serves hub | yes |
| `sales.singhdynamics.com` | Website Sales | yes |
| `singhar.singhdynamics.com` | Singh AR | yes |
| `websiteqc.singhdynamics.com` | Website QC | yes |

The `singh-dynamics-site` Worker has been deleted. Its content was superseded by
`site/sales/index.html` and it no longer held any hostname. Its source still
exists in the separate `sarabcool/singh-dynamics-site` repo, which can now be
archived; nothing in it needs migrating here.

Untouched by the repair and confirmed still intact: all email DNS (Google MX,
both Resend MX, DMARC, both DKIM keys, root SPF), `previews.singhdynamics.com`,
and the zone's empty Workers Routes list, which keeps `*.demo.singhdynamics.com`
available for the per-prospect demo sites. The API Worker `singh-dynamics` was
never implicated because it has no zone route, and still answers `/health` with
`{"ok":true}`.
