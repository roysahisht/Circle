// Circle app settings.
//
// SUPABASE_URL / SUPABASE_KEY: your Supabase project (shared ratings, friends, logins, photos).
//   The publishable key is meant to be public — it's safe in this file. NEVER put the
//   secret / service_role key here. Leave both empty to run in offline demo mode.
//
// TURNSTILE_SITE_KEY: Cloudflare Turnstile "site key" (public) for the bot check on sign-up.
//   Put it here BEFORE switching on CAPTCHA in Supabase, or name-only sign-ups will fail.
//   The Turnstile *secret* key goes only into Supabase, never here.
//
// CF_ANALYTICS_TOKEN: Cloudflare Web Analytics token — free, no cookies. Counts everyone who opens
//   the site, including people who never sign up. Leave empty to switch it off.
//
// HUB: the launch neighbourhoods. They get a card on the Trending tab, always-visible area chips,
//   one combined page (#/hub) and a "hub" view on the map. Remove the HUB line to switch it all off.
//
// "Sign in with Google" needs nothing here — it appears automatically once Google is switched
//   on in Supabase (Authentication -> Sign In / Providers).
//
// GOOGLE_MAPS_API_KEY (optional): adds Google photos, Google search and the Google map.
//   Google requires a billing account with a card, but has a monthly free allowance
//   (roughly 1,000 photo lookups). Set daily quota caps in Google Cloud so it can never bill you.
//   Leave empty to stay 100% free. See README.md -> "Google photos".
//
// GOOGLE_PHOTOS_IN_LISTS: false = only the place page loads a Google photo (stays inside the
//   free allowance much longer). true = every card in the feed and lists loads one.
window.CIRCLE_CONFIG = {
  SUPABASE_URL: 'https://xnxvvgpophchyiaexkad.supabase.co',
  SUPABASE_KEY: 'sb_publishable_2sgzLYWzH0R10CKP6dvc5Q_zZM40blt',
  TURNSTILE_SITE_KEY: '',
  CF_ANALYTICS_TOKEN: '',
  HUB: { name: 'Brookefield hub', areas: ['AECS Layout', 'Kundalahalli', 'Brookefield'] },
  GOOGLE_MAPS_API_KEY: '',
  GOOGLE_PHOTOS_IN_LISTS: false,
  CITY: { name: 'Bangalore', lat: 12.9716, lng: 77.5946 },
};
