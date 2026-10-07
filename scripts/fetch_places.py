"""
Builds data/bangalore-places.json — every restaurant, café, bakery, bar, sweet shop and
food stall in Bangalore — from the free Overture Maps open dataset
(https://overturemaps.org; data from Meta, Microsoft, OpenStreetMap and others under
CDLA-Permissive-2.0 / CC0 / Apache-2.0 — free to use with attribution).

Setup (once):   python -m pip install --user duckdb
Run:            python scripts/fetch_places.py            (does nothing if already on the latest release)
                python scripts/fetch_places.py --force    (rebuild anyway, e.g. after editing areas.py)
Runs every day on its own via .github/workflows/refresh-places.yml once the project is on GitHub.
"""
import json
import math
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone

import duckdb

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from areas import assign_areas, text_area  # noqa: E402

# Greater Bangalore, incl. Whitefield, Electronic City, Yelahanka, Kengeri.
SOUTH, WEST, NORTH, EAST = 12.78, 77.40, 13.20, 77.82
MIN_CONFIDENCE = 0.2  # below this, listings are mostly junk or long gone
BUCKET = "overturemaps-us-west-2"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "bangalore-places.json")

SKIP_CATEGORIES = {"internet_cafe"}
CUISINE_LABEL = {
    "restaurant": "Restaurant", "food_and_drink": "Restaurant", "cafe": "Café", "coffee_shop": "Café",
    "fast_food_restaurant": "Fast food", "ice_cream_shop": "Ice cream", "dessert_shop": "Desserts",
    "tea_room": "Chai & tea", "smoothie_juice_bar": "Juice", "bar_and_grill_restaurant": "Bar & grill",
    "breakfast_and_brunch_restaurant": "Breakfast", "chicken_restaurant": "Chicken", "burger_restaurant": "Burgers",
    "sandwich_shop": "Sandwiches", "candy_store": "Sweets", "food_truck_stand": "Food truck",
    "non_alcoholic_beverage_venue": "Drinks", "vegetarian_restaurant": "Vegetarian", "bakery": "Bakery",
    "pizza_restaurant": "Pizza", "barbecue_restaurant": "Barbecue", "seafood_restaurant": "Seafood",
}
# Overture spellings -> the names locals actually use
AREA_ALIASES = {"Malleswaram": "Malleshwaram", "Bellanduru": "Bellandur", "Bengaluru": "Bangalore"}
CITY_NAMES = {"Bengaluru", "Bangalore", "Bangalore Urban", "Bengaluru Urban"}


def latest_release():
    url = f"https://{BUCKET}.s3.amazonaws.com/?list-type=2&prefix=release/&delimiter=/"
    with urllib.request.urlopen(url, timeout=60) as res:
        releases = re.findall(r"<Prefix>release/([^<]+)/</Prefix>", res.read().decode())
    if not releases:
        raise RuntimeError("Could not list Overture releases")
    return sorted(releases)[-1]


def cuisine_of(category):
    if not category:
        return "Restaurant"
    if category in CUISINE_LABEL:
        return CUISINE_LABEL[category]
    label = re.sub(r"_(restaurant|shop|bar)$", "", category).replace("_", " ")
    return label[:1].upper() + label[1:]


def norm(s):
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def metres(lat1, lng1, lat2, lng2):
    x = math.radians(lng2 - lng1) * math.cos(math.radians((lat1 + lat2) / 2))
    y = math.radians(lat2 - lat1)
    return 6371000 * math.hypot(x, y)


