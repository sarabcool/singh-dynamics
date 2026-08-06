#!/usr/bin/env python3
"""
shopsites - static site generator for small local businesses.

One JSON file per shop in shops/ becomes one complete, self-contained
website in dist/<slug>/. No dependencies, Python 3.8+ stdlib only.

    python3 build.py              build every shop
    python3 build.py 2wheelmax    build one shop
    python3 build.py --check      validate configs, build nothing

Design constraints, and why:
  - Single HTML file with inlined CSS. One request, instant paint on a
    phone on rural LTE. Nothing to break, nothing to version.
  - No JavaScript required for any content. Google indexes it as-is.
  - Every page is a phone call funnel. The call button is always on screen.
"""

import json
import html
import re
import sys
import shutil
from pathlib import Path
from datetime import date

ROOT = Path(__file__).parent
SHOPS = ROOT / "shops"
DIST = ROOT / "dist"

# --------------------------------------------------------------------------
# themes
# --------------------------------------------------------------------------
# Shops in the same town must not look like the same template. Each theme
# changes hue, accent, heading weight and corner radius together.

THEMES = {
    "steel": {
        "bg": "#0f1115", "surface": "#171a21", "line": "#262b36",
        "text": "#e8eaed", "muted": "#9aa3b2",
        "accent": "#ff6b1a", "accent_text": "#0f1115",
        "radius": "4px", "head_weight": "800", "head_spacing": "-0.02em",
    },
    "pine": {
        "bg": "#0d1512", "surface": "#141f1a", "line": "#22322b",
        "text": "#e9efea", "muted": "#93a89c",
        "accent": "#4ade80", "accent_text": "#08120c",
        "radius": "10px", "head_weight": "700", "head_spacing": "-0.01em",
    },
    "clay": {
        "bg": "#faf7f2", "surface": "#ffffff", "line": "#e4ddd1",
        "text": "#1e1b16", "muted": "#6b6459",
        "accent": "#b4441f", "accent_text": "#ffffff",
        "radius": "2px", "head_weight": "800", "head_spacing": "-0.03em",
    },
    "ice": {
        "bg": "#0b1220", "surface": "#121c2e", "line": "#1f2d45",
        "text": "#e6edf7", "muted": "#8fa3c0",
        "accent": "#38bdf8", "accent_text": "#06121f",
        "radius": "14px", "head_weight": "700", "head_spacing": "0",
    },
}

REQUIRED = ["slug", "name", "city", "state", "phone", "services"]

DAY_ORDER = ["monday", "tuesday", "wednesday", "thursday",
             "friday", "saturday", "sunday"]

SCHEMA_DAY = {
    "monday": "Monday", "tuesday": "Tuesday", "wednesday": "Wednesday",
    "thursday": "Thursday", "friday": "Friday", "saturday": "Saturday",
    "sunday": "Sunday",
}


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------

def e(s):
    """Escape for HTML text nodes and attributes."""
    return html.escape(str(s or ""), quote=True)


def tel_href(phone):
    """+15551234567 from any human formatting."""
    digits = re.sub(r"\D", "", phone or "")
    if len(digits) == 10:
        digits = "1" + digits
    return "+" + digits if digits else ""


def pretty_phone(phone):
    digits = re.sub(r"\D", "", phone or "")
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) == 10:
        return f"({digits[0:3]}) {digits[3:6]}-{digits[6:]}"
    return phone or ""


def fmt_time(t):
    """'08:00' -> '8am', '17:30' -> '5:30pm'"""
    try:
        h, m = [int(x) for x in t.split(":")]
    except Exception:
        return t
    suffix = "am" if h < 12 else "pm"
    hh = h % 12 or 12
    return f"{hh}:{m:02d}{suffix}" if m else f"{hh}{suffix}"


