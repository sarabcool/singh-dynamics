# Marketing sites

Singh Dynamics runs four static marketing sites, one per subchannel plus a
holding page at the root domain. None of these are the product itself, the
product code lives elsewhere (`agent/`, `sites/`, `docs/singh-ar/`). These are
just the public-facing pitch for each.

| Site | Path | Domain | Subchannel |
|---|---|---|---|
| Holding page | `site/root/` | `singhdynamics.com` | none, links out to the three below |
| Website Sales | `site/sales/` | `sales.singhdynamics.com` | `docs/website-sales/` |
| Singh AR | `site/singhar/` | `singhar.singhdynamics.com` | `docs/singh-ar/` |
| Website QC | `site/websiteqc/` | `websiteqc.singhdynamics.com` | `docs/website-qc/` |

Each is a single static `index.html`, no build step, no framework. Keep it
that way unless a real requirement forces otherwise; a static file is one less
thing that can break.

## Root domain no longer sells websites

`singhdynamics.com` used to serve the Website Sales pitch directly (the old
`site/index.html`, before this split). That content now lives at
`site/sales/index.html` and is served from `sales.singhdynamics.com`. The root
domain is a holding page that names all three products and links out. This
matches the repository's own rule that none of the three subchannels is "the
real business" with the others as side projects.

## Deployment

`.github/workflows/deploy-marketing-sites.yml` deploys each `site/<name>/`
folder to its own Cloudflare Pages project on every push to `main` that
touches `site/**`, using the existing `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` repo secrets. `wrangler pages deploy` creates the Pages
project automatically on first run if it doesn't already exist, provided the
token has the Pages Edit scope (it already needs to, per the root README's
setup section).

Four projects, one per row in the table above:

```
singh-dynamics-root
singh-dynamics-sales
singh-dynamics-singhar
singh-dynamics-websiteqc
```

## The one manual step

Attaching a custom domain to a Cloudflare Pages project is a dashboard action,
not something this workflow does. Because the Pages project and the
`singhdynamics.com` zone are in the same Cloudflare account, adding the domain
also creates its DNS record automatically, no manual DNS entry needed.

For each of the four projects:

1. `dash.cloudflare.com` → Workers & Pages → the project (e.g.
   `singh-dynamics-sales`) → Custom domains → Set up a custom domain.
2. Enter the domain from the table above (e.g. `sales.singhdynamics.com`, or
   the bare `singhdynamics.com` for the root project).
3. Confirm. Cloudflare creates the DNS record and issues the certificate.
   Takes a few minutes to go live.

Do this once the first deploy of each project has run at least once (so the
project exists to attach a domain to).

## Status as of 12 August 2026

Sites are built and committed. The deploy workflow is written but has not yet
been confirmed to run successfully (verify the first Actions run after this
lands on `main`). No custom domain has been attached to any of the four
projects yet, this has **not been verified live**. Confirm before telling
anyone these URLs work.