def print_change_report(new_places):
    """Compare with the list currently on disk and say exactly what is about to change."""
    if not os.path.exists(OUT):
        return
    with open(OUT, encoding="utf-8") as f:
        old = json.load(f)
    fi = {n: i for i, n in enumerate(old["fields"])}
    before = {r[fi["id"]]: (r[fi["name"]], old["areas"][r[fi["area"]]]) for r in old["places"]}
    after = {p["id"]: (p["name"], p["area"]) for p in new_places}

    added = [i for i in after if i not in before]
    removed = [i for i in before if i not in after]
    moved = [i for i in after if i in before and before[i][1] != after[i][1]]
    renamed = [i for i in after if i in before and before[i][0] != after[i][0]]

    print("\n=== WHAT CHANGED vs the list currently in the app ===")
    print(f"  places before: {len(before)}   after: {len(after)}   "
          f"(+{len(added)} new, -{len(removed)} gone, {len(moved)} moved area, {len(renamed)} renamed)")
    if moved:
        flows = {}
        for i in moved:
            flows[(before[i][1], after[i][1])] = flows.get((before[i][1], after[i][1]), 0) + 1
        print("  Areas that moved:")
        for (a, b), n in sorted(flows.items(), key=lambda x: -x[1])[:15]:
            print(f"    {n:4d}  {a}  ->  {b}")
    area_before, area_after = {}, {}
    for _, a in before.values():
        area_before[a] = area_before.get(a, 0) + 1
    for _, a in after.values():
        area_after[a] = area_after.get(a, 0) + 1
    changed = sorted((a for a in set(area_before) | set(area_after) if area_before.get(a, 0) != area_after.get(a, 0)),
                     key=lambda a: -abs(area_after.get(a, 0) - area_before.get(a, 0)))
    if changed:
        print("  Area sizes (before -> after):")
        for a in changed[:15]:
            print(f"    {a:24s} {area_before.get(a, 0):4d} -> {area_after.get(a, 0):4d}")
    print("=====================================================\n")