def hours_rows(hours):
    """Collapse consecutive identical days into ranges for display."""
    if not hours:
        return []
    rows, run = [], []

    def label(v):
        if not v or v in ("closed", "Closed"):
            return "Closed"
        return f"{fmt_time(v[0])} - {fmt_time(v[1])}"

    for day in DAY_ORDER:
        val = label(hours.get(day))
        if run and run[-1][1] == val:
            run.append((day, val))
        else:
            if run:
                rows.append(run)
            run = [(day, val)]
    if run:
        rows.append(run)

    out = []
    for group in rows:
        names = [g[0][:3].capitalize() for g in group]
        span = names[0] if len(names) == 1 else f"{names[0]}-{names[-1]}"
        out.append((span, group[0][1]))
    return out


# --------------------------------------------------------------------------
# structured data
# --------------------------------------------------------------------------

def json_ld(shop, url):
    graph = []
    if url:
        graph.append({
            '@type': 'WebSite',
            'url': url,
        })
    business_id = (url + '#business') if url else None
    business = {
        '@type': shop.get('schema_type', 'AutoRepair'),
        'name': shop['name'],
        'telephone': tel_href(shop['phone']),
    }
    if business_id:
        business['@id'] = business_id
    if shop.get('about'):
        business['description'] = shop['about']
    addr = shop.get('address', {})
    postal = {}
    if addr.get('street'):
        postal['streetAddress'] = addr['street']
    if addr.get('zip'):
        postal['postalCode'] = addr['zip']
    if shop.get('city'):
        postal['addressLocality'] = shop['city']
    if shop.get('state'):
        postal['addressRegion'] = shop['state']
    if shop.get('country'):
        postal['addressCountry'] = shop['country']
    if postal:
        postal['@type'] = 'PostalAddress'
        business['address'] = postal
    if shop.get('geo'):
        business['geo'] = shop['geo']
    if shop.get('maps_url'):
        business['hasMap'] = shop['maps_url']
    if shop.get('price_range'):
        business['priceRange'] = shop['price_range']
    if shop.get('hours'):
        business['openingHoursSpecification'] = shop['hours']
    if shop.get('service_area'):
        business['areaServed'] = shop['service_area']
    same_as = []
    if shop.get('facebook_url'):
        same_as.append(shop['facebook_url'])
    for s in (shop.get('same_as') or []):
        if isinstance(s, str) and (s.startswith('http://') or s.startswith('https://')):
            same_as.append(s)
    if same_as:
        business['sameAs'] = same_as
    ar = shop.get('aggregate_rating', {})
    if ar and ar.get('enabled'):
        business['aggregateRating'] = {
            '@type': 'AggregateRating',
            'ratingValue': ar['value'],
            'reviewCount': ar['count'],
        }
    services = shop.get('services') or []
    if services:
        offers = []
        for svc in services:
            item = {'@type': 'Service', 'name': svc['name']}
            if svc.get('desc'):
                item['description'] = svc['desc']
            if business_id:
                item['provider'] = {'@id': business_id}
            offers.append({'@type': 'Offer', 'itemOffered': item})
        business['hasOfferCatalog'] = {
            '@type': 'OfferCatalog',
            'itemListElement': offers,
        }
    graph.append(business)
    return json.dumps({'@context': 'https://schema.org', '@graph': graph}, indent=2)
# --------------------------------------------------------------------------
# css
# --------------------------------------------------------------------------

