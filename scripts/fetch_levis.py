"""Fetch every Levis color with its hue family, collections and the products it is sold in."""
import hashlib, html, json, re, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

BASE = "https://www.levis.info"
ROOT = Path(__file__).parent.parent
CACHE = ROOT / "data/.cache/levis"
COLLECTION_PAGES = {
    "Ambiance": "/nl/ambiance",
    "Colores del Mundo": "/nl/colores-del-mundo",
    "Simply Refresh": "/nl/decoratietips-en-advies/levis-simply-refresh",
    "EasyClean": "/nl/levis-easyclean",
    "Essentials": "/nl/levis-essentials",
    "Colour Futures 2024": "/nl/levis-kleur-van-het-jaar-2024",
    "Colour Futures 2025": "/nl/levis-kleur-van-het-jaar-2025",
    "Colour Futures 2027": "/nl/levis-kleur-van-het-jaar-2027",
}
HUES = {"Red": "Rood", "Orange": "Oranje", "Yellow": "Geel", "Green": "Groen", "Blue": "Blauw",
        "Violet": "Paars", "Warm Neutral": "Warm neutraal", "Cool Neutral": "Koel neutraal",
        "White": "Wit", "Neutral": "Neutraal", "Gold": "Goud", "Teal": "Blauwgroen",
        "Lime": "Limoen", "Grey": "Grijs"}


def get(path):
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / (hashlib.sha1(path.encode()).hexdigest() + ".html")
    if f.exists():
        return f.read_text()
    for attempt in range(4):
        try:
            req = urllib.request.Request(BASE + path, headers={"User-Agent": "Mozilla/5.0"})
            s = urllib.request.urlopen(req, timeout=30).read().decode()
            f.write_text(s)
            return s
        except Exception:
            time.sleep(2 * (attempt + 1))
    return None


def color_page(slug):
    ccid = slug.rsplit("-", 1)[1]
    s = get(f"/nl/kleurpaletten/{slug}")
    if not s:
        return None
    m = (re.search(r'"hex":"(#[0-9A-Fa-f]{6})","ccid":"' + ccid + r'","title":"([^"]*)"', s)
         or re.search(r'data-item-name="([^"]*)" data-item-id="' + ccid + r'" data-item-hex="(#[0-9A-Fa-f]{6})"', s)
         or re.search(r'data-ccid="' + ccid + r'" data-label="([^"]*)" data-hex="(#[0-9A-Fa-f]{6})"', s))
    if not m:
        return None
    a, b = m.groups()
    hexv, name = (a, b) if a.startswith("#") else (b, a)
    hue = re.search(r"subCategory1: '([^']*)'", s)
    p = get(f"/nl/producten/filters/cccId_{ccid}") or ""
    products = sorted({html.unescape(t).strip() for t in re.findall(r'product-title body-copy-rg">([^<]*)', p)} - {""})
    return {"id": ccid, "name": html.unescape(name), "hex": hexv.upper(),
            "hue": HUES.get(hue.group(1), hue.group(1)) if hue else None,
            "products": [x for x in products if "tester" not in x.lower()],
            "url": f"{BASE}/nl/kleurpaletten/{slug}"}


def main():
    sitemap = get("/nl/sitemap.xml")
    slugs = sorted(set(re.findall(r"/nl/kleurpaletten/([a-z0-9-]+-\d{5,})<", sitemap)))
    collections = {}
    for name, path in COLLECTION_PAGES.items():
        for ccid in re.findall(r'data-ccid="(\d+)"', get(path) or ""):
            collections.setdefault(ccid, set()).add(name)
    with ThreadPoolExecutor(4) as ex:
        colors = [c for c in ex.map(color_page, slugs) if c]
    for c in colors:
        cs = collections.get(c["id"], set())
        if re.match(r"(Clear|Shady) ", c["name"]):
            cs.add("Mengmachine kleurenwand")
        c["collections"] = sorted(cs) or ["Overige"]
    print(f"levis: sitemap {len(slugs)}, colors {len(colors)}", file=sys.stderr)
    (ROOT / "data/levis.json").write_text(json.dumps(colors, indent=0))


if __name__ == "__main__":
    main()
