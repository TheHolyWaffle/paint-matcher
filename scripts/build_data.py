"""Bundle data/*.json into web/colors.js so index.html works straight from disk."""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).parent.parent

# Order matters: first matching rule wins.
LEVIS_TYPES = [
    ("Primers, vullers & plamuur", ("vuller", "plamuur", "kneedbaar", "one fill", "schilderskit", "isoprim")),
    ("Effecten & speciaal", ("beton effect", "texture", "glitter", "spray fluo", "spray metallic",
                             "bordverf", "magneetverf", "hittebestendig")),
    ("Vloeren & trappen", ("vloer", "floor")),
    ("Keuken & badkamer", ("keuken", "badkamer")),
    ("Gevels & buitenmuren", ("gevel", "muur buiten")),
    ("Hout buiten", ("hout buiten", "hout lak buiten", "duol")),
    ("Metaal & radiatoren", ("ferro", "radiator")),
    ("Tegels", ("tegels",)),
    ("Meubels", ("meubels", "tablo")),
    ("Lak binnen (hout, deuren, ramen)", ("lak", "hout", "ramen", "deuren")),
    ("Muren & plafonds binnen", ("mur", "muur", "plafond", "latex", "white+", "zwarte strepen")),
]


def levis_type(product):
    p = product.lower()
    # Stand-alone primers; "Lak & Primer" style products are paints.
    if "primer" in p and "&" not in p:
        return "Primers, vullers & plamuur"
    return next((t for t, keys in LEVIS_TYPES if any(k in p for k in keys)), "Overige")


# Boss product category (site taxonomy, level 3) to a "Use" label.
BOSS_TYPES = {
    "Muurverf binnen": "Muren & plafonds binnen",
    "Muurverf buiten": "Gevels & buitenmuren",
    "Lakken binnen": "Lak binnen",
    "Lakken buiten": "Lak buiten",
    "Houtveredeling buiten": "Hout buiten",
    "Houtveredeling en vernissen binnen": "Hout binnen",
    "Vloerverven": "Vloeren",
    "Spuitverven": "Spuitverf",
}


def boss_type(category):
    if category.startswith("Grondlagen"):
        return "Grondlagen"
    if "decotechnieken" in category:
        return "Decoratieve technieken"
    return BOSS_TYPES.get(category, category or "Overige")


def main():
    boss = json.loads((ROOT / "data/boss.json").read_text()) if (ROOT / "data/boss.json").exists() else []
    levis = json.loads((ROOT / "data/levis.json").read_text()) if (ROOT / "data/levis.json").exists() else []
    valid = lambda c: re.fullmatch(r"#[0-9A-Fa-f]{6}", c.get("hex") or "")
    boss, levis = [c for c in boss if valid(c)], [c for c in levis if valid(c)]
    prods = ROOT / "data/boss_products.json"
    type_of = {p["name"]: boss_type(p["category"]) for p in json.loads(prods.read_text())} if prods.exists() else {}
    for c in boss:
        c["types"] = sorted({type_of.get(p, "Overige") for p in c.get("products", [])})
    merged = {}
    for c in levis:
        key = (c["name"].casefold(), c["hex"])
        if key in merged:
            m = merged[key]
            for f in ("products", "collections"):
                m[f] = sorted(set(m[f]) | set(c[f]))
        else:
            merged[key] = c
    levis = list(merged.values())
    for c in levis:
        c["products"] = [p for p in c["products"] if p]
        if len(c["collections"]) > 1 and "Overige" in c["collections"]:
            c["collections"].remove("Overige")
        c["types"] = sorted({levis_type(p) for p in c["products"]})
    if not boss or not levis:
        print(f"warning: boss={len(boss)} levis={len(levis)} colors", file=sys.stderr)
    payload = {"boss": boss, "levis": levis, "levisTypeOrder": [t for t, _ in LEVIS_TYPES] + ["Overige"]}
    out = ROOT / "web/colors.js"
    out.write_text("window.PAINTS = " + json.dumps(payload, separators=(",", ":"), ensure_ascii=False) + ";\n")
    print(f"wrote {out} (boss {len(boss)}, levis {len(levis)})", file=sys.stderr)


if __name__ == "__main__":
    main()