def css(theme):
    t = THEMES.get(theme, THEMES["steel"])
    return f"""
*,*::before,*::after{{box-sizing:border-box}}
html{{-webkit-text-size-adjust:100%;scroll-behavior:smooth}}
body{{margin:0;background:{t['bg']};color:{t['text']};
font:400 17px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
-webkit-font-smoothing:antialiased}}
img{{max-width:100%;height:auto;display:block}}
a{{color:inherit}}
h1,h2,h3{{font-weight:{t['head_weight']};letter-spacing:{t['head_spacing']};line-height:1.15;margin:0}}
h1{{font-size:clamp(2rem,7vw,3.4rem)}}
h2{{font-size:clamp(1.5rem,4.5vw,2.1rem);margin-bottom:1.4rem}}
h3{{font-size:1.08rem}}
p{{margin:0 0 1rem}}
.wrap{{width:min(1080px,92vw);margin-inline:auto}}
section{{padding:clamp(3rem,8vw,5.5rem) 0;border-top:1px solid {t['line']}}}
.muted{{color:{t['muted']}}}

/* header */
.hdr{{position:sticky;top:0;z-index:50;background:{t['bg']}f2;
backdrop-filter:saturate(1.6) blur(12px);border-bottom:1px solid {t['line']}}}
.hdr .wrap{{display:flex;align-items:center;gap:1rem;
justify-content:space-between;padding:.85rem 0}}
.brand{{font-weight:800;letter-spacing:-.02em;font-size:1.05rem;
text-decoration:none;line-height:1.2}}
.brand small{{display:block;font-weight:500;font-size:.72rem;
color:{t['muted']};letter-spacing:.06em;text-transform:uppercase}}

/* buttons */
.btn{{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;
padding:.85rem 1.4rem;border-radius:{t['radius']};text-decoration:none;
font-weight:700;font-size:1rem;border:1px solid transparent;
white-space:nowrap;transition:transform .12s ease,opacity .12s ease}}
.btn:active{{transform:translateY(1px)}}
.btn-primary{{background:{t['accent']};color:{t['accent_text']}}}
.btn-primary:hover{{opacity:.9}}
.btn-ghost{{border-color:{t['line']};color:{t['text']};background:{t['surface']}}}
.btn-ghost:hover{{border-color:{t['accent']}}}
.btn-sm{{padding:.6rem 1rem;font-size:.92rem}}

/* hero */
.hero{{padding:clamp(3.5rem,11vw,7rem) 0 clamp(3rem,8vw,5rem);border-top:none}}
.eyebrow{{display:inline-block;font-size:.76rem;font-weight:700;
letter-spacing:.14em;text-transform:uppercase;color:{t['accent']};
margin-bottom:1.1rem}}
.hero p.lede{{font-size:clamp(1.05rem,2.6vw,1.3rem);color:{t['muted']};
max-width:34ch;margin-top:1.3rem}}
.cta{{display:flex;flex-wrap:wrap;gap:.75rem;margin-top:2.2rem}}

/* trust bar */
.trust{{display:flex;flex-wrap:wrap;gap:.6rem;margin-top:2.6rem}}
.chip{{background:{t['surface']};border:1px solid {t['line']};
border-radius:{t['radius']};padding:.55rem .9rem;font-size:.87rem;
color:{t['muted']}}}
.chip b{{color:{t['text']}}}

/* grids */
.grid{{display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(255px,1fr))}}
.card{{background:{t['surface']};border:1px solid {t['line']};
border-radius:{t['radius']};padding:1.5rem}}
.card h3{{margin-bottom:.5rem}}
.card p{{margin:0;color:{t['muted']};font-size:.95rem}}

/* hours */
.split{{display:grid;gap:2.5rem;grid-template-columns:1fr}}
@media(min-width:820px){{.split{{grid-template-columns:1fr 1fr;gap:3.5rem}}}}
.hours{{width:100%;border-collapse:collapse}}
.hours td{{padding:.7rem 0;border-bottom:1px solid {t['line']};font-size:.98rem}}
.hours td:last-child{{text-align:right;color:{t['muted']};
font-variant-numeric:tabular-nums}}
.hours tr:last-child td{{border-bottom:none}}

/* reviews */
.quote{{background:{t['surface']};border:1px solid {t['line']};
border-left:3px solid {t['accent']};border-radius:{t['radius']};
padding:1.5rem;margin:0}}
.quote p{{margin:0 0 .8rem;font-size:1.02rem}}
.quote footer{{color:{t['muted']};font-size:.87rem;font-style:normal}}
.stars{{color:{t['accent']};letter-spacing:.12em;font-size:.9rem;
margin-bottom:.7rem}}

/* final cta */
.final{{text-align:center}}
.final .cta{{justify-content:center}}
.bigphone{{display:inline-block;font-size:clamp(1.8rem,6vw,2.7rem);
font-weight:800;letter-spacing:-.02em;color:{t['accent']};
text-decoration:none;margin:.4rem 0 .3rem}}

/* footer */
footer.site{{padding:2.5rem 0 6.5rem;border-top:1px solid {t['line']};
color:{t['muted']};font-size:.87rem}}
footer.site a{{color:{t['muted']}}}

/* sticky mobile call bar - the whole point of the site */
.callbar{{position:fixed;left:0;right:0;bottom:0;z-index:60;
padding:.7rem clamp(1rem,4vw,1.5rem);
padding-bottom:calc(.7rem + env(safe-area-inset-bottom));
background:{t['bg']}f2;backdrop-filter:blur(12px);
border-top:1px solid {t['line']};display:flex;gap:.6rem}}
.callbar .btn{{flex:1}}
@media(min-width:820px){{.callbar{{display:none}}
footer.site{{padding-bottom:2.5rem}}}}
@media(max-width:819px){{.hdr .btn{{display:none}}}}

@media(prefers-reduced-motion:reduce){{
*{{animation:none!important;transition:none!important}}
html{{scroll-behavior:auto}}}}
"""


