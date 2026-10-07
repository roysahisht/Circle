"""
Assigns each place a familiar Bangalore area name ("Koramangala", "HSR Layout", ...).

1. Text: if the address (or name) mentions a known area, use it — the rightmost mention wins,
   since Indian addresses go small -> big ("80 Feet Rd, 4th Block, Koramangala").
   Mentions far from where that area actually is are ignored ("opp. Koramangala Club, Ejipura").
2. Neighbours: otherwise, the area most of its nearest text-labelled neighbours have.
   So borders are learned from thousands of real addresses, not drawn by hand.
3. Fallback: the map boundary it sits in, or "Bangalore".
"""
import math
import re
from collections import Counter, defaultdict

# canonical name -> spellings/landmarks people write in addresses (lowercase, words only)
AREAS = {
    "Koramangala": ["koramangala", "kormangala", "koramangla", "koramnagala"],
    "Indiranagar": ["indiranagar", "indira nagar", "hal 2nd stage", "hal ii stage"],
    "HSR Layout": ["hsr layout", "hsr", "hsr sector"],
    "BTM Layout": ["btm layout", "btm", "btm 1st stage", "btm 2nd stage", "tavarekere", "madiwala"],
    "JP Nagar": ["jp nagar", "j p nagar", "jayaprakash nagar", "jayaprakashnagar", "j.p nagar"],
    "Jayanagar": ["jayanagar", "jaya nagar"],
    "Basavanagudi": ["basavanagudi", "gandhi bazaar", "gandhi bazar", "bull temple road", "dvg road", "dv gundappa road"],
    # not "mavalli": it's also the MTR brand name ("Mavalli Tiffin Rooms" has branches everywhere)
    "Lalbagh": ["lalbagh", "lal bagh", "sudhama nagar"],
    "Wilson Garden": ["wilson garden"],
    "Banashankari": ["banashankari", "kathriguppe", "padmanabhanagar", "padmanabha nagar"],
    "Kumaraswamy Layout": ["kumaraswamy layout", "ks layout", "k s layout"],
    "Uttarahalli": ["uttarahalli", "subramanyapura"],
    "Kanakapura Road": ["kanakapura road", "kanakapura main road", "konanakunte", "doddakallasandra", "talaghattapura"],
    "Bannerghatta Road": ["bannerghatta road", "bannerghatta main road", "bannerghatta rd", "arekere", "hulimavu", "gottigere", "kalena agrahara"],
    "Bommanahalli": ["bommanahalli", "hongasandra", "begur", "kudlu gate", "garvebhavi palya"],
    "Electronic City": ["electronic city", "electronics city", "e city", "konappana agrahara", "neeladri", "hosa road"],
    "Sarjapur Road": ["sarjapur", "sarjapura", "kaikondrahalli", "dommasandra", "haralur", "kasavanahalli", "carmelaram", "doddakannelli"],
    "Bellandur": ["bellandur", "bellanduru", "green glen layout", "devarabeesanahalli", "kadubeesanahalli", "ecospace", "eco space", "panathur"],
    "Marathahalli": ["marathahalli", "marathalli", "munnekollal", "munnekolal", "spice garden"],
    # The Brookefield hub: three neighbouring areas people treat as separate places to eat.
    # not "itpl main road": it runs for miles from Marathahalli deep into Whitefield
    "Brookefield": ["brookefield", "brookfield", "brookefields"],
    "AECS Layout": ["aecs layout", "aecs", "a e c s layout", "a e c s"],
    "Kundalahalli": ["kundalahalli", "kundalhalli", "kundanahalli", "kundalahalli gate", "kundanahalli gate"],
    "Whitefield": ["whitefield", "itpl", "hope farm", "kadugodi", "varthur road", "siddapura"],
    "Varthur": ["varthur", "gunjur", "balagere"],
    "Mahadevapura": ["mahadevapura", "hoodi", "garudacharpalya", "doddanekundi"],
    "KR Puram": ["kr puram", "k r puram", "krishnarajapuram", "tin factory"],
    "CV Raman Nagar": ["cv raman nagar", "c v raman nagar", "new thippasandra", "thippasandra", "bagmane"],
    "Old Airport Road": ["old airport road", "hal airport road", "murugeshpalya", "kodihalli", "vimanapura"],
    "Domlur": ["domlur", "embassy golf links", "challaghatta", "amarjyothi layout"],
    "Ejipura": ["ejipura", "vivek nagar", "viveknagar", "neelasandra"],
    "Ulsoor": ["ulsoor", "halasuru", "halsur", "ulsoor road"],
    "MG Road": ["mg road", "m g road", "mahatma gandhi road", "church street", "brigade road", "residency road",
                "st marks road", "st mark s road", "museum road", "rest house road", "ashok nagar", "ashoknagar",
                "lavelle road", "vittal mallya", "ub city", "cubbon road", "trinity circle"],
    "Richmond Town": ["richmond town", "richmond road", "langford town", "langford road"],
    "Shanti Nagar": ["shanti nagar", "shantinagar", "shanthinagar", "shanthi nagar", "double road", "k h road", "kh road"],
    "Shivajinagar": ["shivajinagar", "shivaji nagar", "russell market", "commercial street", "infantry road"],
    "Vasanth Nagar": ["vasanth nagar", "vasant nagar", "cunningham road", "millers road", "palace road", "high grounds"],
    "Frazer Town": ["frazer town", "fraser town", "cox town", "pulikeshi nagar", "pulakeshi nagar", "mosque road", "coles road"],
    "Kammanahalli": ["kammanahalli", "st thomas town", "lingarajapuram"],
    "Kalyan Nagar": ["kalyan nagar", "kalyanagar", "hrbr", "hbr layout", "hbr"],
    "Banaswadi": ["banaswadi", "ramamurthy nagar", "ramamurthynagar"],
    "Hennur": ["hennur", "kothanur", "kothnur", "byrathi", "hennur main road"],
    "Hebbal": ["hebbal", "manyata", "nagavara", "kempapura", "esteem mall"],
    "RT Nagar": ["rt nagar", "r t nagar", "ganganagar", "sultanpalya", "sultan palya"],
    "Sahakar Nagar": ["sahakar nagar", "sahakara nagar", "sahakaranagar", "sahakaranagara", "sahakarnagar", "kodigehalli", "byatarayanapura"],
    "Yelahanka": ["yelahanka", "yelahanka new town", "allalasandra"],
    "Jakkur": ["jakkur", "thanisandra", "rachenahalli"],
    "New BEL Road": ["new bel road", "bel road", "chikkamaranahalli", "mathikere", "dollars colony", "sanjay nagar",
                     "sanjaynagar", "rmv 2nd stage", "rmv"],
    "Sadashivanagar": ["sadashivanagar", "sadashiva nagar"],
    "Malleshwaram": ["malleshwaram", "malleswaram", "malleshwara", "sampige road", "margosa road"],
    "Seshadripuram": ["seshadripuram", "kumara park"],
    "Majestic": ["majestic", "gandhinagar", "gandhi nagar", "kempegowda", "subedar chatram"],
    "Chickpet": ["chickpet", "chikpet", "chikkapete", "avenue road", "balepet", "cottonpet"],
    "Chamarajpet": ["chamarajpet", "chamarajapete", "chamrajpet", "chamarajpete"],
    "Rajajinagar": ["rajajinagar", "rajaji nagar"],
    "Basaveshwaranagar": ["basaveshwaranagar", "basaveshwara nagar", "basaveshwar nagar"],
    "Vijayanagar": ["vijayanagar", "vijaya nagar", "vijay nagar", "hampi nagar", "attiguppe"],
    "Nagarbhavi": ["nagarbhavi", "nagarabhavi"],
    "Rajarajeshwari Nagar": ["rajarajeshwari nagar", "rr nagar", "r r nagar", "rajarajeshwarinagar"],
    "Kengeri": ["kengeri"],
    "Yeshwanthpur": ["yeshwanthpur", "yeshwantpur", "yesvantpur", "yeswanthpur", "yeshwanthpura"],
    "Jalahalli": ["jalahalli", "jalahalli cross"],
    "Peenya": ["peenya"],
    "Vidyaranyapura": ["vidyaranyapura"],
}

