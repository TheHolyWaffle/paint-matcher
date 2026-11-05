"""Fetch the Boss Paints color palette, and which tintable products each color can be mixed in.

The palette comes from the site's public Algolia index (cached in data/.cache/boss). Per-product
availability comes from the site's /api/color/search, which returns at most 100 colors per call and
matches substrings, so palette code prefixes are narrowed until each result fits (cached in
data/.cache/boss-api).
"""
import hashlib, json, re, sys, time, urllib.error, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

BASE = "https://bosspaints.be"
ROOT = Path(__file__).parent.parent
CACHE = ROOT / "data/.cache/boss-api"
CAP = 100
ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
COLORS_APP, COLORS_KEY, COLORS_INDEX = "QBJ2TK3S0P", "546e41eb73c5906a91f4a011faf6c4f5", "shared_colors_nl-BE"
ALGOLIA_CACHE = ROOT / "data/.cache/boss"
PRODUCTS_APP, PRODUCTS_KEY, PRODUCTS_INDEX = "K9ZARPHLG5", "203f9c1f76f157aa50f2f3a5ff6d4b1f", "products_b2b_nl-BE"
HEADERS = {"User-Agent": "Mozilla/5.0", "Origin": BASE, "Referer": BASE + "/"}


def cached(key, fetch):
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / (hashlib.sha1(key.encode()).hexdigest() + ".json")
    if f.exists():
        return json.loads(f.read_text())
    for attempt in range(6):
        try:
            r = fetch()
            f.write_text(json.dumps({"key": key, "response": r}))
            return {"key": key, "response": r}
        except urllib.error.HTTPError as e:
            if e.code == 500 and attempt >= 1:
                # Some keywords (e.g. "-") consistently crash the endpoint; treat them as empty.
                print(f"  500 on {key!r}, skipping", file=sys.stderr)
                return {"key": key, "response": []}
            if e.code not in (429, 500, 502, 503, 504):
                raise
        except (urllib.error.URLError, TimeoutError):
            pass
        time.sleep(5 * (attempt + 1))
    sys.exit(f"giving up on {key!r}; rerun later (finished calls are cached)")


def search(keyword, product=None):
    url = f"{BASE}/api/color/search?locale=nl&keyword={urllib.parse.quote(keyword)}"
    if product:
        url += f"&productId={product}"
    fetch = lambda: json.load(urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=30))
    return cached(url, fetch)["response"] or []


class RateLimited(Exception):
    pass


def palette_query(q):
    ALGOLIA_CACHE.mkdir(parents=True, exist_ok=True)
    f = ALGOLIA_CACHE / (hashlib.sha1(q.encode()).hexdigest() + ".json")
    if f.exists():
        return json.loads(f.read_text())
    params = urllib.parse.urlencode({"query": q, "hitsPerPage": 1000, "typoTolerance": "false",
                                     "restrictSearchableAttributes": '["code"]',
                                     "attributesToRetrieve": "id,code,name,rgb,groups,slug,trending,status",
                                     "attributesToHighlight": "[]"})
    req = urllib.request.Request(f"https://{COLORS_APP}-dsn.algolia.net/1/indexes/{COLORS_INDEX}/query",
                                 data=json.dumps({"params": params}).encode(),
                                 headers={**HEADERS, "X-Algolia-Application-Id": COLORS_APP,
                                          "X-Algolia-API-Key": COLORS_KEY})
    for attempt in range(3):
        try:
            time.sleep(0.5)
            r = json.load(urllib.request.urlopen(req, timeout=30))
            f.write_text(json.dumps(r))
            return r
        except urllib.error.HTTPError as e:
            if e.code != 429:
                raise
            time.sleep(20 * (attempt + 1))
    raise RateLimited(q)


def palette():
    """The Boss color palette shown on the site. A query returns at most 1000 hits, so code prefixes are narrowed."""
    out = {}
    def harvest(prefix):
        r = palette_query(prefix)
        if r["nbHits"] <= 1000:
            out.update((h["objectID"], h) for h in r["hits"])
            return
        for c in ALNUM + ("" if prefix.endswith(" ") else " "):
            harvest(prefix + c)
    try:
        total = palette_query("")["nbHits"]
        for c in ALNUM:
            harvest(c)
    except RateLimited as e:
        print(f"  Algolia rate limit (per IP, hourly) hit on {e}; using the cached part of the palette. "
              "Rerun later to complete it.", file=sys.stderr)
        total = json.loads((ALGOLIA_CACHE / (hashlib.sha1(b"").hexdigest() + ".json")).read_text())["nbHits"]
        for f in ALGOLIA_CACHE.glob("*.json"):
            out.update((h["objectID"], h) for h in json.loads(f.read_text())["hits"])
    print(f"boss: palette {len(out)} of {total}", file=sys.stderr)
    return {h["id"]: h for h in out.values() if h.get("status") == "active" and h.get("rgb")}


