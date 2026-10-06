// Maps, place search and photos.
// Uses Google (Maps JavaScript API + Places API New) when a key is set in config.js,
// otherwise free OpenStreetMap: Leaflet for the map and Photon for search.
window.Maps = (function () {
  const CITY = (window.CIRCLE_CONFIG && CIRCLE_CONFIG.CITY) || { lat: 12.9716, lng: 77.5946 };
  const CENTER = { lat: CITY.lat, lng: CITY.lng };
  const KEY = ((window.CIRCLE_CONFIG && CIRCLE_CONFIG.GOOGLE_MAPS_API_KEY) || '').trim();

  let googleState = KEY ? 'idle' : 'off'; // off | idle | loading | ready | failed
  let loadPromise = null;
  let authFailHandler = null;
  let sessionToken = null;
  const photoCache = new Map();

  const googleOn = () => googleState === 'ready';
  const provider = () => (googleOn() ? 'google' : 'leaflet');
  const onAuthFail = fn => { authFailHandler = fn; };

  // ---------- loading Google ----------
  function ready() {
    if (!KEY) return Promise.resolve(false);
    if (loadPromise) return loadPromise;
    googleState = 'loading';
    loadPromise = new Promise(resolve => {
      const timer = setTimeout(() => fail('timeout'), 12000);
      function fail(why) {
        clearTimeout(timer);
        const wasReady = googleState === 'ready';
        googleState = 'failed';
        console.warn('Google Maps unavailable:', why);
        resolve(false);
        if (wasReady && authFailHandler) authFailHandler();
      }
      window.__circleGoogleReady = () => { clearTimeout(timer); googleState = 'ready'; resolve(true); };
      // Google calls this when the key is wrong, restricted, or billing is off.
      window.gm_authFailure = () => fail('key rejected');
      const s = document.createElement('script');
      s.src = 'https://maps.googleapis.com/maps/api/js?' + new URLSearchParams({
        key: KEY, v: 'weekly', loading: 'async', callback: '__circleGoogleReady', region: 'IN', language: 'en',
      });
      s.async = true;
      s.onerror = () => fail('script failed to load');
      document.head.appendChild(s);
    });
    return loadPromise;
  }

  // ---------- map ----------
  const PIN_EMOJI = { mine: '✅', want: '🔖', circle: '👯', other: '🍽️' };
  function pinElement(place, kind) {
    const el = document.createElement('div');
    el.className = `pin pin--${kind}`;
    el.title = place.name;
    el.innerHTML = `<span>${PIN_EMOJI[kind] || '🍽️'}</span>`;
    return el;
  }
  function meElement() {
    const el = document.createElement('div');
    el.className = 'me-dot';
    return el;
  }

  function createMap(el, { onSelect }) {
    return googleOn() ? googleMap(el, onSelect) : Promise.resolve(leafletMap(el, onSelect));
  }

  function leafletMap(el, onSelect) {
    const map = L.map(el, { zoomControl: false }).setView([CENTER.lat, CENTER.lng], 12);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    const layer = L.layerGroup().addTo(map);
    const dots = L.layerGroup().addTo(map);
    const canvas = L.canvas({ padding: 0.5 }); // thousands of plain dots draw fast on one canvas
    let meMarker = null;
    const icon = node => L.divIcon({ className: 'pin-wrap', html: node.outerHTML, iconSize: [34, 34], iconAnchor: [17, 40] });
    // Unrated places: specks when zoomed out over the whole city, proper dots up close.
    const dotStyle = () => {
      const z = map.getZoom();
      return z <= 11 ? { radius: 1.4, weight: 0, fillOpacity: 0.55 }
        : z === 12 ? { radius: 2, weight: 0, fillOpacity: 0.65 }
        : z === 13 ? { radius: 3, weight: 0.5, fillOpacity: 0.8 }
        : z === 14 ? { radius: 4.5, weight: 1, fillOpacity: 0.85 }
        : { radius: 6, weight: 1.5, fillOpacity: 0.9 };
    };
    map.on('zoomend', () => {
      const s = dotStyle();
      dots.eachLayer(d => { d.setRadius(s.radius); d.setStyle({ weight: s.weight, fillOpacity: s.fillOpacity }); });
    });

    return {
      provider: 'leaflet',
      setMarkers(items, { fit } = {}) {
        layer.clearLayers();
        dots.clearLayers();
        const pins = [];
        const s = dotStyle();
        items.forEach(({ place, kind }) => {
          if (kind === 'other') {
            L.circleMarker([place.lat, place.lng], { renderer: canvas, color: '#141414', fillColor: '#FF5A1F', ...s })
              .bindTooltip(place.name, { direction: 'top', offset: [0, -4] })
              .on('click', () => onSelect(place.id))
              .addTo(dots);
            return;
          }
          pins.push(place);
          L.marker([place.lat, place.lng], { icon: icon(pinElement(place, kind)), title: place.name, riseOnHover: true })
            .on('click', () => onSelect(place.id))
            .addTo(layer);
        });
        const fitTo = pins.length ? pins : items.map(i => i.place);
        if (fit && fitTo.length) map.fitBounds(fitTo.map(p => [p.lat, p.lng]), { padding: [50, 50], maxZoom: 15 });
      },
      focus(p) { map.setView([p.lat, p.lng], 16); },
      showMe(lat, lng) {
        if (meMarker) meMarker.remove();
        meMarker = L.marker([lat, lng], { icon: L.divIcon({ className: 'pin-wrap', html: meElement().outerHTML, iconSize: [18, 18] }), zIndexOffset: 1000 }).addTo(map);
        map.setView([lat, lng], 15);
      },
      resize() { requestAnimationFrame(() => map.invalidateSize()); },
      destroy() { map.remove(); },
    };
  }

  async function googleMap(el, onSelect) {
    const { Map: GoogleMap } = await google.maps.importLibrary('maps');
    const { AdvancedMarkerElement } = await google.maps.importLibrary('marker');
    const map = new GoogleMap(el, {
      center: CENTER, zoom: 12, mapId: 'DEMO_MAP_ID',
      disableDefaultUI: true, zoomControl: true, clickableIcons: false, gestureHandling: 'greedy',
      zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_CENTER },
    });
    let markers = [];
    let meMarker = null;

    return {
      provider: 'google',
      setMarkers(items, { fit } = {}) {
        markers.forEach(m => { m.map = null; });
        markers = [];
        const bounds = new google.maps.LatLngBounds();
        // Google markers are heavy, so unrated places are left off the Google map.
        items = items.filter(i => i.kind !== 'other');
        items.forEach(({ place, kind }) => {
          const m = new AdvancedMarkerElement({ map, position: { lat: place.lat, lng: place.lng }, content: pinElement(place, kind), title: place.name });
          m.addListener('click', () => onSelect(place.id));
          markers.push(m);
          bounds.extend({ lat: place.lat, lng: place.lng });
        });
        if (fit && items.length) {
          map.fitBounds(bounds, 50);
          if (items.length === 1) map.setZoom(15);
        }
      },
      focus(p) { map.setCenter({ lat: p.lat, lng: p.lng }); map.setZoom(16); },
      showMe(lat, lng) {
        if (meMarker) meMarker.map = null;
        meMarker = new AdvancedMarkerElement({ map, position: { lat, lng }, content: meElement(), zIndex: 1000 });
        map.setCenter({ lat, lng });
        map.setZoom(15);
      },
      resize() {},
      destroy() { markers.forEach(m => { m.map = null; }); el.innerHTML = ''; },
    };
  }

  // ---------- search ----------
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const cap = s => String(s || '').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());

  // Returns [{ source: 'local'|'google'|'osm', id, name, secondary }]
  async function search(q) {
    const local = Store.searchPlaces(q).map(p => ({ source: 'local', id: p.id, name: p.name, secondary: `${p.area} · ${p.cuisine}` }));
    let remote = [];
    try {
      remote = googleOn() ? await googleSearch(q) : await osmSearch(q);
    } catch (e) {
      console.warn('Place search failed', e);
    }
    const seen = new Set(local.map(l => norm(l.name)));
    const ids = new Set(local.map(l => l.id));
    return [...local, ...remote.filter(r => !seen.has(norm(r.name)) && !(r._data && ids.has(r._data.osmId)))];
  }

  async function googleSearch(q) {
    const { AutocompleteSuggestion, AutocompleteSessionToken } = await google.maps.importLibrary('places');
    if (!sessionToken) sessionToken = new AutocompleteSessionToken();
    const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
      input: q,
      sessionToken,
      locationBias: { center: CENTER, radius: 25000 },
      includedRegionCodes: ['in'],
    });
    return suggestions
      .filter(s => s.placePrediction)
      .slice(0, 8)
      .map(s => {
        const p = s.placePrediction;
        return {
          source: 'google',
          id: p.placeId,
          name: (p.mainText && p.mainText.text) || p.text.text,
          secondary: (p.secondaryText && p.secondaryText.text) || '',
          _prediction: p,
        };
      });
  }

  async function osmSearch(q) {
    const params = new URLSearchParams({ q, limit: '8', lat: CENTER.lat, lon: CENTER.lng, bbox: '77.40,12.80,77.85,13.20' });
    ['amenity:restaurant', 'amenity:cafe', 'amenity:fast_food', 'amenity:bar', 'amenity:pub', 'amenity:ice_cream', 'shop:bakery']
      .forEach(t => params.append('osm_tag', t));
    const res = await fetch('https://photon.komoot.io/api/?' + params);
    if (!res.ok) throw new Error('Photon search failed: ' + res.status);
    const json = await res.json();
    return json.features
      .filter(f => f.properties && f.properties.name)
      .map(f => {
        const pr = f.properties;
        const area = pr.district || pr.locality || pr.suburb || pr.city || 'Bangalore';
        const osmId = `osm-${String(pr.osm_type).toLowerCase()}${pr.osm_id}`; // same format as data/bangalore-places.json
        return {
          source: 'osm',
          id: 'osm:' + osmId,
          name: pr.name,
          secondary: [pr.street, area].filter(Boolean).join(', '),
          _data: {
            name: pr.name,
            address: [pr.housenumber, pr.street, area].filter(Boolean).join(', '),
            lat: f.geometry.coordinates[1],
            lng: f.geometry.coordinates[0],
            area,
            cuisine: cap(pr.osm_value === 'restaurant' ? 'Restaurant' : pr.osm_value),
            osmId,
          },
        };
      });
  }

  // Turns a search result into place data ready for Store.addPlace.
  async function resolve(result) {
    if (result.source === 'osm') return result._data;
    const place = result._prediction.toPlace();
    await place.fetchFields({ fields: ['id', 'displayName', 'formattedAddress', 'location', 'addressComponents', 'primaryTypeDisplayName'] });
    sessionToken = null; // the autocomplete session ends once a place is picked
    return {
      name: place.displayName,
      address: place.formattedAddress || '',
      lat: place.location.lat(),
      lng: place.location.lng(),
      area: areaFrom(place.addressComponents),
      cuisine: String(place.primaryTypeDisplayName || 'Restaurant').replace(/\s*restaurant$/i, '') || 'Restaurant',
      googleId: place.id,
    };
  }

  function areaFrom(components) {
    const order = ['sublocality_level_1', 'sublocality', 'neighborhood', 'locality'];
    for (const type of order) {
      const c = (components || []).find(x => x.types.includes(type));
      if (c) return c.longText === 'Bengaluru' ? 'Bangalore' : c.longText;
    }
    return 'Bangalore';
  }

  // ---------- photos ----------
  // Resolves to { url, credit, creditUri } or null. Photo URLs are kept in memory only
  // (Google's terms don't allow storing them); the place id is saved so we skip the search next time.
  function photoFor(place) {
    if (!googleOn()) return Promise.resolve(null);
    if (photoCache.has(place.id)) return photoCache.get(place.id);
    const job = (async () => {
      try {
        const { Place } = await google.maps.importLibrary('places');
        let gp = null;
        if (place.googleId) {
          gp = new Place({ id: place.googleId });
          await gp.fetchFields({ fields: ['photos'] });
        } else {
          const { places } = await Place.searchByText({
            textQuery: `${place.name}, ${place.area}, Bengaluru`,
            fields: ['id', 'photos', 'location'],
            maxResultCount: 1,
            locationBias: { center: { lat: place.lat, lng: place.lng }, radius: 3000 },
          });
          gp = places && places[0];
          if (gp) Store.setGoogleMatch(place.id, gp.id, gp.location && { lat: gp.location.lat(), lng: gp.location.lng() });
        }
        const photo = gp && gp.photos && gp.photos[0];
        if (!photo) return null;
        const author = photo.authorAttributions && photo.authorAttributions[0];
        return {
          url: photo.getURI({ maxWidth: 800, maxHeight: 600 }),
          credit: (author && author.displayName) || '',
          creditUri: (author && author.uri) || '',
        };
      } catch (e) {
        console.warn('Photo lookup failed for', place.name, e);
        return null;
      }
    })();
    photoCache.set(place.id, job);
    return job;
  }

  function directionsUrl(p) {
    const params = new URLSearchParams({ api: '1', query: `${p.name}, ${p.area}, Bengaluru` });
    if (p.googleId) params.set('query_place_id', p.googleId);
    return 'https://www.google.com/maps/search/?' + params;
  }

  return { ready, googleOn, provider, onAuthFail, hasKey: () => !!KEY, createMap, search, resolve, photoFor, directionsUrl };
})();