# ---------- the launch hub: AECS Layout / Kundalahalli / Brookefield ----------
# Addresses here often end in "Whitefield" or "Marathahalli" (the post-office names) even though
# people call the area Brookefield. So inside the hub we trust those big names less.
HUB_CENTRE = (12.9672, 77.7162)
HUB_RADIUS_KM = 1.5       # inside this, a big-area name in an address is only a weak hint
HUB_CORE_KM = 1.1         # inside this, places with no clear area can only join a hub area
HUB_AREAS = ["AECS Layout", "Kundalahalli", "Brookefield"]
BROAD_AREAS = {"Whitefield", "Marathahalli", "Varthur", "Mahadevapura", "KR Puram", "EPIP Zone"}

# Names that also exist elsewhere in Bangalore (there is another "AECS Layout" near Singasandra,
# for example). A mention only counts if the place is within this many km of the real area;
# otherwise that mention is ignored.  area -> ((lat, lng), km)
AREA_LIMITS_KM = {
    "AECS Layout": ((12.9665, 77.7140), 3.0),
    "Kundalahalli": ((12.9650, 77.7170), 3.0),
    "Brookefield": ((12.9672, 77.7180), 2.2),
}

# "AECS Layout, Kundalahalli, Whitefield" mentions several. Addresses run small -> big, so the
# last one would normally win; for the hub we want the most specific one, in this order.
SPECIFIC_FIRST = ["AECS Layout", "Kundalahalli", "Brookefield"]