def products():
    url = f"https://{PRODUCTS_APP}-dsn.algolia.net/1/indexes/{PRODUCTS_INDEX}/query"
    body = json.dumps({"params": "query=&hitsPerPage=1000"}).encode()
    headers = {**HEADERS, "X-Algolia-Application-Id": PRODUCTS_APP, "X-Algolia-API-Key": PRODUCTS_KEY}
    fetch = lambda: json.load(urllib.request.urlopen(urllib.request.Request(url, data=body, headers=headers), timeout=30))
    hits = cached(url + "#all", fetch)["response"]["hits"]
    return [h for h in hits if "mymx" in (h.get("colortypegroups") or []) and h.get("status") == "active"]


def crawl(product, children, pool):
    """Breadth-first prefix search; children(prefix) yields the next prefixes to try when a call is full."""
    found, frontier, calls = {}, [c for c in children("")], 0
    while frontier:
        results = list(pool.map(lambda p: search(p, product), frontier))
        calls += len(frontier)
        nxt = []
        for prefix, hits in zip(frontier, results):
            found.update((h["id"], h) for h in hits)
            if len(hits) >= CAP and len(prefix) < 24:
                nxt += children(prefix)
        frontier = nxt
    return found, calls


def probe_missing_systems(product, hits, colors_by_id, pool, sample=6):
    """The search doesn't prefix-match some code systems (e.g. "TVT M1" finds nothing, "TVT M112" does).

    For each system the crawl found nothing of, look up a few exact codes. If all are available,
    assume the whole system is; if some are, check every code in that system.
    """
    by_system = {}
    for cid, h in colors_by_id.items():
        by_system.setdefault(h["code"].split()[0], []).append(cid)
    found, calls = set(), 0
    exact = lambda cid: any(r["id"] == cid for r in search(colors_by_id[cid]["code"], product))
    for system, ids in by_system.items():
        if any(cid in hits for cid in ids):
            continue
        ids = sorted(ids)
        probe = ids[:: max(1, len(ids) // sample)][:sample]
        ok = list(pool.map(exact, probe))
        calls += len(probe)
        if all(ok):
            found.update(ids)
        elif any(ok):
            rest = [cid for cid in ids if cid not in probe]
            found.update(cid for cid, yes in zip(rest, pool.map(exact, rest)) if yes)
            found.update(cid for cid, yes in zip(probe, ok) if yes)
            calls += len(rest)
    return {"found": found, "calls": calls}


def slug(code, name):
    text = code if name.strip().lower() == code.strip().lower() else f"{code} {name}"
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def main():
    colors_by_id = palette()
    codes = {h["code"].upper() for h in colors_by_id.values()}
    prefixes = {}
    for code in codes:
        for i in range(len(code)):
            prefixes.setdefault(code[:i], set()).add(code[i])
    children = lambda p: [p + c for c in sorted(prefixes.get(p, ())) if (p + c).strip("-/ ")]

    prods = products()
    sold_in = {}
    with ThreadPoolExecutor(4) as pool:
        for i, prod in enumerate(prods, 1):
            found, calls = crawl(prod["id"], children, pool)
            hits = {cid for cid in found if cid in colors_by_id}
            probed = probe_missing_systems(prod["id"], hits, colors_by_id, pool)
            calls += probed["calls"]
            hits |= probed["found"]
            for cid in hits:
                sold_in.setdefault(cid, set()).add(prod["name"])
            print(f"  [{i}/{len(prods)}] {prod['name']}: {len(hits)} palette colors, {calls} calls", file=sys.stderr)

    categories = {p["name"]: (p.get("categories") or {}).get("l3", "").split(" > ")[-1] for p in prods}
    (ROOT / "data/boss_products.json").write_text(json.dumps(
        [{"id": p["id"], "name": p["name"], "category": categories[p["name"]], "type": p.get("type"),
          "colors": sum(p["name"] in s for s in sold_in.values())} for p in prods], indent=0))

    colors = []
    for h in colors_by_id.values():
        colors.append({"id": h["id"], "code": h["code"], "name": h["name"], "hex": h["rgb"].upper(),
                       "groups": [g.strip().title() for g in (h.get("groups") or "").split(",") if g.strip()],
                       "system": h["code"].split()[0], "trending": bool(h.get("trending")),
                       "products": sorted(sold_in.get(h["id"], ())),
                       "url": f"{BASE}/nl/kleuren/{h.get('slug') or slug(h['code'], h['name'])}"})
    colors.sort(key=lambda c: c["code"])
    print(f"boss: wrote {len(colors)} colors, {len(prods)} tintable products", file=sys.stderr)
    (ROOT / "data/boss.json").write_text(json.dumps(colors, indent=0))


if __name__ == "__main__":
    main()
