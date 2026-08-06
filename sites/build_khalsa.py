#!/usr/bin/env python3
"""Purpose-built Khalsa Computers preview renderer.

Keeps the pilot deterministic and factual while giving this computer shop a
bespoke layout instead of the generic local-business card template.
"""
import html
import json
import re
import sys
from datetime import date
from pathlib import Path
from string import Template

ROOT = Path(__file__).parent
SHOP = ROOT / "shops" / "khalsa-computers.json"
DIST = ROOT / "dist" / "khalsa-computers"


def e(value):
    return html.escape(str(value or ""), quote=True)


def tel_href(phone):
    digits = re.sub(r"\D", "", phone or "")
    if len(digits) == 10:
        digits = "1" + digits
    return "+" + digits if digits else ""


def pretty_phone(phone):
    digits = re.sub(r"\D", "", phone or "")
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) == 10:
        return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"
    return phone or ""


def schema_for(shop, url):
    business_id = f"{url}#business" if url else None
    business = {
        "@type": shop.get("schema_type", "ComputerStore"),
        "name": shop["name"],
        "telephone": tel_href(shop["phone"]),
        "description": shop.get("about", ""),
    }
    if business_id:
        business["@id"] = business_id

    postal = {
        "@type": "PostalAddress",
        "addressLocality": shop.get("city", ""),
        "addressRegion": shop.get("state", ""),
        "addressCountry": shop.get("country", "US"),
    }
    addr = shop.get("address") or {}
    if addr.get("street"):
        postal["streetAddress"] = addr["street"]
    if addr.get("zip"):
        postal["postalCode"] = addr["zip"]
    business["address"] = postal

    if shop.get("service_area"):
        business["areaServed"] = shop["service_area"]

    services = []
    for service in shop.get("services") or []:
        item = {
            "@type": "Service",
            "name": service.get("name", ""),
            "description": service.get("desc", ""),
        }
        if business_id:
            item["provider"] = {"@id": business_id}
        services.append({"@type": "Offer", "itemOffered": item})
    if services:
        business["hasOfferCatalog"] = {
            "@type": "OfferCatalog",
            "name": "Computer and technology services",
            "itemListElement": services,
        }

    graph = []
    if url:
        graph.append({"@type": "WebSite", "url": url})
    graph.append(business)
    return json.dumps({"@context": "https://schema.org", "@graph": graph}, indent=2)