# --------------------------------------------------------------------------
# render
# --------------------------------------------------------------------------

def render(shop, preview=False):
    name = shop["name"]
    city, state = shop["city"], shop["state"]
    phone_h = tel_href(shop["phone"])
    phone_p = pretty_phone(shop["phone"])
    domain = shop.get("domain", "").rstrip("/")
    url = f"https://{domain}/" if domain else ""
    tagline = shop.get("tagline") or f"{city} {shop.get('trade','repair')}"

    title = shop.get("seo_title") or f"{name} | {tagline} in {city}, {state}"
    desc = shop.get("seo_description") or (
        f"{name} in {city}, {state}. "
        + ", ".join(s["name"] for s in shop["services"][:4])
        + f". Call {phone_p}."
    )[:158]

    areas = shop.get("service_area") or []
    area_line = ""
    if areas:
        area_line = (f"Serving {', '.join(areas[:-1])} and {areas[-1]}."
                     if len(areas) > 1 else f"Serving {areas[0]}.")

    # ---- head
    head = [
        '<!doctype html>',
        '<html lang="en">',
        '<head>',
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        f'<title>{e(title)}</title>',
        f'<meta name="description" content="{e(desc)}">',
        f'<meta name="theme-color" content="{THEMES.get(shop.get("theme","steel"),THEMES["steel"])["bg"]}">',
    ]
    if url:
        head += [
            f'<link rel="canonical" href="{e(url)}">',
            f'<meta property="og:url" content="{e(url)}">',
        ]
    head += [
        f'<meta property="og:title" content="{e(title)}">',
        f'<meta property="og:description" content="{e(desc)}">',
        '<meta property="og:type" content="website">',
        f'<meta property="og:locale" content="en_US">',
        '<meta name="robots" content="index,follow">',
        f'<style>{css(shop.get("theme","steel"))}</style>',
        f'<script type="application/ld+json">{json_ld(shop, url)}</script>',
        '</head>',
        '<body>',
    ]

    b = []

    # ---- header
    b.append(f'''<header class="hdr"><div class="wrap">
<a class="brand" href="#top">{e(name)}<small>{e(city)}, {e(state)}</small></a>
<a class="btn btn-primary btn-sm" href="tel:{e(phone_h)}">Call {e(phone_p)}</a>
</div></header>''')

    # ---- hero
    trust = []
    if shop.get("established"):
        trust.append(f'<span class="chip">Serving {e(city)} since <b>{e(shop["established"])}</b></span>')
    r = shop.get("aggregate_rating") or {}
    if r.get("value"):
        trust.append(f'<span class="chip"><b>{e(r["value"])}</b> stars on Google, {e(r.get("count","?"))} reviews</span>')
    for badge in shop.get("badges", []):
        trust.append(f'<span class="chip">{e(badge)}</span>')

    b.append(f'''<section class="hero" id="top"><div class="wrap">
<span class="eyebrow">{e(city)}, {e(state)}</span>
<h1>{e(shop.get("headline") or tagline)}</h1>
<p class="lede">{e(shop.get("subhead") or "")}</p>
<div class="cta">
<a class="btn btn-primary" href="tel:{e(phone_h)}">Call {e(phone_p)}</a>
<a class="btn btn-ghost" href="#hours">Hours &amp; location</a>
</div>
<div class="trust">{"".join(trust)}</div>
</div></section>''')

    # ---- services
    cards = "".join(
        f'<div class="card"><h3>{e(s["name"])}</h3>'
        f'<p>{e(s.get("desc",""))}</p></div>'
        for s in shop["services"]
    )
    b.append(f'''<section id="services"><div class="wrap">
<h2>{e(shop.get("services_heading") or "What we do")}</h2>
<div class="grid">{cards}</div>
</div></section>''')

    # ---- about
    if shop.get("about"):
        paras = "".join(f"<p>{e(p)}</p>" for p in shop["about"].split("\n\n"))
        b.append(f'''<section id="about"><div class="wrap">
<div class="split"><div>
<h2>{e(shop.get("about_heading") or f"About {name}")}</h2>{paras}</div>
<div>{"".join(f'<div class="card" style="margin-bottom:1rem"><h3>{e(k)}</h3><p>{e(v)}</p></div>' for k, v in (shop.get("highlights") or {}).items())}</div>
</div></div></section>''')

    # ---- reviews
    if shop.get("reviews"):
        qs = "".join(
            f'''<figure class="quote">
<div class="stars">{"&#9733;" * int(rv.get("stars",5))}</div>
<p>{e(rv["text"])}</p>
<footer>{e(rv.get("author","Google review"))}</footer></figure>'''
            for rv in shop["reviews"]
        )
        b.append(f'''<section id="reviews"><div class="wrap">
<h2>What customers say</h2><div class="grid">{qs}</div>
<p class="muted" style="margin-top:1.4rem;font-size:.85rem">
Reviews from Google. {e(area_line)}</p>
</div></section>''')

    # ---- hours + location
    rows = "".join(
        f"<tr><td>{e(span)}</td><td>{e(val)}</td></tr>"
        for span, val in hours_rows(shop.get("hours"))
    )
    addr = shop.get("address") or {}
    addr_lines = []
    if addr.get("street"):
        addr_lines.append(e(addr["street"]))
    addr_lines.append(f'{e(city)}, {e(state)} {e(addr.get("zip",""))}'.strip())

    directions = shop.get("maps_url") or (
        "https://www.google.com/maps/search/?api=1&query="
        + re.sub(r"\s+", "+", f'{name} {addr.get("street","")} {city} {state}')
    )

    b.append(f'''<section id="hours"><div class="wrap"><div class="split">
<div><h2>Hours</h2>
{f'<table class="hours">{rows}</table>' if rows else '<p class="muted">Call for current hours.</p>'}
{f'<p class="muted" style="margin-top:1.2rem;font-size:.9rem">{e(shop["hours_note"])}</p>' if shop.get("hours_note") else ''}
</div>
<div><h2>Find us</h2>
<p>{"<br>".join(addr_lines)}</p>
<p><a href="tel:{e(phone_h)}"><b>{e(phone_p)}</b></a></p>
{f'<p class="muted">{e(area_line)}</p>' if area_line else ''}
<div class="cta"><a class="btn btn-ghost" href="{e(directions)}"
target="_blank" rel="noopener">Get directions</a></div>
</div></div></div></section>''')

    # ---- final cta
    b.append(f'''<section class="final"><div class="wrap">
<h2>{e(shop.get("cta_heading") or "Give us a call")}</h2>
<p class="muted">{e(shop.get("cta_text") or "Fastest way to get a straight answer and a real quote.")}</p>
<a class="bigphone" href="tel:{e(phone_h)}">{e(phone_p)}</a>
<div class="cta"><a class="btn btn-primary" href="tel:{e(phone_h)}">Call now</a>
<a class="btn btn-ghost" href="{e(directions)}" target="_blank" rel="noopener">Directions</a></div>
</div></section>''')

    # ---- footer
    year = date.today().year
    b.append(f'''<footer class="site"><div class="wrap">
<p><b>{e(name)}</b> &middot; {e(city)}, {e(state)} &middot;
<a href="tel:{e(phone_h)}">{e(phone_p)}</a></p>
<p>&copy; {year} {e(name)}. All rights reserved.</p>
</div></footer>''')

    # ---- sticky call bar
    b.append(f'''<div class="callbar">
<a class="btn btn-primary" href="tel:{e(phone_h)}">Call {e(phone_p)}</a>
<a class="btn btn-ghost" href="{e(directions)}" target="_blank" rel="noopener">Map</a>
</div>''')

    return "\n".join(head) + "\n" + "\n".join(b) + "\n</body>\n</html>\n"