_norm_re = re.compile(r"[^a-z0-9]+")


def _norm(s):
    return " " + _norm_re.sub(" ", (s or "").lower()).strip() + " "


# one regex, longest spellings first so "hsr layout" wins over "hsr"
_alias_to_area = {}
for area, aliases in AREAS.items():
    for a in aliases:
        _alias_to_area[_norm(a).strip()] = area
_pattern = re.compile(" (" + "|".join(re.escape(a) for a in sorted(_alias_to_area, key=len, reverse=True)) + ") ")


def text_hits(*texts):
    """Every known area mentioned, in order, in the first text that mentions any (address first, then name)."""
    for text in texts:
        t = _norm(text)
        hits, pos = [], 0
        while True:
            m = _pattern.search(t, pos)
            if not m:
                break
            hits.append(_alias_to_area[m.group(1)])
            pos = m.end() - 1  # allow overlapping word boundary
        if hits:
            return hits
    return []


def pick_area(hits):
    """The hub's specific areas win; otherwise the rightmost mention (addresses run small -> big)."""
    for s in SPECIFIC_FIRST:
        if s in hits:
            return s
    return hits[-1] if hits else None


def text_area(*texts):
    return pick_area(text_hits(*texts))


def metres(lat1, lng1, lat2, lng2):
    x = math.radians(lng2 - lng1) * math.cos(math.radians((lat1 + lat2) / 2))
    y = math.radians(lat2 - lat1)
    return 6371000 * math.hypot(x, y)


