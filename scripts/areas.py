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
    "Marathahalli": ["marathahalli", "marathalli", "munnekollal", "munnekolal", "aecs layout", "spice garden"],
    "Brookefield": ["brookefield", "brookfield", "kundalahalli", "itpl main road"],
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

_norm_re = re.compile(r"[^a-z0-9]+")


def _norm(s):
    return " " + _norm_re.sub(" ", (s or "").lower()).strip() + " "


# one regex, longest spellings first so "hsr layout" wins over "hsr"
_alias_to_area = {}
for area, aliases in AREAS.items():
    for a in aliases:
        _alias_to_area[_norm(a).strip()] = area
_pattern = re.compile(" (" + "|".join(re.escape(a) for a in sorted(_alias_to_area, key=len, reverse=True)) + ") ")


def text_area(*texts):
    """Rightmost known area mentioned across the given texts (address first, then name)."""
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
            return hits[-1]
    return None


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
    for p in places:
        p["_text"] = text_area(p.get("address"), p.get("name"))

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
        elif d <= max(3000, 3 * spread[a]):
            labelled.append(p)
    grid = _Grid()
    for p in labelled:
        grid.add(p["lat"], p["lng"], p)

    def vote(p, exclude_self=False):
        cands = []
        for lat, lng, q in grid.near(p["lat"], p["lng"], rings=2):
            if exclude_self and q is p:
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
        return area if w / sum(weights.values()) >= 0.4 else None

    # accuracy check: hide each labelled place's own label and see if neighbours guess it
    sample = labelled[::3]
    correct = sum(1 for p in sample if vote(p, exclude_self=True) == p["_text"])
    fb_sample = [p for p in sample if fallback]
    fb_correct = sum(1 for p in fb_sample if fallback(p) == p["_text"]) if fallback else 0

    counts = Counter()
    for p in places:
        if p["_text"]:
            p["area"], how = p["_text"], "address"
        else:
            guess = vote(p)
            if guess:
                p["area"], how = guess, "neighbours"
            else:
                p["area"], how = (fallback(p) if fallback else None) or "Bangalore", "fallback"
        p["area_how"] = how
        counts[how] += 1
    for p in places:  # only after the loop: neighbours read each other's _text while voting
        del p["_text"]

    return {
        "by_method": dict(counts),
        "neighbour_accuracy": correct / len(sample) if sample else None,
        "old_method_accuracy": fb_correct / len(fb_sample) if fb_sample else None,
        "checked": len(sample),
    }
