// Circle UI: renders each tab into #view, opens bottom sheets, and handles every
// click through one delegated listener (elements carry data-action="...").
(function () {
  'use strict';

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const BUCKETS = {
    loved: { label: 'Loved it', emoji: '😍', min: 7, max: 10, start: 8.5 },
    fine: { label: 'It was fine', emoji: '🙂', min: 4, max: 6.9, start: 5.5 },
    nope: { label: 'Nope', emoji: '😬', min: 1, max: 3.9, start: 2.5 },
  };
  const bucketFor = s => (s >= 7 ? 'loved' : s >= 4 ? 'fine' : 'nope');
  const fmt = n => (n == null ? '–' : n.toFixed(1));

  const CUISINE_EMOJI = [
    ['biryani', '🍛'], ['burger', '🍔'], ['barbecue', '🍖'], ['breakfast', '🥞'], ['café', '☕'], ['cafe', '☕'],
    ['coffee', '☕'], ['brew', '🍺'], ['bar', '🍺'], ['pub', '🍺'], ['bakery', '🧁'], ['burmese', '🍜'],
    ['mexican', '🌮'], ['european', '🍝'], ['italian', '🍝'], ['pizza', '🍕'], ['andhra', '🌶️'],
    ['north indian', '🍢'], ['south indian', '🫓'], ['dessert', '🍨'], ['ice cream', '🍨'], ['chinese', '🥡'],
  ];
  const emojiFor = c => (CUISINE_EMOJI.find(([k]) => String(c || '').toLowerCase().includes(k)) || [0, '🍽️'])[1];

  const state = { trendingArea: 'All', mapFilter: 'all', focusId: null, areaLimit: 60 };
  let mapCtl = null;
  let mapBuilding = null;
  let sheetCleanup = null;
  const CITY = (window.CIRCLE_CONFIG && CIRCLE_CONFIG.CITY) || { lat: 12.9716, lng: 77.5946 };
  const COMMON_CUISINES = ['South Indian', 'North Indian', 'Biryani', 'Chinese', 'Café', 'Bakery', 'Chaat', 'Andhra', 'Kerala', 'Mangalorean', 'Pizza', 'Burgers', 'Desserts', 'Juice', 'Fast food', 'Bar', 'Street food'];

  // ---------- small helpers ----------
  function timeAgo(ts) {
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    const h = Math.round(m / 60);
    if (h < 24) return h + 'h ago';
    const d = Math.round(h / 24);
    return d < 7 ? d + 'd ago' : Math.round(d / 7) + 'w ago';
  }
  function hue(str) {
    let h = 0;
    for (const ch of String(str)) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return h;
  }
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 2600);
  }
  const currentRoute = () => (location.hash.replace(/^#\/?/, '') || 'circle').split('/');

  // ---------- shared pieces ----------
  function avatar(u, small) {
    const initials = u.isMe ? 'ME' : u.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    return `<span class="avatar ${small ? 'avatar--sm' : ''}" style="--c:${esc(u.color)}">${esc(initials)}</span>`;
  }
  function photoBlock(p, photo, variant = '') {
    if (photo) return `<div class="photo ${variant}"><img src="${esc(photo)}" alt="Photo of ${esc(p.name)}" loading="lazy"></div>`;
    return `<div class="photo photo--ph ${variant}" data-gphoto="${esc(p.id)}" style="--h:${hue(p.name)}"><span>${emojiFor(p.cuisine)}</span></div>`;
  }
  function wantBtn(id) {
    const on = Store.isWanted(id);
    return `<button class="btn btn--want ${on ? 'on' : ''}" data-action="toggle-want" data-id="${esc(id)}">${on ? '🔖 Saved' : '🔖 Want to try'}</button>`;
  }
  function scoreChip(score) {
    return score == null ? '<span class="score">–</span>' : `<span class="score score--${bucketFor(score)}">${fmt(score)}</span>`;
  }
  function placeMeta(p) {
    return [esc(p.area), esc(p.cuisine), p.price ? `₹${p.price} for two` : '', p.veg ? '<span class="veg">● Pure veg</span>' : '']
      .filter(Boolean).join(' · ');
  }
  function sectionTitle(text) { return `<h2 class="section-title">${text}</h2>`; }
  function empty(emoji, title, text) {
    return `<div class="empty"><span>${emoji}</span><b>${title}</b><p>${text}</p></div>`;
  }

  function reviewCard(r) {
    const p = Store.place(r.placeId);
    if (!p) return '';
    const u = Store.user(r.userId);
    const b = BUCKETS[r.bucket];
    return `<article class="card">
      <header class="review-head">${avatar(u, true)}
        <div><b>${u.isMe ? 'You' : esc(u.name)}</b> <span class="meta">· ${timeAgo(r.createdAt)}</span></div>
      </header>
      <button class="photo-btn" data-action="open-place" data-id="${esc(p.id)}" aria-label="Open ${esc(p.name)}">${photoBlock(p, r.photo)}</button>
      <div class="review-body">
        <button class="place-link" data-action="open-place" data-id="${esc(p.id)}">${esc(p.name)}</button>
        <div class="meta">${placeMeta(p)}</div>
        <div class="rating-row"><span class="bucket bucket--${r.bucket}">${b.emoji} ${b.label}</span>${scoreChip(r.score)}</div>
        ${r.dish ? `<p class="dish">🍴 Order the <b>${esc(r.dish)}</b></p>` : ''}
        ${r.note ? `<p class="note">“${esc(r.note)}”</p>` : ''}
      </div>
      <footer class="card-actions">
        ${u.isMe ? '' : wantBtn(p.id)}
        <button class="btn" data-action="show-on-map" data-id="${esc(p.id)}">📍 Map</button>
        ${u.isMe ? '' : `<button class="btn" data-action="rate" data-id="${esc(p.id)}">⭐ Been? Rate</button>`}
      </footer>
    </article>`;
  }

  // ---------- views ----------
  function renderCircle() {
    const meId = Store.me().id;
    const friends = Store.friendUsers();
    const feed = Store.reviews()
      .filter(r => r.userId === meId || Store.isFriend(r.userId))
      .sort((a, b) => b.createdAt - a.createdAt);
    return `
      <section class="hero">
        <h1>What your circle is eating</h1>
        <p>Only your real friends. No bots, no paid reels.</p>
      </section>
      <div class="friends-row">
        ${Store.cloud ? '<button class="friend" data-action="invite"><span class="avatar avatar--invite">💌</span><span>Invite</span></button>' : ''}
        ${friends.map(u => `<div class="friend">${avatar(u)}<span>${esc(u.name)}</span></div>`).join('')}
        <button class="friend" data-action="manage-circle"><span class="avatar avatar--add">＋</span><span>Manage</span></button>
      </div>
      ${feed.length ? feed.map(reviewCard).join('') : `
        <div class="empty"><span>👯</span><b>Your circle is quiet</b>
          <p>Circle is only as good as your friends. Send your foodie group the invite link — when they open it, you're in each other's circle.</p>
          ${Store.cloud ? '<button class="btn btn--primary" data-action="invite">💌 Invite friends on WhatsApp</button>' : ''}
        </div>`}`;
  }

  function renderTrending() {
    const area = state.trendingArea;
    const areaFilter = area === 'All' ? null : area;
    const meId = Store.me().id;
    const hot = Store.trending(areaFilter).slice(0, 5);
    const lists = Store.topLists().sort((a, b) => (b.area === area) - (a.area === area));
    const fresh = Store.reviews()
      .filter(r => r.userId !== meId && !Store.isFriend(r.userId))
      .filter(r => !areaFilter || (Store.place(r.placeId) || {}).area === areaFilter)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 8);

    return `
      <div class="searchbar">
        <input type="search" id="explore-q" placeholder="🔎 Search ${Store.placeCount().toLocaleString('en-IN')} places or an area…" autocomplete="off" enterkeyhint="search">
        <div id="explore-results"></div>
      </div>
      <div class="chips">
        ${['All', ...Store.ratedAreas()].map(a => `<button class="chip ${a === area ? 'on' : ''}" data-action="set-area" data-area="${esc(a)}">${a === 'All' ? 'All Bangalore' : esc(a)}</button>`).join('')}
      </div>

      ${areaFilter ? `<a class="area-link" href="#/area/${encodeURIComponent(area)}">📍 See all ${Store.placesInArea(area).length} places in ${esc(area)} →</a>` : ''}
      ${sectionTitle(`🔥 Trending in ${area === 'All' ? 'Bangalore' : esc(area)}`)}
      ${hot.length ? hot.map((e, i) => `
        <button class="rank-row" data-action="open-place" data-id="${esc(e.place.id)}">
          <span class="rank">#${i + 1}</span>
          ${photoBlock(e.place, null, 'thumb')}
          <span class="grow">
            <b class="ellipsis">${esc(e.place.name)}</b>
            <span class="meta">${esc(e.place.area)} · ${esc(e.place.cuisine)}</span>
            <span class="meta hot">${e.week ? `🔥 ${e.week} rating${e.week > 1 ? 's' : ''} this week` : 'Rated in the last 2 weeks'}</span>
          </span>
          ${scoreChip(e.stats.ranked)}
        </button>`).join('') : empty('🌙', 'Quiet here lately', 'Nobody has rated a place in this area in the last 2 weeks.')}

      ${sectionTitle('🏆 Top lists')}
      <div class="lists-scroll">
        ${lists.map(l => `
          <a class="list-card list-card--${esc(l.kind)}" href="#/list/${encodeURIComponent(l.id)}">
            <small>${esc(l.subtitle)}</small>
            <h3>${esc(l.title)}</h3>
            <div class="progress"><i style="width:${Math.round((l.been / l.items.length) * 100)}%"></i></div>
            <small>You've been to ${l.been} of ${l.items.length}</small>
          </a>`).join('')}
      </div>

      ${sectionTitle('👀 Fresh from other foodies')}
      ${fresh.length ? fresh.map(reviewCard).join('') : empty('🍽️', 'No ratings yet', 'Be the first to rate a place here.')}`;
  }

  function renderList(id) {
    const list = Store.topLists().find(l => l.id === id);
    if (!list) return `<a class="back" href="#/trending">← Trending</a>${empty('🤷', 'List not found', 'It may not have enough ratings yet.')}`;
    return `
      <a class="back" href="#/trending">← Trending</a>
      <section class="hero hero--list">
        <small>${esc(list.subtitle)}</small>
        <h1>${esc(list.title)}</h1>
        <div class="progress progress--lg"><i style="width:${Math.round((list.been / list.items.length) * 100)}%"></i></div>
        <p>You've been to <b>${list.been} of ${list.items.length}</b>${list.been === list.items.length ? ' — legend 🏅' : ''}</p>
      </section>
      ${list.items.map((x, i) => {
        const been = x.stats.myScore != null;
        return `<div class="rank-row ${been ? 'rank-row--been' : ''}">
          <span class="rank">#${i + 1}</span>
          <button class="unstyled" data-action="open-place" data-id="${esc(x.place.id)}">${photoBlock(x.place, null, 'thumb')}</button>
          <button class="grow unstyled" data-action="open-place" data-id="${esc(x.place.id)}">
            <b class="ellipsis">${esc(x.place.name)}</b>
            <span class="meta">${esc(x.place.area)} · ${esc(x.place.cuisine)}</span>
            <span class="meta">${been ? '✅ You’ve been' : `${x.stats.cityCount} rating${x.stats.cityCount > 1 ? 's' : ''}`}</span>
          </button>
          <span class="rank-side">${scoreChip(x.score)}${been ? '' : `<button class="icon-btn ${Store.isWanted(x.place.id) ? 'on' : ''}" data-action="toggle-want" data-id="${esc(x.place.id)}" aria-label="Want to try">🔖</button>`}</span>
        </div>`;
      }).join('')}`;
  }

  // Every place in one area — rated ones first, then A–Z.
  function renderArea(area) {
    const all = Store.placesInArea(area)
      .map(p => ({ place: p, stats: Store.placeStats(p.id) }))
      .sort((a, b) => (b.stats.ranked || 0) - (a.stats.ranked || 0) || a.place.name.localeCompare(b.place.name));
    const shown = all.slice(0, state.areaLimit);
    return `
      <a class="back" href="#/trending">← Trending</a>
      <section class="hero hero--list">
        <small>Every spot on the map</small>
        <h1>${esc(area)}</h1>
        <p><b>${all.length}</b> places · <b>${all.filter(x => x.stats.cityCount).length}</b> rated on Circle so far</p>
      </section>
      ${all.length ? shown.map(x => `
        <div class="rank-row">
          <button class="unstyled" data-action="open-place" data-id="${esc(x.place.id)}">${photoBlock(x.place, null, 'thumb')}</button>
          <button class="grow unstyled" data-action="open-place" data-id="${esc(x.place.id)}">
            <b class="ellipsis">${esc(x.place.name)}</b>
            <span class="meta">${esc(x.place.cuisine)}${x.place.veg ? ' · <span class="veg">● Pure veg</span>' : ''}</span>
            <span class="meta">${x.stats.cityCount ? `${x.stats.cityCount} rating${x.stats.cityCount > 1 ? 's' : ''}` : 'Not rated yet — be the first'}</span>
          </button>
          <span class="rank-side">${scoreChip(x.stats.ranked)}<button class="icon-btn ${Store.isWanted(x.place.id) ? 'on' : ''}" data-action="toggle-want" data-id="${esc(x.place.id)}" aria-label="Want to try">🔖</button></span>
        </div>`).join('') : empty('🤷', 'No places here', 'Try another area.')}
      ${all.length > shown.length ? `<button class="btn btn--block" data-action="more-area">Show more (${all.length - shown.length} left)</button>` : ''}`;
  }

  function bindExploreSearch() {
    const input = $('#explore-q');
    if (!input) return;
    const out = $('#explore-results');
    let timer = null;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const q = input.value.trim();
        if (q.length < 2) { out.innerHTML = ''; return; }
        const areas = Store.searchAreas(q);
        const found = Store.searchPlaces(q, 8);
        out.innerHTML = `<ul class="results">
          ${areas.map(a => `<li><a class="result" href="#/area/${encodeURIComponent(a)}"><span class="src src--local">Area</span><span class="grow"><b>📍 ${esc(a)}</b><small class="meta">See all ${Store.placesInArea(a).length} places</small></span></a></li>`).join('')}
          ${found.map(p => {
            const s = Store.placeStats(p.id);
            return `<li><button class="result" data-action="open-place" data-id="${esc(p.id)}"><span class="grow"><b>${esc(p.name)}</b><small class="meta">${esc(p.area)} · ${esc(p.cuisine)}</small></span>${s.cityCount ? scoreChip(s.ranked) : ''}</button></li>`;
          }).join('')}
          ${!areas.length && !found.length ? '<li class="meta">Nothing found. Not on the map? Add it with “＋ Rate a place”.</li>' : ''}
        </ul>`;
      }, 200);
    });
  }

  function renderSaved() {
    const items = Store.wantList();
    const meId = Store.me().id;
    const mine = Store.reviews().filter(r => r.userId === meId).sort((a, b) => b.createdAt - a.createdAt);
    return `
      <section class="hero hero--want">
        <h1>Want to Try</h1>
        <p>${items.length ? `${items.length} place${items.length > 1 ? 's' : ''} on your list` : 'Your food bucket list'}</p>
      </section>
      ${items.length ? items.map(({ place: p, addedAt }) => {
        const s = Store.placeStats(p.id);
        return `<article class="card want-card">
          <div class="want-top">
            <button class="unstyled" data-action="open-place" data-id="${esc(p.id)}">${photoBlock(p, null, 'thumb thumb--lg')}</button>
            <button class="grow unstyled" data-action="open-place" data-id="${esc(p.id)}">
              <b>${esc(p.name)}</b>
              <span class="meta">${placeMeta(p)}</span>
              <span class="meta">${s.circleCount ? `👯 ${s.circleCount} friend${s.circleCount > 1 ? 's' : ''} rated it ${fmt(s.circleAvg)}` : `${s.cityCount} rating${s.cityCount === 1 ? '' : 's'} in Bangalore`} · saved ${timeAgo(addedAt)}</span>
            </button>
          </div>
          <footer class="card-actions">
            <button class="btn btn--primary" data-action="rate" data-id="${esc(p.id)}">✅ Been here — rate it</button>
            <button class="btn" data-action="show-on-map" data-id="${esc(p.id)}">📍</button>
            <button class="btn" data-action="toggle-want" data-id="${esc(p.id)}">Remove</button>
          </footer>
        </article>`;
      }).join('') : empty('🔖', 'Nothing saved yet', 'Tap “Want to try” on any place in your feed, Trending or the map.')}

      ${sectionTitle(`✅ Places you've been (${mine.length})`)}
      ${mine.length ? mine.map(reviewCard).join('') : empty('🍽️', 'No ratings yet', 'Tap “＋ Rate a place” after your next meal out.')}

      <div class="footer-note">
        <p>${Store.info() ? `🗺️ ${Store.placeCount().toLocaleString('en-IN')} Bangalore places, updated ${new Date(Store.info().fetchedAt).toLocaleDateString('en-IN')}. ${esc(Store.info().attribution)}` : '🗺️ Full Bangalore list not loaded — run <code>python scripts/fetch_places.py</code>.'}</p>
        <p>${Maps.googleOn() ? '🟢 Google Maps connected — real photos & search.' : Maps.hasKey() ? '🟠 Google key set but not working — using OpenStreetMap. Check README.md.' : '⚪ Free mode: OpenStreetMap map & search, your own photos.'}</p>
        ${Store.cloud
          ? (Store.signedIn() ? '' : '<p>👤 Not signed in yet.</p>')
          : '<button class="link" data-action="reset-demo">Reset demo data</button>'}
        <p><a href="privacy.html">Privacy Policy</a> · <a href="terms.html">Terms of Service</a></p>
      </div>
      ${accountBox()}`;
  }

  // ---------- routing ----------
  function render(resetScroll) {
    const [name, arg] = currentRoute();
    const tab = name === 'list' || name === 'area' ? 'trending' : name;
    $$('.tabbar a').forEach(a => a.classList.toggle('active', a.dataset.tab === tab));
    const isMap = name === 'map';
    $('#map-view').hidden = !isMap;
    $('#view').hidden = isMap;
    $('#app').classList.toggle('app--map', isMap);
    if (isMap) { showMap(); return; }
    const views = {
      circle: renderCircle,
      trending: renderTrending,
      saved: renderSaved,
      list: () => renderList(decodeURIComponent(arg || '')),
      area: () => renderArea(decodeURIComponent(arg || '')),
    };
    const y = window.scrollY;
    $('#view').innerHTML = (views[name] || renderCircle)();
    window.scrollTo(0, resetScroll ? 0 : y);
    if (name === 'trending') bindExploreSearch();
    hydratePhotos($('#view'));
  }
  const refresh = () => render(false);

  // ---------- Google photos (lazy, only when a card scrolls into view) ----------
  let photoObserver = null;
  function hydratePhotos(root) {
    if (!Maps.googleOn() || !root) return;
    // Google's free photo allowance is small, so by default only the place page fetches one.
    if (root.id === 'view' && !(window.CIRCLE_CONFIG && CIRCLE_CONFIG.GOOGLE_PHOTOS_IN_LISTS)) return;
    if (!photoObserver) {
      photoObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          const el = entry.target;
          photoObserver.unobserve(el);
          const p = Store.place(el.dataset.gphoto);
          if (!p) return;
          Maps.photoFor(p).then(ph => {
            if (!ph || !el.isConnected) return;
            const credit = ph.credit
              ? (ph.creditUri
                ? `<a class="credit" href="${esc(ph.creditUri)}" target="_blank" rel="noopener">📷 ${esc(ph.credit)}</a>`
                : `<span class="credit">📷 ${esc(ph.credit)}</span>`)
              : '';
            el.classList.remove('photo--ph');
            el.innerHTML = `<img src="${esc(ph.url)}" alt="Photo of ${esc(p.name)}" loading="lazy">${el.classList.contains('thumb') ? '' : credit}`;
          });
        });
      }, { rootMargin: '200px' });
    }
    $$('[data-gphoto]', root).forEach(el => {
      if (el.dataset.watched) return;
      el.dataset.watched = '1';
      photoObserver.observe(el);
    });
  }

  // ---------- bottom sheets ----------
  function openSheet(html, onMount) {
    if (sheetCleanup) { sheetCleanup(); sheetCleanup = null; }
    const root = $('#sheet-root');
    root.innerHTML = `<div class="sheet-backdrop" data-action="backdrop">
      <div class="sheet" role="dialog" aria-modal="true">
        <button class="sheet-close" data-action="close-sheet" aria-label="Close">✕</button>
        ${html}
      </div></div>`;
    document.body.classList.add('no-scroll');
    if (onMount) onMount($('.sheet', root));
    hydratePhotos(root);
  }
  function closeSheet() {
    if (sheetCleanup) { sheetCleanup(); sheetCleanup = null; }
    $('#sheet-root').innerHTML = '';
    document.body.classList.remove('no-scroll');
  }

  function openPlace(id) {
    const p = Store.place(id);
    if (!p) return;
    const s = Store.placeStats(id);
    const meId = Store.me().id;
    const rank = r => (r.userId === meId ? 0 : Store.isFriend(r.userId) ? 1 : 2);
    const reviews = Store.reviews().filter(r => r.placeId === id)
      .sort((a, b) => rank(a) - rank(b) || b.createdAt - a.createdAt);
    const withPhoto = reviews.find(r => r.photo);
    const dishes = [...new Set(reviews.map(r => r.dish).filter(Boolean))].slice(0, 4);

    openSheet(`
      ${photoBlock(p, withPhoto && withPhoto.photo)}
      <h2>${esc(p.name)}</h2>
      <div class="meta">${placeMeta(p)}</div>
      ${p.address && p.address !== `${p.area}, Bengaluru` ? `<div class="meta">${esc(p.address)}</div>` : ''}
      ${p.hours ? `<div class="meta">🕒 ${esc(p.hours)}</div>` : ''}
      ${p.phone || p.website ? `<div class="meta">${p.phone ? `📞 <a href="tel:${esc(p.phone.replace(/[^\d+]/g, ''))}">${esc(p.phone)}</a>` : ''}${p.phone && p.website ? ' · ' : ''}${/^https?:\/\//i.test(p.website || '') ? `🌐 <a href="${esc(p.website)}" target="_blank" rel="noopener">Website</a>` : ''}</div>` : ''}
      <div class="score-grid">
        <div class="score-box score-box--circle"><small>Your circle</small><b>${fmt(s.circleAvg)}</b><small>${s.circleCount} friend${s.circleCount === 1 ? '' : 's'}</small></div>
        <div class="score-box"><small>Bangalore</small><b>${fmt(s.cityAvg)}</b><small>${s.cityCount} rating${s.cityCount === 1 ? '' : 's'}</small></div>
        <div class="score-box score-box--me"><small>You</small><b>${fmt(s.myScore)}</b><small>${s.myScore == null ? 'not yet' : BUCKETS[bucketFor(s.myScore)].label}</small></div>
      </div>
      <div class="sheet-actions">
        ${wantBtn(id)}
        <button class="btn btn--primary" data-action="rate" data-id="${esc(id)}">⭐ Rate it</button>
        <button class="btn" data-action="show-on-map" data-id="${esc(id)}">📍 Map</button>
        <a class="btn" href="${esc(Maps.directionsUrl(p))}" target="_blank" rel="noopener">🧭 Directions</a>
      </div>
      ${dishes.length ? `<h3 class="sheet-h">🍴 People order</h3><div class="dish-chips">${dishes.map(d => `<span class="chip">${esc(d)}</span>`).join('')}</div>` : ''}
      <h3 class="sheet-h">What people said</h3>
      ${reviews.length ? reviews.map(r => {
        const u = Store.user(r.userId);
        const tag = r.userId === meId ? '' : Store.isFriend(r.userId) ? '<span class="tag">Circle</span>' : '';
        return `<div class="mini">${avatar(u, true)}
          <div class="grow"><b>${u.isMe ? 'You' : esc(u.name)}</b>${tag} <span class="meta">· ${timeAgo(r.createdAt)}</span>
            ${r.note ? `<p>${esc(r.note)}</p>` : ''}
            ${r.dish ? `<p class="meta">🍴 ${esc(r.dish)}</p>` : ''}
          </div>${scoreChip(r.score)}</div>`;
      }).join('') : '<p class="meta">No ratings yet — be the first.</p>'}`);
  }

  function openManageCircle() {
    const people = Store.users().filter(u => !u.isMe)
      .sort((a, b) => Store.isFriend(b.id) - Store.isFriend(a.id) || Store.reviewCount(b.id) - Store.reviewCount(a.id));
    openSheet(`
      <h2>Your circle</h2>
      ${Store.cloud ? `
        <div class="field"><label for="my-name">Your name</label>
          <div class="inline-form"><input type="text" id="my-name" maxlength="40" value="${esc(Store.me().name)}"><button class="btn" data-action="rename">Save</button></div>
        </div>
        <button class="btn btn--primary btn--block" data-action="invite">💌 Invite friends</button>
        ${accountBox()}` : ''}
      <p class="meta" style="margin-top:14px">People in your circle show up in the Circle feed and the “Your circle” score. Everyone else still counts toward Trending and Top lists.</p>
      ${people.length ? '' : '<p class="meta"><b>Nobody else is on Circle yet</b> — invite your friends!</p>'}
      <div class="people">
        ${people.map(u => {
          const on = Store.isFriend(u.id);
          return `<div class="person">${avatar(u)}
            <div class="grow"><b>${esc(u.name)}</b><div class="meta">${Store.reviewCount(u.id)} ratings</div></div>
            <button class="btn ${on ? 'btn--on' : ''}" data-action="toggle-friend" data-id="${esc(u.id)}">${on ? '✓ In circle' : '＋ Add'}</button>
          </div>`;
        }).join('')}
      </div>`);
  }

  // ---------- rate flow: search -> rate form ----------
  function openRate(placeId) {
    const draft = { placeId: placeId || null, newPlace: null, bucket: null, photo: null };
    openSheet('<div id="rate"></div>', sheet => (placeId ? renderRateForm : renderRateSearch)(sheet, draft));
  }

  function renderRateSearch(sheet, draft) {
    const box = $('#rate', sheet);
    box.innerHTML = `
      <h2>Rate a place</h2>
      <p class="meta">Search any restaurant or café in Bangalore${Maps.googleOn() ? '' : ' (results from OpenStreetMap)'}.</p>
      <div class="field"><input type="search" id="q" placeholder="e.g. Meghana Foods, Toit, CTR…" autocomplete="off" enterkeyhint="search"></div>
      <ul class="results" id="results"></ul>
      <button class="btn btn--block btn--dashed" id="add-manual">🤷 Can't find it? Add it yourself</button>`;
    const input = $('#q', box);
    const list = $('#results', box);
    let timer = null, seq = 0, results = [];
    input.focus();
    $('#add-manual', box).addEventListener('click', () => renderManualAdd(sheet, draft, input.value.trim()));

    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 300); });
    async function run() {
      const term = input.value.trim();
      const mySeq = ++seq;
      if (term.length < 2) { list.innerHTML = ''; return; }
      list.innerHTML = '<li class="meta">Searching…</li>';
      const found = await Maps.search(term);
      if (mySeq !== seq) return; // a newer search is already running
      results = found;
      const label = { local: 'On Circle', google: 'Google', osm: 'Map' };
      list.innerHTML = found.length
        ? found.map((r, i) => `<li><button class="result" data-i="${i}"><span class="src src--${r.source}">${label[r.source]}</span><span class="grow"><b>${esc(r.name)}</b><small class="meta">${esc(r.secondary)}</small></span></button></li>`).join('')
        : '<li class="meta">No places found. Try a different spelling.</li>';
    }

    list.addEventListener('click', async e => {
      const btn = e.target.closest('.result');
      if (!btn) return;
      const r = results[+btn.dataset.i];
      btn.disabled = true;
      try {
        if (r.source === 'local') {
          draft.placeId = r.id;
        } else {
          const data = await Maps.resolve(r);
          const existing = Store.findPlace(data);
          if (existing) draft.placeId = existing.id; else draft.newPlace = data;
        }
        renderRateForm(sheet, draft);
      } catch (err) {
        console.error(err);
        toast('Could not load that place. Try again.');
        btn.disabled = false;
      }
    });
  }

  // For places that aren't on any map yet: a darshini, a chaat cart, a new café.
  function renderManualAdd(sheet, draft, prefillName) {
    const box = $('#rate', sheet);
    box.innerHTML = `
      <button class="back unstyled" id="back-search">← Back to search</button>
      <h2>Add a new place</h2>
      <p class="meta">For spots that aren't on the map yet — your local darshini, a chaat cart, a new café.</p>
      <div class="field"><label for="m-name">Name</label><input type="text" id="m-name" maxlength="80" value="${esc(prefillName)}" placeholder="e.g. Rameshwaram Cafe"></div>
      <div class="two">
        <div class="field"><label for="m-area">Area</label><input type="text" id="m-area" list="m-areas" placeholder="e.g. Koramangala">
          <datalist id="m-areas">${Store.allAreas().slice(0, 400).map(a => `<option value="${esc(a)}">`).join('')}</datalist></div>
        <div class="field"><label for="m-cuisine">Cuisine</label><input type="text" id="m-cuisine" list="m-cuisines" placeholder="e.g. South Indian">
          <datalist id="m-cuisines">${COMMON_CUISINES.map(c => `<option value="${esc(c)}">`).join('')}</datalist></div>
      </div>
      <label class="check"><input type="checkbox" id="m-veg"> Pure veg place</label>
      <div class="field">
        <label>Where is it? <span class="hint">tap the map to drop the pin</span></label>
        <div id="m-map" class="mini-map"></div>
        <button class="btn" id="m-locate" type="button">📍 I'm here right now</button>
      </div>
      <button class="btn btn--primary btn--block" id="m-next">Next: rate it →</button>`;

    const mini = L.map($('#m-map', box), { zoomControl: true }).setView([CITY.lat, CITY.lng], 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(mini);
    const pin = L.marker([CITY.lat, CITY.lng], { draggable: true, opacity: 0.5 }).addTo(mini);
    let pinned = false;
    sheetCleanup = () => mini.remove();
    setTimeout(() => mini.invalidateSize(), 250); // the sheet slides in, so size the map after

    function setPin(lat, lng, zoom) {
      pin.setLatLng([lat, lng]).setOpacity(1);
      pinned = true;
      if (zoom) mini.setView([lat, lng], zoom);
      // Suggest the area from the nearest known place.
      const areaInput = $('#m-area', box);
      if (!areaInput.value) {
        let best = null, bestKm = 1.5;
        Store.places().forEach(p => {
          const d = Math.hypot((p.lat - lat) * 111, (p.lng - lng) * 109);
          if (d < bestKm && p.area !== 'Bangalore') { best = p; bestKm = d; }
        });
        if (best) areaInput.value = best.area;
      }
    }
    mini.on('click', e => setPin(e.latlng.lat, e.latlng.lng));
    pin.on('dragend', () => { const ll = pin.getLatLng(); setPin(ll.lat, ll.lng); });
    $('#m-locate', box).addEventListener('click', () => {
      if (!navigator.geolocation) { toast('Your browser can’t share location'); return; }
      navigator.geolocation.getCurrentPosition(
        pos => setPin(pos.coords.latitude, pos.coords.longitude, 17),
        () => toast('Location is blocked — tap the map instead'),
        { enableHighAccuracy: true, timeout: 8000 });
    });
    $('#back-search', box).addEventListener('click', () => {
      if (sheetCleanup) { sheetCleanup(); sheetCleanup = null; }
      renderRateSearch(sheet, draft);
    });
    $('#m-next', box).addEventListener('click', () => {
      const name = $('#m-name', box).value.trim();
      const area = $('#m-area', box).value.trim();
      if (!name) { toast('Give the place a name'); return; }
      if (!pinned) { toast('Tap the map to show where it is'); return; }
      if (!area) { toast('Which area is it in?'); return; }
      const ll = pin.getLatLng();
      const data = {
        name, area, lat: ll.lat, lng: ll.lng,
        cuisine: $('#m-cuisine', box).value.trim() || 'Restaurant',
        veg: $('#m-veg', box).checked, address: '', addedBy: Store.me().id,
      };
      const existing = Store.findPlace(data);
      if (existing) toast(`${existing.name} is already on Circle — rating that one`);
      if (sheetCleanup) { sheetCleanup(); sheetCleanup = null; }
      if (existing) draft.placeId = existing.id; else draft.newPlace = data;
      renderRateForm(sheet, draft);
    });
  }

  function renderRateForm(sheet, draft) {
    const isNew = !draft.placeId;
    const p = isNew ? draft.newPlace : Store.place(draft.placeId);
    const box = $('#rate', sheet);
    box.innerHTML = `
      <h2>${esc(p.name)}</h2>
      ${isNew ? `
        <p class="meta">New to Circle — check these so it lands in the right Top lists.</p>
        <div class="two">
          <div class="field"><label for="area">Area</label><input type="text" id="area" list="area-list" value="${esc(p.area)}">
            <datalist id="area-list">${Store.allAreas().slice(0, 400).map(a => `<option value="${esc(a)}">`).join('')}</datalist></div>
          <div class="field"><label for="cuisine">Cuisine</label><input type="text" id="cuisine" value="${esc(p.cuisine)}"></div>
        </div>
        <label class="check"><input type="checkbox" id="veg" ${p.veg ? 'checked' : ''}> Pure veg place</label>`
        : `<p class="meta">${placeMeta(p)}</p>`}
      <div class="field"><label>How was it?</label>
        <div class="bucket-picker">${Object.entries(BUCKETS).map(([k, b]) => `<button type="button" class="bucket-opt bucket-opt--${k}" data-bucket="${k}"><span>${b.emoji}</span>${b.label}</button>`).join('')}</div>
      </div>
      <div class="field" id="score-field" hidden>
        <label for="score">Score <output id="score-out" class="score"></output></label>
        <input type="range" id="score" step="0.1">
      </div>
      <div class="field"><label for="dish">What should people order?</label>
        <input type="text" id="dish" maxlength="60" placeholder="${esc((p.dishes && p.dishes[0]) || 'e.g. Masala dosa')}"></div>
      <div class="field"><label for="note">Your honest take</label>
        <textarea id="note" maxlength="280" placeholder="No sponsored fluff. What was it actually like?"></textarea></div>
      <div class="field">
        <label class="photo-pick">📷 <span id="photo-label">Add a photo</span><input type="file" id="photo" accept="image/*"></label>
        <img id="preview" class="preview" alt="" hidden>
      </div>
      <button class="btn btn--primary btn--block" id="post" disabled>Pick how it was ↑</button>`;

    const range = $('#score', box);
    const out = $('#score-out', box);
    const post = $('#post', box);
    const showScore = () => {
      out.textContent = (+range.value).toFixed(1);
      out.className = `score score--${bucketFor(+range.value)}`;
    };

    $$('.bucket-opt', box).forEach(btn => btn.addEventListener('click', () => {
      const b = BUCKETS[btn.dataset.bucket];
      draft.bucket = btn.dataset.bucket;
      $$('.bucket-opt', box).forEach(x => x.classList.toggle('on', x === btn));
      range.min = b.min; range.max = b.max; range.value = b.start;
      $('#score-field', box).hidden = false;
      showScore();
      post.disabled = false;
      post.textContent = 'Post to my circle';
    }));
    range.addEventListener('input', showScore);

    $('#photo', box).addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        draft.photo = await compressImage(file);
        const img = $('#preview', box);
        img.src = draft.photo;
        img.hidden = false;
        $('#photo-label', box).textContent = 'Change photo';
      } catch (err) {
        toast(err.message);
      }
    });

    post.addEventListener('click', async () => {
      let placeId = draft.placeId;
      if (!placeId) {
        const area = $('#area', box).value.trim();
        const cuisine = $('#cuisine', box).value.trim();
        placeId = Store.addPlace({ ...draft.newPlace, area: area || draft.newPlace.area, cuisine: cuisine || draft.newPlace.cuisine, veg: $('#veg', box).checked }).id;
        draft.placeId = placeId; // so a failed post doesn't add the place twice
        draft.newPlace = null;
      }
      post.disabled = true;
      post.textContent = draft.photo && Store.cloud ? 'Uploading photo…' : 'Posting…';
      try {
        await Store.addReview({
          placeId,
          bucket: draft.bucket,
          score: Math.round(+range.value * 10) / 10,
          dish: $('#dish', box).value.trim(),
          note: $('#note', box).value.trim(),
          photo: draft.photo,
        });
      } catch (err) {
        console.error(err);
        toast(err.message && !Store.cloud ? err.message : 'Could not post — check your internet and try again.');
        post.disabled = false;
        post.textContent = 'Post to my circle';
        return;
      }
      const wasWanted = Store.isWanted(placeId);
      if (wasWanted) Store.toggleWant(placeId);
      closeSheet();
      toast(wasWanted ? 'Posted! Ticked off your Want to Try ✅' : 'Posted to your circle 🎉');
      if (location.hash === '#/circle') render(true); else location.hash = '#/circle';
    });
  }

  // Shrinks phone photos (often 3–5 MB) to ~100 KB so they fit in browser storage.
  function compressImage(file, maxSide = 900, quality = 0.72) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn't read that image — try a JPG or PNG.")); };
      img.src = url;
    });
  }

  // ---------- map tab ----------
  const MAP_FILTERS = [['all', 'All'], ['circle', '👯 Circle picks'], ['want', '🔖 Want to try'], ['mine', '✅ Been']];

  function mapItems() {
    const f = state.mapFilter;
    return Store.places()
      .filter(p => p.lat != null && p.lng != null)
      .map(p => {
        const s = Store.placeStats(p.id);
        const want = Store.isWanted(p.id);
        const kind = s.myScore != null ? 'mine' : want ? 'want' : s.circleCount ? 'circle' : 'other';
        return { place: p, kind, s, want };
      })
      .filter(it => f === 'all' || (f === 'want' && it.want) || (f === 'circle' && it.s.circleCount) || (f === 'mine' && it.s.myScore != null));
  }

  async function showMap() {
    $('#map-filters').innerHTML = `<div class="chips">${MAP_FILTERS.map(([k, label]) => `<button class="chip ${state.mapFilter === k ? 'on' : ''}" data-action="map-filter" data-filter="${k}">${label}</button>`).join('')}</div>`;
    await Maps.ready();
    if (!mapCtl || mapCtl.provider !== Maps.provider()) {
      if (!mapBuilding) {
        mapBuilding = (async () => {
          if (mapCtl) { mapCtl.destroy(); mapCtl = null; }
          $('#map').innerHTML = '';
          mapCtl = await Maps.createMap($('#map'), { onSelect: openPlace });
        })().finally(() => { mapBuilding = null; });
      }
      await mapBuilding;
    } else {
      mapCtl.resize();
    }
    if (currentRoute()[0] !== 'map') return;
    const focus = state.focusId && Store.place(state.focusId);
    state.focusId = null;
    const items = mapItems();
    mapCtl.setMarkers(items, { fit: !focus });
    if (focus) mapCtl.focus(focus);
    else if (!items.length) toast('Nothing here yet for this filter');
  }

  function locate() {
    if (!navigator.geolocation) { toast('Your browser can’t share location'); return; }
    navigator.geolocation.getCurrentPosition(
      pos => mapCtl && mapCtl.showMe(pos.coords.latitude, pos.coords.longitude),
      () => toast('Location is blocked — allow it in your browser to see what’s near you'),
      { enableHighAccuracy: true, timeout: 8000 });
  }

  // ---------- accounts & invites (cloud mode) ----------
  const INVITE_KEY = 'circle.pendingInvite';
  const OAUTH_KEY = 'circle.oauthPending'; // set just before leaving for Google

  // Runs `next` straight away if signed in (or in demo mode), otherwise asks for a name first.
  function requireAccount(next) {
    if (!Store.cloud || Store.signedIn()) { next(); return; }
    openWelcome(next);
  }

  async function openWelcome(next) {
    const { google } = await Cloud.authSettings();
    const siteKey = (window.CIRCLE_CONFIG && CIRCLE_CONFIG.TURNSTILE_SITE_KEY) || '';
    openSheet(`
      <div class="welcome">
        <span class="welcome-emoji">🍛</span>
        <h2>Welcome to Circle</h2>
        <p class="meta">Real ratings from real friends. No bots, no paid reels.</p>
        ${google ? `
          <button class="btn btn--google btn--block" id="welcome-google"><span class="g-logo">G</span> Continue with Google</button>
          <p class="meta small">Keeps your ratings safe on any phone.</p>
          <div class="divider"><span>or just tell us your name</span></div>` : '<p class="meta">What should your friends call you?</p>'}
        <div class="field"><input type="text" id="welcome-name" maxlength="40" placeholder="Your first name" autocomplete="given-name" enterkeyhint="go"></div>
        ${siteKey ? '<div id="captcha" class="captcha"></div>' : ''}
        <button class="btn ${google ? '' : 'btn--primary'} btn--block" id="welcome-go">Let's eat →</button>
        <p class="meta small">${google ? 'Name-only accounts live on this phone — you can save yours with Google later.' : 'No email or password needed. Your account lives on this phone.'}</p>
        <p class="meta small">By joining you agree to the <a href="terms.html" target="_blank">Terms</a> and <a href="privacy.html" target="_blank">Privacy Policy</a>.</p>
      </div>`, sheet => {
      const input = $('#welcome-name', sheet);
      const go = $('#welcome-go', sheet);
      let captchaToken = null;
      let widget = null;
      if (siteKey) {
        loadTurnstile().then(ts => {
          if (!$('#captcha', sheet)) return;
          widget = ts.render($('#captcha', sheet), {
            sitekey: siteKey,
            callback: token => { captchaToken = token; },
            'expired-callback': () => { captchaToken = null; },
            'error-callback': () => { captchaToken = null; },
          });
        }).catch(() => toast('Could not load the bot check — check your internet.'));
      }
      if (google) {
        $('#welcome-google', sheet).addEventListener('click', async e => {
          e.currentTarget.disabled = true;
          try { sessionStorage.setItem(OAUTH_KEY, 'signin'); } catch (err) { /* private mode */ }
          try { await Cloud.signInWithGoogle(); } // leaves the page; start() finishes up on return
          catch (err) { console.error(err); toast('Could not open Google sign-in.'); e.currentTarget.disabled = false; }
        });
      } else {
        input.focus();
      }
      input.addEventListener('keydown', e => { if (e.key === 'Enter') go.click(); });
      go.addEventListener('click', async () => {
        const name = input.value.trim();
        if (!name) { toast('Tell us your name first'); input.focus(); return; }
        if (siteKey && !captchaToken) { toast('Tick the “I am human” check first'); return; }
        go.disabled = true;
        go.textContent = 'Setting you up…';
        try {
          await Store.signUp(name, captchaToken);
          const inviter = await acceptPendingInvite(true);
          closeSheet();
          toast(inviter ? `Welcome, ${name}! You and ${inviter} are in each other's circle 👯` : `Welcome, ${name}! 🎉`);
          refresh();
          if (next) next();
        } catch (err) {
          console.error(err);
          const msg = err.message || '';
          toast(/captcha/i.test(msg) ? 'The bot check failed — please try again.'
            : /anonymous/i.test(msg) ? 'Sign-ups are switched off in Supabase (see README).'
            : 'Could not sign you up — check your internet.');
          captchaToken = null;
          if (widget != null && window.turnstile) window.turnstile.reset(widget); // tokens are single-use
          go.disabled = false;
          go.textContent = "Let's eat →";
        }
      });
    });
  }

  // Cloudflare's bot check, loaded only when someone is signing up.
  let turnstileLoading = null;
  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (!turnstileLoading) {
      turnstileLoading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        s.async = true;
        s.onload = () => resolve(window.turnstile);
        s.onerror = () => { turnstileLoading = null; reject(new Error('Turnstile failed to load')); };
        document.head.appendChild(s);
      });
    }
    return turnstileLoading;
  }

  // "Signed in as…" box with Save-with-Google / Sign out, used on the Want to Try tab and in Manage.
  function accountBox() {
    if (!Store.cloud || !Store.signedIn()) return '';
    const acc = Store.account() || {};
    if (acc.anonymous) {
      return `<div class="account-box account-box--warn">
        <p>👤 <b>${esc(Store.me().name)}</b> — this account only lives on this browser. Clear your browser data or switch phones and it's gone.</p>
        <button class="btn btn--google" data-action="link-google"><span class="g-logo">G</span> Save my account with Google</button>
      </div>`;
    }
    return `<div class="account-box">
      <p>👤 <b>${esc(Store.me().name)}</b> · signed in with Google${acc.email ? ` (${esc(acc.email)})` : ''}</p>
      <button class="link" data-action="sign-out">Sign out</button>
    </div>`;
  }

  async function linkGoogle() {
    const { google } = await Cloud.authSettings();
    if (!google) { toast('Google sign-in isn’t switched on yet.'); return; }
    try { await Cloud.linkGoogle(); } // leaves the page; Google sends them back here
    catch (err) {
      console.error(err);
      toast(/manual linking/i.test(err.message || '') ? 'Turn on “Allow manual linking” in Supabase first (see README).' : 'Could not open Google sign-in.');
    }
  }

  // Google sends people back with ?error_description=… if something went wrong.
  function readAuthErrorFromUrl() {
    const params = new URLSearchParams(location.search);
    const msg = params.get('error_description');
    if (!msg) return;
    removeUrlParams(['error', 'error_code', 'error_description']);
    setTimeout(() => toast(/already linked/i.test(msg)
      ? 'That Google account already has a Circle account — sign out, then “Continue with Google”.'
      : 'Google sign-in didn’t finish: ' + msg), 800);
  }

  async function shareInvite() {
    let link;
    try { link = await Store.inviteLink(); } catch (err) { console.error(err); toast('Could not make an invite link — try again.'); return; }
    const text = `I'm rating Bangalore food spots on Circle — only real friends, no paid reels. Join my circle 👉 ${link}`;
    if (navigator.share) {
      try { await navigator.share({ title: 'Join my Circle', text }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    openSheet(`
      <h2>Invite friends</h2>
      <p class="meta">Anyone who opens this link joins your circle (and you join theirs).</p>
      <div class="field"><input type="text" id="invite-link" value="${esc(link)}" readonly></div>
      <div class="sheet-actions">
        <a class="btn btn--primary" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">💬 Share on WhatsApp</a>
        <button class="btn" id="copy-invite">📋 Copy link</button>
      </div>`, sheet => {
      $('#copy-invite', sheet).addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(link); toast('Link copied'); }
        catch (e) { $('#invite-link', sheet).select(); toast('Press Ctrl+C to copy'); }
      });
    });
  }

  // ?invite=TOKEN in the address: remember it, and accept once the person has an account.
  function readInviteFromUrl() {
    const token = new URLSearchParams(location.search).get('invite');
    if (!token) return;
    try { sessionStorage.setItem(INVITE_KEY, token); } catch (e) { /* private mode */ }
    removeUrlParams(['invite']);
  }
  // Only remove our own params — Supabase needs ?code=… when someone returns from Google.
  function removeUrlParams(names) {
    const params = new URLSearchParams(location.search);
    names.forEach(n => params.delete(n));
    const qs = params.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
  }
  // Returns the inviter's name if an invite was accepted. `quiet`: the caller shows its own message.
  async function acceptPendingInvite(quiet) {
    let token = null;
    try { token = sessionStorage.getItem(INVITE_KEY); } catch (e) { /* private mode */ }
    if (!token || !Store.signedIn()) return null;
    try { sessionStorage.removeItem(INVITE_KEY); } catch (e) { /* private mode */ }
    try {
      const inviter = await Store.acceptInvite(token);
      if (inviter && !quiet) toast(`You and ${inviter} are now in each other's circle 👯`);
      return inviter;
    } catch (err) {
      console.error(err);
      return null;
    }
  }

  function toggleWant(id) {
    const on = Store.toggleWant(id);
    toast(on ? 'Added to Want to Try 🔖' : 'Removed from Want to Try');
    const route = currentRoute()[0];
    if (route === 'saved' || route === 'list' || route === 'area') refresh();
    else $$('.btn--want').filter(b => b.dataset.id === id).forEach(b => { b.outerHTML = wantBtn(id); });
    if (route === 'map') showMap();
  }

  // ---------- one click handler for everything ----------
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const { action, id } = el.dataset;
    switch (action) {
      case 'backdrop': if (e.target === el) closeSheet(); break;
      case 'close-sheet': closeSheet(); break;
      case 'open-place': openPlace(id); break;
      case 'rate': requireAccount(() => openRate(id)); break;
      case 'manage-circle': requireAccount(openManageCircle); break;
      case 'invite': requireAccount(shareInvite); break;
      case 'link-google':
        try { sessionStorage.setItem(OAUTH_KEY, 'link'); } catch (e) { /* private mode */ }
        linkGoogle();
        break;
      case 'sign-out':
        if (confirm('Sign out of Circle on this browser?')) {
          Cloud.signOut().finally(() => location.reload());
        }
        break;
      case 'rename': {
        const name = $('#my-name').value.trim();
        if (!name) { toast('Name can’t be empty'); break; }
        Store.rename(name).then(() => { toast('Name saved'); refresh(); }).catch(() => toast('Could not save your name'));
        break;
      }
      case 'toggle-friend':
        toast(Store.toggleFriend(id) ? 'Added to your circle 👯' : 'Removed from your circle');
        openManageCircle();
        refresh();
        break;
      case 'toggle-want': requireAccount(() => toggleWant(id)); break;
      case 'show-on-map':
        closeSheet();
        state.focusId = id;
        if (currentRoute()[0] === 'map') showMap(); else location.hash = '#/map';
        break;
      case 'set-area': state.trendingArea = el.dataset.area; refresh(); break;
      case 'more-area': state.areaLimit += 60; refresh(); break;
      case 'map-filter': state.mapFilter = el.dataset.filter; showMap(); break;
      case 'locate': locate(); break;
      case 'reset-demo':
        if (confirm('Reset all demo data? Your ratings and saved places will be cleared.')) {
          Store.reset();
          render(true);
          toast('Demo data reset');
        }
        break;
    }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

  // ---------- start ----------
  Store.onError((msg, err) => { console.error(msg, err); toast(msg + ' — check your internet.'); refresh(); });
  Maps.onAuthFail(() => {
    toast('Google rejected the API key — switched to OpenStreetMap.');
    if (currentRoute()[0] === 'map') showMap();
  });
  window.addEventListener('hashchange', () => { closeSheet(); state.areaLimit = 60; render(true); });
  readInviteFromUrl();
  readAuthErrorFromUrl();

  // The full Bangalore list (made by scripts/fetch_places.py) loads in parallel.
  fetch('data/bangalore-places.json')
    .then(res => (res.ok ? res.json() : Promise.reject(new Error('HTTP ' + res.status))))
    .then(json => {
      if (!Store.loadBase(json)) return; // our own data isn't loaded yet; Store.load() applies it
      if (!$('#sheet-root').innerHTML) refresh();
    })
    .catch(err => console.warn('Bangalore place list not loaded:', err.message));

  let lastLoad = 0;
  async function start() {
    $('#view').innerHTML = '<div class="loading">🍛 Loading Bangalore…</div>';
    try {
      await Store.load();
    } catch (err) {
      console.error(err);
      const notSetUp = err && (err.code === 'PGRST205' || err.code === '42P01');
      $('#view').innerHTML = empty('⚠️', notSetUp ? 'Database not set up yet' : 'Could not reach Circle',
        notSetUp ? 'Run <code>supabase/schema.sql</code> in the Supabase SQL Editor (see README), then reload.'
                 : 'Check your internet connection and reload the page.');
      return;
    }
    lastLoad = Date.now();
    render(true);
    // Back from Google?
    let oauth = null;
    try { oauth = sessionStorage.getItem(OAUTH_KEY); sessionStorage.removeItem(OAUTH_KEY); } catch (e) { /* private mode */ }
    if (oauth && Store.signedIn() && !(Store.account() || {}).anonymous) {
      toast(oauth === 'link' ? 'Account saved with Google ✅ Your ratings are safe on any phone.' : `Signed in as ${Store.me().name} 🎉`);
    }
    await acceptPendingInvite();
    if (Store.cloud && !Store.signedIn()) {
      let pendingInvite = null;
      try { pendingInvite = sessionStorage.getItem(INVITE_KEY); } catch (e) { /* private mode */ }
      if (pendingInvite) openWelcome(); // came from a friend's link: get them in straight away
    }
  }
  start();

  // Pick up friends' new ratings when you come back to the app.
  document.addEventListener('visibilitychange', async () => {
    if (!Store.cloud || document.hidden || Date.now() - lastLoad < 60000 || $('#sheet-root').innerHTML) return;
    try { await Store.load(); lastLoad = Date.now(); refresh(); } catch (e) { /* offline: keep what we have */ }
  });

  Maps.ready().then(ok => {
    if (!ok) return;
    hydratePhotos($('#view'));
    if (currentRoute()[0] === 'saved') refresh(); // updates the "Google connected" note
  });
})();