def render(shop, preview=False):
    city = e(shop["city"])
    state = e(shop["state"])
    phone = e(pretty_phone(shop["phone"]))
    tel = e(tel_href(shop["phone"]))
    domain = (shop.get("domain") or "").rstrip("/")
    canonical = f"https://{domain}/" if domain else ""
    title = e(shop.get("seo_title") or f"{shop['name']} | Computer Sales & Repair")
    description = e(shop.get("seo_description") or shop.get("subhead") or "")
    headline = e(shop.get("headline") or "Computers, fixed. Systems, built.")
    subhead = e(shop.get("subhead") or "")
    about = e(shop.get("about") or "")
    robots = "noindex,nofollow" if preview else "index,follow"
    schema = schema_for(shop, canonical).replace("</", "<\\/")

    services = shop.get("services") or []
    service_html = []
    for i, service in enumerate(services, start=1):
        service_html.append(
            f'<article class="service"><span class="service-no">{i:02d}</span>'
            f'<h3>{e(service.get("name"))}</h3>'
            f'<p>{e(service.get("desc"))}</p></article>'
        )
    service_html = "\n".join(service_html)
    service_names = [e(s.get("name")) for s in services if s.get("name")]
    compact_services = " / ".join(service_names[:4])

    template = Template(r'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>$title</title>
<meta name="description" content="$description">
<meta name="robots" content="$robots">
<meta name="theme-color" content="#f5f6f7">
$canonical_tags
<meta property="og:title" content="$title">
<meta property="og:description" content="$description">
<meta property="og:type" content="website">
<script type="application/ld+json">$schema</script>
<style>
*,*::before,*::after{box-sizing:border-box}
html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
body{margin:0;background:#f5f6f7;color:#0c1015;font:400 16px/1.55 Arial,"Helvetica Neue",Helvetica,sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit}button,a{-webkit-tap-highlight-color:transparent}
::selection{background:#0a57ff;color:#fff}
.wrap{width:min(1180px,calc(100% - 40px));margin:0 auto}
.kicker,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;text-transform:uppercase;letter-spacing:.12em;font-size:.72rem;font-weight:700}
.kicker{color:#0a57ff}
.section-head{display:grid;grid-template-columns:1fr 1.6fr;gap:3rem;align-items:end;margin-bottom:3.25rem}
.section-head h2{font-size:clamp(2.2rem,5vw,4.4rem);line-height:.95;letter-spacing:-.055em;margin:.7rem 0 0;max-width:10ch}
.section-head p{margin:0;color:#5d6672;max-width:52ch;font-size:1.05rem}
.site-head{position:sticky;top:0;z-index:20;background:rgba(245,246,247,.96);border-bottom:1px solid #d7dce2}
.nav{height:76px;display:flex;align-items:center;justify-content:space-between;gap:2rem}
.brand{display:flex;align-items:center;gap:.8rem;text-decoration:none;font-weight:800;letter-spacing:-.025em}
.brand-mark{display:grid;place-items:center;width:34px;height:34px;background:#0c1015;color:#fff;font:700 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em}
.nav-links{display:flex;align-items:center;gap:2rem;font-size:.9rem;font-weight:700}
.nav-links a{text-decoration:none}.nav-links a:not(.nav-call){color:#59616b}.nav-links a:not(.nav-call):hover{color:#0c1015}
.nav-call{padding:.68rem 1rem;background:#0c1015;color:#fff}
.hero{padding:clamp(4rem,9vw,8rem) 0 4.2rem;border-bottom:1px solid #d7dce2}
.hero-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(340px,.85fr);gap:clamp(3rem,8vw,7rem);align-items:center}
.hero h1{font-size:clamp(3.6rem,8.4vw,7.3rem);line-height:.84;letter-spacing:-.075em;margin:1.2rem 0 1.8rem;max-width:8.2ch}
.hero .lede{font-size:clamp(1.08rem,2vw,1.28rem);line-height:1.55;color:#515a65;max-width:49ch;margin:0}
.actions{display:flex;flex-wrap:wrap;gap:.8rem;margin-top:2rem}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:50px;padding:.8rem 1.15rem;border:1px solid #0c1015;text-decoration:none;font-weight:800;font-size:.93rem;transition:background .15s,color .15s,transform .15s}
.btn:hover{transform:translateY(-1px)}.btn-dark{background:#0c1015;color:#fff}.btn-dark:hover{background:#0a57ff;border-color:#0a57ff}.btn-light{background:transparent}.btn-light:hover{background:#fff}
.hardware{border:1px solid #bbc2ca;background:#eceff2;padding:16px;box-shadow:18px 18px 0 #dde2e7}
.hardware-top{display:flex;justify-content:space-between;border-bottom:1px solid #c6ccd3;padding:0 0 12px;color:#626b76}
.machine{height:390px;background:#11161d;position:relative;overflow:hidden;margin-top:16px}
.machine::before{content:"";position:absolute;inset:0;background-image:linear-gradient(#27303a 1px,transparent 1px),linear-gradient(90deg,#27303a 1px,transparent 1px);background-size:32px 32px;opacity:.34}
.tower{position:absolute;width:180px;height:292px;left:50%;top:48%;transform:translate(-50%,-50%);border:2px solid #cbd3dc;background:#161d26;box-shadow:0 0 0 8px #11161d}
.tower::before{content:"";position:absolute;left:22px;right:22px;top:25px;height:116px;border:1px solid #5b6876;background:radial-gradient(circle at 50% 50%,#11161d 0 24px,#364454 25px 27px,#11161d 28px 38px,#5b6876 39px 40px,#11161d 41px)}
.tower::after{content:"";position:absolute;left:22px;right:22px;bottom:27px;height:72px;border-top:1px solid #5b6876;border-bottom:1px solid #5b6876;background:repeating-linear-gradient(90deg,transparent 0 10px,#2f3a46 10px 11px)}
.power{position:absolute;right:18px;bottom:13px;width:8px;height:8px;border-radius:50%;background:#0a57ff;box-shadow:0 0 16px #0a57ff}
.hw-label{position:absolute;color:#fff;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase}.hw-label.one{left:18px;top:18px}.hw-label.two{right:18px;bottom:18px;color:#91a0b1}
.fact-strip{border-bottom:1px solid #d7dce2;background:#fff}.facts{min-height:72px;display:grid;grid-template-columns:repeat(4,1fr)}
.fact{display:flex;align-items:center;gap:.65rem;border-right:1px solid #e1e5e9;padding:1rem 1.2rem;font-size:.82rem;font-weight:800;text-transform:uppercase;letter-spacing:.04em}.fact:first-child{border-left:1px solid #e1e5e9}.dot{width:7px;height:7px;background:#0a57ff}
.services-section{padding:clamp(5rem,10vw,8rem) 0;background:#fff}.service-list{border-bottom:1px solid #ced4db}
.service{display:grid;grid-template-columns:90px minmax(190px,.7fr) minmax(0,1fr);gap:2rem;align-items:start;border-top:1px solid #ced4db;padding:2rem 0}
.service-no{font:700 .72rem/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:#0a57ff;letter-spacing:.12em;padding-top:.42rem}.service h3{font-size:clamp(1.35rem,2.6vw,2.05rem);line-height:1.05;letter-spacing:-.035em;margin:0}.service p{margin:0;color:#66707c;max-width:56ch}
.about-section{background:#0c1015;color:#fff;padding:clamp(5rem,10vw,8rem) 0}.about-grid{display:grid;grid-template-columns:1.2fr .8fr;gap:clamp(3rem,8vw,8rem);align-items:start}
.about-copy .kicker{color:#7ca7ff}.about-copy h2{font-size:clamp(2.7rem,6vw,5.4rem);line-height:.92;letter-spacing:-.06em;margin:1rem 0 2rem;max-width:10ch}.about-copy p{color:#b7bec7;font-size:1.08rem;max-width:58ch;margin:0}
.contact-panel{border-top:1px solid #39414b;padding-top:1.4rem}.contact-panel .mono{color:#89939f}.contact-panel h3{font-size:1.5rem;letter-spacing:-.03em;margin:1.3rem 0 .6rem}.contact-panel p{color:#aab2bc;margin:.2rem 0}.contact-panel .phone{display:inline-block;color:#fff;font-size:clamp(1.55rem,3.5vw,2.35rem);font-weight:800;letter-spacing:-.04em;text-decoration:none;margin-top:1.1rem;border-bottom:2px solid #0a57ff}
.info-section{padding:clamp(4.5rem,8vw,7rem) 0}.info-grid{display:grid;grid-template-columns:.75fr 1.25fr;gap:4rem}.info-grid h2{font-size:clamp(2.2rem,4.5vw,3.7rem);line-height:.95;letter-spacing:-.05em;margin:.9rem 0 0}.faq{border-top:1px solid #cfd5db}
details{border-bottom:1px solid #cfd5db;padding:1.2rem 0}summary{cursor:pointer;font-weight:800;list-style:none;padding-right:2rem;position:relative}summary::-webkit-details-marker{display:none}summary::after{content:"+";position:absolute;right:0;font:400 1.35rem/1 Arial;color:#0a57ff}details[open] summary::after{content:"−"}details p{color:#606a75;margin:.8rem 0 .1rem;max-width:58ch}
.final{background:#0a57ff;color:#fff;padding:clamp(4rem,8vw,6.5rem) 0}.final-grid{display:grid;grid-template-columns:1fr auto;gap:3rem;align-items:end}.final .kicker{color:#dce7ff}.final h2{font-size:clamp(3rem,7vw,6.2rem);line-height:.86;letter-spacing:-.065em;margin:1rem 0 0;max-width:9ch}.final .btn{border-color:#fff;background:#fff;color:#0c1015;min-width:210px}.final .btn:hover{background:#0c1015;color:#fff;border-color:#0c1015}
.site-footer{background:#0c1015;color:#8e98a4;padding:2.1rem 0 6rem}.footer-row{display:flex;justify-content:space-between;gap:2rem;font-size:.82rem}.site-footer a{color:#fff;text-decoration:none}.mobile-call{display:none}
@media(max-width:820px){.wrap{width:min(100% - 28px,1180px)}.nav{height:66px}.nav-links a:not(.nav-call){display:none}.nav-call{font-size:.82rem;padding:.58rem .75rem}.hero{padding-top:3.4rem}.hero-grid{grid-template-columns:1fr;gap:3rem}.hero h1{font-size:clamp(3.4rem,16vw,5.3rem)}.hardware{box-shadow:10px 10px 0 #dde2e7}.machine{height:300px}.tower{height:235px;width:145px}.tower::before{height:91px}.tower::after{height:54px}.facts{grid-template-columns:1fr 1fr}.fact:nth-child(odd){border-left:1px solid #e1e5e9}.fact{border-bottom:1px solid #e1e5e9}.section-head,.about-grid,.info-grid,.final-grid{grid-template-columns:1fr;gap:2rem}.section-head{align-items:start}.service{grid-template-columns:54px 1fr;gap:1rem}.service p{grid-column:2}.final .btn{width:100%}.footer-row{flex-direction:column;gap:.5rem}.mobile-call{display:block;position:fixed;left:12px;right:12px;bottom:12px;z-index:30;text-align:center;background:#0c1015;color:#fff;border:1px solid #343b45;padding:.92rem;text-decoration:none;font-weight:800;box-shadow:0 10px 30px rgba(0,0,0,.25)}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
</style>
</head>
<body>
<header class="site-head"><div class="wrap nav"><a class="brand" href="#top"><span class="brand-mark">KC</span><span>Khalsa Computers</span></a><nav class="nav-links" aria-label="Primary navigation"><a href="#services">Services</a><a href="#about">About</a><a href="#info">Info</a><a class="nav-call" href="tel:$tel">Call $phone</a></nav></div></header>
<main>
<section class="hero" id="top"><div class="wrap hero-grid"><div><div class="kicker">Novi, Michigan · Computer services</div><h1>$headline</h1><p class="lede">$subhead</p><div class="actions"><a class="btn btn-dark" href="tel:$tel">Call $phone</a><a class="btn btn-light" href="#services">See services</a></div></div><div class="hardware" aria-hidden="true"><div class="hardware-top mono"><span>Khalsa / Computers</span><span>Service 01</span></div><div class="machine"><span class="hw-label one">Computer / Service</span><div class="tower"><span class="power"></span></div><span class="hw-label two">Novi · Michigan</span></div></div></div></section>
<div class="fact-strip"><div class="wrap facts"><div class="fact"><span class="dot"></span>Novi, Michigan</div><div class="fact"><span class="dot"></span>Computer repair</div><div class="fact"><span class="dot"></span>System assembly</div><div class="fact"><span class="dot"></span>Equipment sales</div></div></div>
<section class="services-section" id="services"><div class="wrap"><div class="section-head"><div><span class="kicker">Services</span><h2>What we can help with.</h2></div><p>$compact_services</p></div><div class="service-list">$service_html</div></div></section>
<section class="about-section" id="about"><div class="wrap about-grid"><div class="about-copy"><span class="kicker">Local computer services</span><h2>Technology help in Novi.</h2><p>$about</p></div><aside class="contact-panel"><span class="mono">Start here</span><h3>Need help with a computer?</h3><p>Call to ask about repair, assembly, equipment, or website hosting.</p><a class="phone" href="tel:$tel">$phone</a></aside></div></section>
<section class="info-section" id="info"><div class="wrap info-grid"><div><span class="kicker">Quick info</span><h2>The useful stuff.</h2></div><div class="faq"><details><summary>What services does Khalsa Computers offer?</summary><p>$compact_services.</p></details><details><summary>Where is Khalsa Computers located?</summary><p>Khalsa Computers is in $city, $state.</p></details><details><summary>How do I contact Khalsa Computers?</summary><p>Call <a href="tel:$tel">$phone</a>.</p></details><details><summary>What are the current hours?</summary><p>Call for current hours.</p></details></div></div></section>
<section class="final"><div class="wrap final-grid"><div><span class="kicker">Khalsa Computers</span><h2>Talk to a local computer shop.</h2></div><a class="btn" href="tel:$tel">Call $phone</a></div></section>
</main>
<footer class="site-footer"><div class="wrap footer-row"><span>© $year Khalsa Computers · $city, $state</span><span><a href="tel:$tel">$phone</a></span></div></footer>
<a class="mobile-call" href="tel:$tel">Call Khalsa Computers · $phone</a>
</body>
</html>
''')

    canonical_tags = ""
    if canonical:
        canonical_tags = (
            f'<link rel="canonical" href="{e(canonical)}">\n'
            f'<meta property="og:url" content="{e(canonical)}">'
        )

    return template.substitute(
        title=title, description=description, robots=robots,
        canonical_tags=canonical_tags, schema=schema, tel=tel, phone=phone,
        headline=headline, subhead=subhead, compact_services=compact_services,
        service_html=service_html, about=about, city=city, state=state,
        year=date.today().year,
    )


def main():
    preview = "--preview" in sys.argv[1:]
    if not SHOP.exists():
        print(f"missing config: {SHOP}")
        return 1
    shop = json.loads(SHOP.read_text())
    DIST.mkdir(parents=True, exist_ok=True)
    page = render(shop, preview=preview)
    (DIST / "index.html").write_text(page)
    print(f"built [khalsa-computers] {DIST / 'index.html'} {len(page.encode()) / 1024:.1f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