# --------------------------------------------------------------------------
# validate
# --------------------------------------------------------------------------

def check(shop, path):
    problems, warnings = [], []
    for f in REQUIRED:
        if not shop.get(f):
            problems.append(f"missing required field: {f}")

    if shop.get("phone") and len(re.sub(r"\D", "", shop["phone"])) not in (10, 11):
        problems.append(f"phone does not look like a US number: {shop['phone']}")

    if shop.get("theme") and shop["theme"] not in THEMES:
        problems.append(f"unknown theme '{shop['theme']}', pick from {list(THEMES)}")

    blob = json.dumps(shop)
    for marker in ("TODO", "FIXME", "XXX", "<<<"):
        if marker in blob:
            warnings.append(f"contains placeholder text '{marker}' - do not ship")

    if not (shop.get("address") or {}).get("street"):
        warnings.append("no street address, local SEO will be much weaker")
    if not shop.get("hours"):
        warnings.append("no hours set")
    if not shop.get("domain"):
        warnings.append("no domain, canonical and og:url will be omitted")
    if (shop.get("aggregate_rating") or {}).get("enabled"):
        warnings.append(
            "aggregate_rating.enabled is true. Only do this for reviews "
            "collected on the shop's own site, never scraped Google ratings.")
    if len(shop.get("services", [])) < 3:
        warnings.append("fewer than 3 services, page will look thin")

    return problems, warnings


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

