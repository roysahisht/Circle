// Talks to Supabase (shared database, logins, photo storage).
// Store uses this when SUPABASE_URL is set in config.js; otherwise the app runs in demo mode.
window.Cloud = (function () {
  const cfg = window.CIRCLE_CONFIG || {};
  const enabled = !!(cfg.SUPABASE_URL && cfg.SUPABASE_KEY && window.supabase);
  // PKCE: Google sends people back with ?code=… (not #tokens, which would clash with our #/routes)
  const sb = enabled ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY, { auth: { flowType: 'pkce' } }) : null;
  const PHOTO_BUCKET = 'review-photos';
  const COLORS = ['#FFE66D', '#C9F1FF', '#FFD6E7', '#C8F7DC', '#E4D9FF', '#FFE0B8', '#D9F99D', '#FECACA', '#BAE6FD', '#F5D0FE'];

  function check({ data, error }) {
    if (error) throw error;
    return data;
  }
  // Same person always gets the same avatar colour.
  function colorFor(id) {
    let h = 0;
    for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return COLORS[h % COLORS.length];
  }

  // ---------- auth ----------
  async function currentUser() {
    const { data } = await sb.auth.getSession();
    return data.session ? data.session.user : null;
  }
  // No email or password: an account tied to this browser. Can be linked to Google later.
  // captchaToken: from Cloudflare Turnstile, required once CAPTCHA is switched on in Supabase.
  async function signUpAnonymously(name, captchaToken) {
    const options = { data: { full_name: name } };
    if (captchaToken) options.captchaToken = captchaToken;
    const data = check(await sb.auth.signInAnonymously({ options }));
    return data.user;
  }

  // Which sign-in methods are switched on in the Supabase dashboard (so the app can show
  // the Google button only once it's set up).
  let providers = null;
  async function authSettings() {
    if (providers) return providers;
    try {
      const res = await fetch(`${cfg.SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: cfg.SUPABASE_KEY } });
      const s = await res.json();
      const ext = s.external || {};
      providers = { google: !!ext.google, anonymous: !!ext.anonymous_users };
    } catch (e) {
      providers = { google: false, anonymous: true };
    }
    return providers;
  }

  // Both leave the page for Google and come back to the same address.
  const backHere = () => location.origin + location.pathname;
  async function signInWithGoogle() {
    check(await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: backHere() } }));
  }
  // Turns a name-only account into a Google account, keeping all its ratings.
  async function linkGoogle() {
    check(await sb.auth.linkIdentity({ provider: 'google', options: { redirectTo: backHere() } }));
  }
  async function signOut() {
    check(await sb.auth.signOut());
  }
  async function updateName(userId, name) {
    check(await sb.from('profiles').update({ display_name: name }).eq('id', userId));
  }

  // ---------- reading ----------
  // Early on everything fits in one load. Once there are tens of thousands of ratings this
  // should page by area/date instead.
  async function loadAll(userId) {
    const [profiles, places, reviews, follows, want] = await Promise.all([
      sb.from('profiles').select('id, display_name, avatar_url').limit(5000).then(check),
      sb.from('places').select('*').limit(20000).then(check),
      sb.from('reviews').select('*').order('created_at', { ascending: false }).limit(10000).then(check),
      userId ? sb.from('follows').select('followee_id').eq('follower_id', userId).then(check) : [],
      userId ? sb.from('want_to_try').select('place_id, created_at').order('created_at', { ascending: false }).then(check) : [],
    ]);
    return {
      users: profiles.map(p => ({ id: p.id, name: p.display_name, avatar: p.avatar_url, color: colorFor(p.id), isMe: p.id === userId })),
      places: places.map(p => ({
        id: p.id, name: p.name, area: p.area, cuisine: p.cuisine, veg: p.veg, lat: p.lat, lng: p.lng,
        address: p.address, phone: p.phone, website: p.website, googleId: p.google_place_id,
        osmId: p.source === 'overture' ? p.id : null, addedBy: p.added_by, price: null, dishes: [], hours: '',
      })),
      reviews: reviews.map(fromReviewRow),
      friendIds: follows.map(f => f.followee_id),
      want: want.map(w => ({ placeId: w.place_id, addedAt: Date.parse(w.created_at) })),
    };
  }
  function fromReviewRow(r) {
    return {
      id: r.id, userId: r.user_id, placeId: r.place_id, bucket: r.bucket, score: Number(r.score),
      dish: r.dish || '', note: r.note || '', photo: r.photo_url || null, createdAt: Date.parse(r.created_at),
    };
  }

  // ---------- writing ----------
  // Places only get stored once someone rates or saves them. "Do nothing if it exists" so two
  // people rating the same restaurant don't clash.
  async function ensurePlace(p) {
    const row = {
      id: p.id, name: p.name, area: p.area || 'Bangalore', cuisine: p.cuisine || 'Restaurant', veg: !!p.veg,
      lat: p.lat, lng: p.lng, address: p.address || '', phone: p.phone || '', website: p.website || '',
      google_place_id: p.googleId || null, source: p.id.startsWith('ov-') ? 'overture' : 'user',
    };
    check(await sb.from('places').upsert(row, { onConflict: 'id', ignoreDuplicates: true }));
  }

  async function uploadPhoto(userId, dataUrl) {
    const blob = await (await fetch(dataUrl)).blob();
    const path = `${userId}/${crypto.randomUUID()}.jpg`;
    check(await sb.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false }));
    return sb.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
  }

  async function insertReview(r) {
    const row = check(await sb.from('reviews').insert({
      place_id: r.placeId, bucket: r.bucket, score: r.score, dish: r.dish || null, note: r.note || null, photo_url: r.photo || null,
    }).select().single());
    return fromReviewRow(row);
  }

  async function setWant(placeId, on) {
    if (on) check(await sb.from('want_to_try').upsert({ place_id: placeId }, { onConflict: 'user_id,place_id', ignoreDuplicates: true }));
    else check(await sb.from('want_to_try').delete().eq('place_id', placeId));
  }

  async function setFollow(userId, otherId, on) {
    if (on) check(await sb.from('follows').upsert({ followee_id: otherId }, { onConflict: 'follower_id,followee_id', ignoreDuplicates: true }));
    else check(await sb.from('follows').delete().eq('follower_id', userId).eq('followee_id', otherId));
  }

  // ---------- invites ----------
  async function inviteToken(userId) {
    const existing = check(await sb.from('invites').select('token').eq('inviter_id', userId).maybeSingle());
    if (existing) return existing.token;
    return check(await sb.from('invites').insert({}).select('token').single()).token;
  }
  // Returns the inviter's name, or null if the link was invalid / your own.
  async function acceptInvite(token) {
    return check(await sb.rpc('accept_invite', { invite_token: token }));
  }

  return {
    enabled, currentUser, signUpAnonymously, authSettings, signInWithGoogle, linkGoogle, signOut,
    updateName, loadAll, ensurePlace, uploadPhoto, insertReview, setWant, setFollow, inviteToken,
    acceptInvite, colorFor,
  };
})();