def _median(xs):
    xs = sorted(xs)
    return xs[len(xs) // 2]


class _Grid:
    """Tiny spatial index: ~1.1 km cells."""
    def __init__(self, cell=0.01):
        self.cell, self.cells = cell, defaultdict(list)

    def add(self, lat, lng, item):
        self.cells[(int(lat / self.cell), int(lng / self.cell))].append((lat, lng, item))

    def near(self, lat, lng, rings=1):
        ci, cj = int(lat / self.cell), int(lng / self.cell)
        for i in range(ci - rings, ci + rings + 1):
            for j in range(cj - rings, cj + rings + 1):
                yield from self.cells.get((i, j), ())


def assign_areas(places, fallback=None, k=9, max_km=1.5):
    """
    places: list of dicts with lat, lng, address, name. Sets p['area'] and p['area_how'].
    fallback(p) -> area name or None, used when text and neighbours both fail.
    Returns a small report dict with accuracy numbers.
    """
    # 1. text labels
    def too_far(area, p):
        limit = AREA_LIMITS_KM.get(area)
        return bool(limit) and metres(p["lat"], p["lng"], *limit[0]) > limit[1] * 1000

    for p in places:
        # a mention of "AECS Layout" in the wrong part of the city is ignored, not fatal:
        # the next mention (or the neighbours) decides
        hits = [h for h in text_hits(p.get("address"), p.get("name")) if not too_far(h, p)]
        p["_text"] = pick_area(hits)
        # inside the hub, a big area name ("Whitefield") is only a weak hint
        p["_weak"] = (p["_text"] in BROAD_AREAS
                      and metres(p["lat"], p["lng"], *HUB_CENTRE) <= HUB_RADIUS_KM * 1000)

    # where each area really is: median of its text-labelled places
    pts = defaultdict(list)
    for p in places:
        if p["_text"]:
            pts[p["_text"]].append((p["lat"], p["lng"]))
    centre, spread = {}, {}
    for area, ll in pts.items():
        c = (_median([a for a, _ in ll]), _median([b for _, b in ll]))
        centre[area] = c
        spread[area] = _median([metres(a, b, *c) for a, b in ll]) if len(ll) > 2 else 1500

    # The address/name wins for the place itself (pins are wrong more often than addresses),
    # unless the mention is absurdly far away. But only mentions close to the area's real
    # location get to vote for their neighbours, so a misplaced pin can't pull a border.
    labelled = []
    for p in places:
        a = p["_text"]
        if not a:
            continue
        d = metres(p["lat"], p["lng"], *centre[a])
        if d > 8000:
            p["_text"] = None
        elif d <= max(3000, 3 * spread[a]) and not p["_weak"]:
            labelled.append(p)
    grid = _Grid()
    for p in labelled:
        grid.add(p["lat"], p["lng"], p)

    def vote(p, exclude_self=False, only=None, min_share=0.4):
        cands = []
        for lat, lng, q in grid.near(p["lat"], p["lng"], rings=2):
            if exclude_self and q is p:
                continue
            if only and q["_text"] not in only:
                continue
            d = metres(p["lat"], p["lng"], lat, lng)
            if d <= max_km * 1000:
                cands.append((d, q["_text"]))
        if not cands:
            return None
        cands.sort()
        weights = Counter()
        for d, a in cands[:k]:
            weights[a] += 1 / (60 + d)  # nearer neighbours count more
        area, w = weights.most_common(1)[0]
        return area if w / sum(weights.values()) >= min_share else None

    # accuracy check: hide each labelled place's own label and see if neighbours guess it
    sample = labelled[::3]
    correct = sum(1 for p in sample if vote(p, exclude_self=True) == p["_text"])
    fb_sample = [p for p in sample if fallback]
    fb_correct = sum(1 for p in fb_sample if fallback(p) == p["_text"]) if fallback else 0

    counts = Counter()
    for p in places:
        undecided = p["_weak"] or not p["_text"]    # a weak hint, or no hint at all
        in_core = metres(p["lat"], p["lng"], *HUB_CENTRE) <= HUB_CORE_KM * 1000
        guess = None
        if undecided:
            # right in the middle of the hub, only a hub area is a sensible answer
            guess = (vote(p, only=HUB_AREAS, min_share=0) if in_core else None) or vote(p)
        if guess:
            p["area"], how = guess, "neighbours"
        elif p["_text"]:
            p["area"], how = p["_text"], "address"
        else:
            p["area"], how = (fallback(p) if fallback else None) or "Bangalore", "fallback"
        p["area_how"] = how
        counts[how] += 1
    for p in places:  # only after the loop: neighbours read each other's _text while voting
        del p["_text"], p["_weak"]

    return {
        "by_method": dict(counts),
        "neighbour_accuracy": correct / len(sample) if sample else None,
        "old_method_accuracy": fb_correct / len(fb_sample) if fb_sample else None,
        "checked": len(sample),
    }