def build_one(path, check_only=False, preview=False):
    shop = json.loads(path.read_text())
    problems, warnings = check(shop, path)

    tag = shop.get("slug", path.stem)
    for w in warnings:
        print(f"  warn  [{tag}] {w}")
    for p in problems:
        print(f"  ERROR [{tag}] {p}")
    if problems:
        return False
    if check_only:
        print(f"  ok    [{tag}] config valid")
        return True

    out = DIST / shop["slug"]
    out.mkdir(parents=True, exist_ok=True)
    page = render(shop, preview=preview)
    (out / "index.html").write_text(page)

    domain = shop.get("domain", "").rstrip("/")
    if domain:
        (out / "robots.txt").write_text(
            f"User-agent: *\nAllow: /\nUser-agent: OAI-SearchBot\nAllow: /\n\nSitemap: https://{domain}/sitemap.xml\n")
        (out / "sitemap.xml").write_text(
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            f'  <url><loc>https://{domain}/</loc>'
            f'<lastmod>{date.today().isoformat()}</lastmod>'
            '<changefreq>monthly</changefreq><priority>1.0</priority></url>\n'
            '</urlset>\n')

    kb = len(page.encode()) / 1024
    print(f"  built [{tag}] dist/{shop['slug']}/index.html  {kb:.1f} KB")
    return True