def main():
    t0 = time.time()
    release = latest_release()
    if "--force" not in sys.argv and os.path.exists(OUT):
        with open(OUT, encoding="utf-8") as f:
            current = json.load(f).get("source", "")
        if current == f"Overture Maps release {release}":
            print(f"Already up to date (Overture release {release}). Use --force to rebuild anyway.")
            return
    print(f"Using Overture release {release}")
    base = f"s3://{BUCKET}/release/{release}"

    con = duckdb.connect()
    con.execute("SET enable_progress_bar=false;")
    con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2';")

    print("1/4  Downloading Bangalore food places (takes ~1 min)...")
    con.execute(f"""
        CREATE TABLE places AS
        SELECT id, names.primary AS name, confidence, operating_status,
               taxonomy.primary AS category, geometry, bbox.xmin AS lng, bbox.ymin AS lat,
               addresses[1].freeform AS address, phones[1] AS phone, websites[1] AS website
        FROM read_parquet('{base}/theme=places/type=place/*')
        WHERE bbox.xmin BETWEEN {WEST} AND {EAST} AND bbox.ymin BETWEEN {SOUTH} AND {NORTH}
          AND taxonomy.hierarchy[1] = 'food_and_drink'
          AND names.primary IS NOT NULL
          AND confidence >= {MIN_CONFIDENCE}
          AND coalesce(operating_status, 'open') <> 'permanently_closed'
    """)
    print(f"     {con.execute('SELECT count(*) FROM places').fetchone()[0]} places")

    print("2/4  Downloading area boundaries (Koramangala, HSR Layout, ...)...")
    con.execute(f"""
        CREATE TABLE areas AS
        SELECT names.primary AS name, subtype, geometry, ST_Area(geometry) AS size
        FROM read_parquet('{base}/theme=divisions/type=division_area/*')
        WHERE bbox.xmin < {EAST} AND bbox.xmax > {WEST} AND bbox.ymin < {NORTH} AND bbox.ymax > {SOUTH}
          AND subtype IN ('macrohood', 'neighborhood', 'locality')
          AND names.primary IS NOT NULL
    """)
    con.execute(f"DELETE FROM areas WHERE name IN ({','.join(repr(c) for c in CITY_NAMES)})")
    centres = con.execute(f"""
        SELECT names.primary, bbox.ymin, bbox.xmin
        FROM read_parquet('{base}/theme=divisions/type=division/*')
        WHERE bbox.xmin BETWEEN {WEST} AND {EAST} AND bbox.ymin BETWEEN {SOUTH} AND {NORTH}
          AND subtype = 'macrohood'
    """).fetchall()
    print(f"     {con.execute('SELECT count(*) FROM areas').fetchone()[0]} boundaries, {len(centres)} area centres")

    print("3/4  Matching each place to its area...")
    # Overture only has boundary shapes for a few big areas, so for each place we find:
    #  - the familiar area (macrohood) boundary it sits in, if any
    #  - the smallest locality boundary it sits in (e.g. Electronic City), skipping BBMP wards
    rows = con.execute("""
        WITH hits AS (
            SELECT p.id, a.name, a.subtype, a.size
            FROM places p JOIN areas a ON ST_Contains(a.geometry, p.geometry)
            WHERE a.subtype IN ('macrohood', 'locality') AND a.name NOT ILIKE '%ward%'
        ),
        macro AS (SELECT id, arg_min(name, size) AS area FROM hits WHERE subtype = 'macrohood' GROUP BY id),
        loc AS (SELECT id, arg_min(name, size) AS area FROM hits WHERE subtype = 'locality' GROUP BY id)
        SELECT p.id, p.name, p.lat, p.lng, m.area, l.area, p.category, p.address, p.phone, p.website
        FROM places p LEFT JOIN macro m USING (id) LEFT JOIN loc l USING (id)
        ORDER BY p.confidence DESC
    """).fetchall()

    def area_for(lat, lng, macro, locality):
        if macro:
            return macro
        best = min(centres, key=lambda c: metres(lat, lng, c[1], c[2]), default=None)
        dist = metres(lat, lng, best[1], best[2]) if best else float("inf")
        if dist < 2500:
            return best[0]       # close to a well-known area centre, e.g. Koramangala
        if locality:
            return locality      # outskirts: Electronic City, Bommanahalli...
        return best[0] if dist < 5000 else "Bangalore"

    print("4/4  Cleaning up duplicates and writing the file...")
    kept, grid = [], {}
    for pid, name, lat, lng, macro, locality, category, address, phone, website in rows:
        if category in SKIP_CATEGORIES:
            continue
        name = name.strip()
        key = norm(name)
        cell = (round(lat, 3), round(lng, 3))
        # Same name within ~60 m = the same restaurant listed twice (keep the most confident).
        nearby = [grid.get((cell[0] + i / 1000, cell[1] + j / 1000), []) for i in (-1, 0, 1) for j in (-1, 0, 1)]
        if any(k == key and metres(lat, lng, la, ln) < 60 for bucket in nearby for k, la, ln in bucket):
            continue
        grid.setdefault((round(lat, 3), round(lng, 3)), []).append((key, lat, lng))
        map_area = area_for(lat, lng, macro, locality)
        kept.append({
            "id": "ov-" + pid.replace("-", "")[:16],
            "name": name,
            "lat": round(lat, 6),
            "lng": round(lng, 6),
            # boundary-based guess, in the same spelling as the address-based names
            "_map_area": text_area(map_area) or AREA_ALIASES.get(map_area, map_area),
            "cuisine": cuisine_of(category),
            "veg": 1 if category == "vegetarian_restaurant" else 0,
            "address": (address or "").strip(),
            "hours": "",
            "phone": phone or "",
            "website": website or "",
        })

    print("     Working out areas from addresses and neighbours...")
    report = assign_areas(kept, fallback=lambda p: p["_map_area"])
    for p in kept:
        del p["_map_area"]
    print(f"     areas from address: {report['by_method'].get('address', 0)}, "
          f"from neighbours: {report['by_method'].get('neighbours', 0)}, "
          f"fallback: {report['by_method'].get('fallback', 0)}")
    print(f"     accuracy check on {report['checked']} places with a known area: "
          f"neighbour method {report['neighbour_accuracy']:.0%} vs old boundary method {report['old_method_accuracy']:.0%}")

    kept.sort(key=lambda p: (p["area"], p["name"].lower()))
    print_change_report(kept)
    areas = sorted({p["area"] for p in kept})
    area_index = {a: i for i, a in enumerate(areas)}
    fields = ["id", "name", "lat", "lng", "area", "cuisine", "veg", "address", "hours", "phone", "website"]
    out_rows = []
    for p in kept:
        row = [p[f] for f in fields]
        row[4] = area_index[p["area"]]  # area stored as an index to keep the file small
        out_rows.append(row)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({
            "attribution": "© Overture Maps Foundation (overturemaps.org) — places from Meta, Microsoft, OpenStreetMap & others; CDLA-Permissive-2.0 / CC0 / Apache-2.0",
            "source": f"Overture Maps release {release}",
            "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "fields": fields,
            "areas": areas,
            "places": out_rows,
        }, f, ensure_ascii=False, separators=(",", ":"))

    by_area = {}
    for p in kept:
        by_area[p["area"]] = by_area.get(p["area"], 0) + 1
    top = sorted(by_area.items(), key=lambda x: -x[1])[:12]
    print(f"Done in {time.time() - t0:.0f}s: {len(kept)} places in {len(areas)} areas, "
          f"{os.path.getsize(OUT) // 1024} KB")
    print("Biggest areas:", ", ".join(f"{a} ({n})" for a, n in top))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("ERROR:", e)
        sys.exit(1)
