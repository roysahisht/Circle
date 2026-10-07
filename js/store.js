// All app data lives here.
//  - Base places: every Bangalore food spot (data/bangalore-places.json), loaded fresh on each
//    visit, never written anywhere.
//  - Shared data: ratings, saved places, friends and places people added.
//      cloud mode (Supabase set in config.js): loaded from / saved to the shared database.
//      demo mode (no Supabase): made-up people, saved only in this browser (localStorage).
// Reads are instant from memory; writes update memory first, then the database.
window.Store = (function () {
  const KEY = 'circle.v1';
  const DAY = 864e5;
  const cloud = !!(window.Cloud && Cloud.enabled);
  let db = null;
  let errorHandler = (msg, err) => console.error(msg, err);
  const onError = fn => { errorHandler = fn; };
  // Cloud write that undoes the in-memory change if the database says no.
  function sync(promise, undo, msg) {
    promise.catch(err => { undo(); errorHandler(msg, err); });
  }
  let base = [];               // OpenStreetMap places not (yet) touched by anyone
  let byId = new Map();        // id -> place, for both db.places and base
  let reviewsByPlace = null;   // placeId -> reviews, rebuilt lazily after changes
  let baseInfo = null;         // { count, fetchedAt, attribution }

  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const slug = s => norm(s).replace(/ /g, '-');
  const avg = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

  function km(a, b) {
    if (a.lat == null || b.lat == null) return Infinity;
    const rad = d => (d * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
  }

  function reindex() {
    byId = new Map();
    db.places.forEach(p => { p._n = norm(p.name); byId.set(p.id, p); });
    base.forEach(p => { if (!byId.has(p.id)) byId.set(p.id, p); });
    reviewsByPlace = null;
  }

  // ---------- persistence ----------
  async function load() {
    if (cloud) {
      const user = await Cloud.currentUser();
      authUser = user;
      const meId = user ? user.id : null;
      const data = await Cloud.loadAll(meId);
      db = { version: 1, meId, ...data };
      // A brand-new account's profile can lag a moment behind sign-up.
      if (meId && !db.users.some(u => u.id === meId)) {
        db.users.push({ id: meId, name: (user.user_metadata && user.user_metadata.full_name) || 'You', color: Cloud.colorFor(meId), isMe: true });
      }
      if (meId) Cloud.recordVisit();
      if (lastBaseJson) loadBase(lastBaseJson); else reindex();
      return;
    }
    try { db = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { db = null; }
    if (!db || db.version !== 1) { db = Seed.build(); save(); }
    if (lastBaseJson) loadBase(lastBaseJson); else reindex();
  }
  function save() {
    if (cloud) return true; // cloud writes go through Cloud.* instead
    try {
      localStorage.setItem(KEY, JSON.stringify(db, (k, v) => (k === '_n' ? undefined : v)));
      return true;
    } catch (e) {
      console.error('Could not save Circle data', e);
      return false;
    }
  }
  function reset() { db = Seed.build(); save(); loadBase(null); }

  // Takes the compact JSON written by scripts/fetch_osm_places.py.
  let lastBaseJson = null;
  function loadBase(json) {
    json = json || lastBaseJson;
    if (!db) { lastBaseJson = json; return 0; } // arrived before our own data; load() applies it
    if (!json) { reindex(); return 0; }
    lastBaseJson = json;
    const f = Object.fromEntries(json.fields.map((name, i) => [name, i]));
    const mine = db.places;
    const myOsmIds = new Set(mine.map(p => p.osmId).filter(Boolean));
    const unlinked = mine.filter(p => !p.osmId).map(p => ({ p, n: norm(p.name) }));
    // "Meghana Foods" (ours) and "Meghana Foods Koramangala" (map listing) 400 m apart = same place.
    const twinOf = b => {
      const hit = unlinked.find(u => (b._n === u.n || b._n.startsWith(u.n + ' ')) && km(u.p, b) < 0.5);
      return hit && hit.p;
    };

    base = [];
    json.places.forEach(row => {
      const id = row[f.id];
      if (myOsmIds.has(id)) return;
      const p = {
        id, osmId: id, name: row[f.name], lat: row[f.lat], lng: row[f.lng],
        area: json.areas[row[f.area]], cuisine: row[f.cuisine], veg: !!row[f.veg],
        address: row[f.address] || '', hours: row[f.hours] || '', phone: row[f.phone] || '',
        website: row[f.website] || '', price: null, dishes: [], googleId: null,
      };
      p._n = norm(p.name);
      // Same restaurant already in my data (e.g. a demo place)? Link it instead of adding a twin.
      const twin = twinOf(p);
      if (twin) {
        twin.osmId = id;
        ['hours', 'phone', 'website'].forEach(k => { if (!twin[k] && p[k]) twin[k] = p[k]; });
        if (twin.address === `${twin.area}, Bengaluru` && p.address) twin.address = p.address;
        // The map listing has the exact pin and the area name used everywhere else.
        if (p.area !== 'Bangalore') twin.area = p.area;
        twin.lat = p.lat;
        twin.lng = p.lng;
        unlinked.splice(unlinked.findIndex(u => u.p === twin), 1);
        return;
      }
      base.push(p);
    });
    baseInfo = { count: base.length + mine.length, fetchedAt: json.fetchedAt, attribution: json.attribution };
    save();
    reindex();
    return base.length;
  }
  const info = () => baseInfo;

  // A base place someone rated or saved gets copied into our own data, so it survives
  // even if a later OpenStreetMap refresh drops or renames it.
  function keep(id) {
    const i = base.findIndex(p => p.id === id);
    if (i < 0) return;
    const [p] = base.splice(i, 1);
    db.places.push(p);
  }

  // ---------- people ----------
  const GUEST = Object.freeze({ id: null, name: 'You', color: '#FFE66D', isMe: true });
  const me = () => db.users.find(u => u.id === db.meId) || GUEST;
  const signedIn = () => !!db.meId;
  const users = () => db.users;
  const user = id => db.users.find(u => u.id === id) || { id, name: 'Someone', color: '#eee' };
  const isFriend = id => db.friendIds.includes(id);
  const friendUsers = () => db.friendIds.map(user);
  function toggleFriend(id) {
    const i = db.friendIds.indexOf(id);
    const on = i < 0;
    if (on) db.friendIds.push(id); else db.friendIds.splice(i, 1);
    save();
    if (cloud) {
      sync(Cloud.setFollow(db.meId, id, on), () => {
        const j = db.friendIds.indexOf(id);
        if (on && j >= 0) db.friendIds.splice(j, 1);
        if (!on && j < 0) db.friendIds.push(id);
      }, 'Could not update your circle');
    }
    return on;
  }

  // ---------- account (cloud mode) ----------
  let authUser = null;
  // { anonymous, email } — anonymous = name-only account that lives in this browser.
  function account() {
    if (!authUser) return null;
    return { anonymous: !!authUser.is_anonymous, email: authUser.email || '' };
  }
  async function signUp(name, captchaToken) {
    await Cloud.signUpAnonymously(name, captchaToken);
    await load();
  }
  async function rename(name) {
    await Cloud.updateName(db.meId, name);
    const u = db.users.find(x => x.id === db.meId);
    if (u) u.name = name;
  }
  async function inviteLink() {
    const token = await Cloud.inviteToken(db.meId);
    return `${location.origin}${location.pathname}?invite=${token}`;
  }
  async function acceptInvite(token) {
    const inviterName = await Cloud.acceptInvite(token);
    if (inviterName) await load();
    return inviterName;
  }
  const reviewCount = userId => db.reviews.filter(r => r.userId === userId).length;

  // ---------- places ----------
  const places = () => db.places.concat(base);
  const place = id => byId.get(id);
  const placeCount = () => db.places.length + base.length;

  function countAreas(list) {
    const count = {};
    list.forEach(p => { count[p.area] = (count[p.area] || 0) + 1; });
    return Object.keys(count).sort((a, b) => count[b] - count[a] || a.localeCompare(b));
  }
  // Areas that have at least one rating (for Trending chips).
  const ratedAreas = () => countAreas([...new Set(db.reviews.map(r => r.placeId))].map(place).filter(Boolean));
  const allAreas = () => countAreas(places());

  // People type areas freely ("AECS Layout, Kundalahalli", "koramangala"). Snap to an area name
  // we already have, so lists and area pages don't split into near-duplicates: a case-insensitive
  // match first, then the first comma-separated part that matches. Otherwise it's a genuinely new name.
  function canonicalArea(typed) {
    const raw = String(typed || '').trim();
    if (!raw) return 'Bangalore';
    const known = new Map(allAreas().map(a => [norm(a), a]));
    if (known.has(norm(raw))) return known.get(norm(raw));
    for (const part of raw.split(/[,/|]| - /)) {
      const hit = known.get(norm(part));
      if (hit) return hit;
    }
    return raw;
  }

  function searchPlaces(q, limit = 8) {
    const n = norm(q);
    if (!n) return [];
    const starts = [], contains = [];
    for (const p of byId.values()) {
      if (p._n.startsWith(n)) starts.push(p);
      else if (p._n.includes(n)) contains.push(p);
      if (starts.length >= limit) break;
    }
    const rank = p => (reviewsFor(p.id).length ? 0 : 1); // places with ratings first
    return starts.sort((a, b) => rank(a) - rank(b)).concat(contains.sort((a, b) => rank(a) - rank(b))).slice(0, limit);
  }
  function searchAreas(q) {
    const n = norm(q);
    return n.length < 3 ? [] : allAreas().filter(a => norm(a).includes(n)).slice(0, 3);
  }
  function placesInArea(area) {
    return places().filter(p => p.area === area);
  }
  function findPlace(d) {
    if (d.osmId && byId.has(d.osmId)) return byId.get(d.osmId);
    const n = norm(d.name);
    for (const p of byId.values()) {
      if ((d.googleId && p.googleId === d.googleId) || (d.osmId && p.osmId === d.osmId)) return p;
      if (p._n === n && (norm(p.area) === norm(d.area) || km(p, d) < 0.4)) return p;
    }
    return null;
  }
  function addPlace(d) {
    const baseId = slug(`${d.name} ${d.area || ''}`).slice(0, 48) || 'place';
    let id = baseId, i = 2;
    // shared database: random suffix so two people adding "Raju Chaat" don't collide
    if (cloud) id = `u-${baseId.slice(0, 40)}-${Math.random().toString(36).slice(2, 8)}`;
    while (byId.has(id)) id = `${baseId}-${i++}`;
    const p = {
      id, name: d.name, area: canonicalArea(d.area), cuisine: d.cuisine || 'Restaurant',
      price: d.price || null, veg: !!d.veg, lat: d.lat, lng: d.lng, address: d.address || '',
      dishes: [], googleId: d.googleId || null, osmId: d.osmId || null, addedBy: d.addedBy || null,
    };
    db.places.push(p);
    save();
    reindex();
    return p;
  }
  // Called when Google finds the matching listing for a place: remember its id
  // and fix our pin if Google's location is close by.
  function setGoogleMatch(id, googleId, loc) {
    const p = place(id);
    if (!p) return;
    p.googleId = googleId;
    if (loc && km(p, loc) < 3) { p.lat = loc.lat; p.lng = loc.lng; }
    save();
  }

  // ---------- reviews ----------
  const reviews = () => db.reviews;
  function reviewsFor(placeId) {
    if (!reviewsByPlace) {
      reviewsByPlace = new Map();
      db.reviews.forEach(r => {
        if (!reviewsByPlace.has(r.placeId)) reviewsByPlace.set(r.placeId, []);
        reviewsByPlace.get(r.placeId).push(r);
      });
    }
    return reviewsByPlace.get(placeId) || [];
  }
  // Async in both modes. Resolves to the saved review; throws if it couldn't be saved.
  async function addReview(r) {
    keep(r.placeId);
    if (cloud) {
      await Cloud.ensurePlace(place(r.placeId));
      const photo = r.photo ? await Cloud.uploadPhoto(db.meId, r.photo) : null;
      const review = await Cloud.insertReview({ ...r, photo });
      db.reviews.push(review);
      reindex();
      return review;
    }
    const review = {
      id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      userId: db.meId, createdAt: Date.now(), photo: null, ...r,
    };
    db.reviews.push(review);
    if (!save()) { db.reviews.pop(); throw new Error('Storage is full — try posting without the photo.'); }
    reindex();
    return review;
  }
  // One vote per person per place: their most recent rating counts.
  function latestByUser(placeId) {
    const m = new Map();
    reviewsFor(placeId).forEach(r => {
      const cur = m.get(r.userId);
      if (!cur || r.createdAt > cur.createdAt) m.set(r.userId, r);
    });
    return [...m.values()];
  }
  // Average pulled toward 7 so a place with one 10/10 doesn't beat one with fifty 9s.
  function weighted(latest) {
    if (!latest.length) return null;
    const PRIOR = 7, WEIGHT = 1;
    return (latest.reduce((s, r) => s + r.score, 0) + PRIOR * WEIGHT) / (latest.length + WEIGHT);
  }
  const EMPTY_STATS = Object.freeze({ myScore: null, circleAvg: null, circleCount: 0, cityAvg: null, cityCount: 0, ranked: null });
  function placeStats(id) {
    const latest = latestByUser(id);
    if (!latest.length) return EMPTY_STATS;
    const mine = latest.find(r => r.userId === db.meId);
    const circle = latest.filter(r => isFriend(r.userId));
    return {
      myScore: mine ? mine.score : null,
      circleAvg: avg(circle.map(r => r.score)),
      circleCount: circle.length,
      cityAvg: avg(latest.map(r => r.score)),
      cityCount: latest.length,
      ranked: weighted(latest),
    };
  }

  // ---------- want to try ----------
  const isWanted = id => db.want.some(w => w.placeId === id);
  function toggleWant(id) {
    const before = db.want;
    const on = !isWanted(id);
    if (on) {
      keep(id);
      db.want = [{ placeId: id, addedAt: Date.now() }, ...db.want];
      reindex();
    } else {
      db.want = db.want.filter(w => w.placeId !== id);
    }
    save();
    if (cloud) {
      const p = place(id);
      const write = on ? Cloud.ensurePlace(p).then(() => Cloud.setWant(id, true)) : Cloud.setWant(id, false);
      sync(write, () => { db.want = before; }, 'Could not update Want to Try');
    }
    return on;
  }
  const wantList = () => db.want.map(w => ({ ...w, place: place(w.placeId) })).filter(w => w.place);

  // ---------- trending & top lists ----------
  // Heat = recent ratings, newer and higher scores count more. Window: 14 days.
  function trending(area) {
    const now = Date.now();
    const byPlace = {};
    db.reviews.forEach(r => {
      const age = (now - r.createdAt) / DAY;
      if (age > 14) return;
      const p = place(r.placeId);
      if (!p || (area && p.area !== area)) return;
      const e = byPlace[p.id] || (byPlace[p.id] = { place: p, heat: 0, week: 0 });
      e.heat += (1 - age / 14) * (0.4 + r.score / 10);
      if (age <= 7) e.week++;
    });
    return Object.values(byPlace)
      .map(e => ({ ...e, stats: placeStats(e.place.id) }))
      .sort((a, b) => b.heat - a.heat);
  }

  function topLists() {
    const rated = [...new Set(db.reviews.map(r => r.placeId))]
      .map(place).filter(Boolean)
      .map(p => ({ place: p, stats: placeStats(p.id) }));
    const groupBy = (arr, key) => {
      const g = {};
      arr.forEach(x => { (g[key(x)] = g[key(x)] || []).push(x); });
      return Object.entries(g);
    };
    const make = (id, title, subtitle, items, scoreOf, extra = {}) => {
      const top = items
        .map(x => ({ ...x, score: scoreOf(x) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);
      return {
        id, subtitle, items: top, ...extra,
        title: title.replace('{n}', top.length),
        been: top.filter(x => x.stats.myScore != null).length,
      };
    };

    const lists = [];
    const circleItems = rated.filter(x => x.stats.circleCount);
    if (circleItems.length >= 3) {
      lists.push(make('circle-favourites', "Your circle's top {n}", 'Ranked by your friends only', circleItems, x => x.stats.circleAvg, { kind: 'circle' }));
    }
    groupBy(rated, x => x.place.area).forEach(([area, items]) => {
      if (items.length >= 3) lists.push(make('area-' + slug(area), `Top {n} ${area}`, 'Ranked by everyone on Circle', items, x => x.stats.ranked, { kind: 'area', area }));
    });
    groupBy(rated, x => x.place.cuisine).forEach(([cuisine, items]) => {
      if (items.length >= 3) lists.push(make('cuisine-' + slug(cuisine), `Best ${cuisine} in Bangalore`, 'Ranked by everyone on Circle', items, x => x.stats.ranked, { kind: 'cuisine' }));
    });
    return lists;
  }

  return {
    cloud, onError, signedIn, account, signUp, rename, inviteLink, acceptInvite,
    load, loadBase, info, reset, me, users, user, isFriend, friendUsers, toggleFriend, reviewCount,
    places, place, placeCount, ratedAreas, allAreas, canonicalArea, searchPlaces, searchAreas, placesInArea,
    findPlace, addPlace, setGoogleMatch,
    reviews, reviewsFor, addReview, placeStats, isWanted, toggleWant, wantList, trending, topLists,
  };
})();