def main():
    args = [a for a in sys.argv[1:]]
    check_only = "--check" in args
    args = [a for a in args if not a.startswith("--")]

    if not SHOPS.exists():
        print("no shops/ directory")
        return 1

    files = sorted(p for p in SHOPS.glob("*.json")
                   if not p.name.startswith("_"))
    if args:
        files = [p for p in files if p.stem in args]
        if not files:
            print(f"no shop config matching {args}")
            return 1

    if not check_only:
        DIST.mkdir(exist_ok=True)

    print(f"shopsites: {'checking' if check_only else 'building'} "
          f"{len(files)} shop(s)\n")
    ok = sum(build_one(p, check_only) for p in files)
    print(f"\n{ok}/{len(files)} succeeded")
    return 0 if ok == len(files) else 1


if __name__ == "__main__":
    sys.exit(main())

def build_json_ld(shop, url=None):
    graph = []
    if url:
        graph.append({'@type': 'WebSite', '@id': url, 'url': url, 'name': shop.get('name', '')})
    biz = {'@type': 'LocalBusiness'}
    biz_id = (url or '') + '#business'
    biz['@id'] = biz_id
    for field in ['name','address','telephone','url','geo','openingHoursSpecification','areaServed','priceRange','hasMap']:
        if shop.get(field):
            biz[field] = shop[field]
    same_as = []
    if shop.get('facebook_url'):
        same_as.append(shop['facebook_url'])
    for s in (shop.get('same_as') or []):
        if isinstance(s, str) and s.startswith('http'):
            same_as.append(s)
    if same_as:
        biz['sameAs'] = same_as
    if shop.get('aggregateRating') and shop.get('enable_aggregate_rating'):
        biz['aggregateRating'] = shop['aggregateRating']
    services = shop.get('services') or []
    if services:
        offers = []
        for svc in services:
            offer = {'@type': 'Offer', 'itemOffered': {'@type': 'Service', 'name': svc.get('name','')}}
            if svc.get('description'):
                offer['itemOffered']['description'] = svc['description']
            if biz_id:
                offer['itemOffered']['provider'] = {'@id': biz_id}
            offers.append(offer)
        biz['hasOfferCatalog'] = {'@type': 'OfferCatalog', 'itemListElement': offers}
    graph.append(biz)
    return {'@context': 'https://schema.org', '@graph': graph}

def quick_answers_html(shop):
    parts = []
    services = shop.get('services') or []
    if services:
        names = ', '.join(s.get('name','') for s in services if s.get('name'))
        if names:
            parts.append(f'<p><strong>Services:</strong> {names}</p>')
    if shop.get('address'):
        parts.append(f'<p><strong>Location:</strong> {shop["address"]}</p>')
    if shop.get('telephone'):
        parts.append(f'<p><strong>Phone:</strong> {shop["telephone"]}</p>')
    if shop.get('openingHoursSpecification'):
        parts.append(f'<p><strong>Hours:</strong> See our hours page</p>')
    if shop.get('service_area'):
        parts.append(f'<p><strong>Service area:</strong> {shop["service_area"]}</p>')
    if not parts:
        return ''
    inner = ''.join(parts)
    css = '<style>.quick-answers{background:#f8f8f8;padding:1em 1.5em;margin:1em 0;border-left:4px solid currentColor;}</style>'
    return f'{css}<section class="quick-answers" id="quick-answers"><h2>Quick answers</h2>{inner}</section>'
