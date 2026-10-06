# Circle 🍛

Eat where your real friends eat. A phone-first web app for Bangalore: no bots, no paid reels.

Plain HTML + CSS + JavaScript, **100% free to run**: there are no paid APIs and no credit card needed. There's no build step; Python serves the files.

**Live at https://circle-blr.netlify.app** (hosted free on Netlify).

## Run it on your computer

```bash
python -m http.server 5173
```

Then open http://localhost:5173.

## Update the live site

```bash
python scripts/build_site.py
```

That creates `site.zip`. In Netlify, open **circle-blr → Deploys** and drop `site.zip` into the "Drag and drop" box. The live site updates in about 30 seconds. (Once the project is on GitHub and connected to Netlify, this happens automatically.)

## Features

| # | Feature | Where |
|---|---------|-------|
| 1 | **All of Bangalore**: about 17,500 restaurants, cafés, bakeries, bars, sweet shops and food stalls across 134 areas | Everywhere |
| 2 | **Circle feed**: ratings from your friends only, newest first | 👯 Circle tab |
| 3 | **Manage your circle**: add or remove people | Circle tab → ＋ Manage |
| 4 | **Search the whole city**: any place by name, or an area ("Koramangala" → all 1,000+ places there) | 🔥 Trending tab, top |
| 5 | **Trending by area**: hottest places in the last 14 days | Trending tab |
| 6 | **Top lists**: "Top 10 Koramangala", "Best South Indian in Bangalore", "Your circle's top 10", each showing "You've been to X of N" | Trending tab → 🏆 |
| 7 | **Area pages**: every place in an area, rated ones first | Trending → "See all places in…" |
| 8 | **Map view**: every place as a dot; your Been / Want to try / Circle picks as big pins | 🗺️ Map tab |
| 9 | **Want to Try list**: save places, and they come off the list automatically once you rate them | 🔖 Want to Try tab |
| 10 | **Rate a place**: Loved it / Fine / Nope, a score, the dish to order, your take and a photo | ＋ Rate a place |
| 11 | **Add a missing place**: name, area, cuisine, veg, and a pin on the map | ＋ Rate a place → "Can't find it?" |
| 12 | **Place page**: circle vs. Bangalore vs. your score, phone, website, dishes, reviews, directions | Tap any place |

## The Bangalore restaurant list (free)

`data/bangalore-places.json` comes from **[Overture Maps](https://overturemaps.org)**, a free open dataset of places built from Meta, Microsoft, OpenStreetMap and other sources. Its licences (CDLA-Permissive-2.0, CC0, Apache-2.0) let you use it for free, including commercially, as long as you credit it. The credit is shown in the app's Want to Try tab footer; keep it there.

### Automatic updates

Once this project is on GitHub, `.github/workflows/refresh-places.yml` runs **every morning at 6 AM IST** for free. If Overture has published a new release, it rebuilds the list and commits it. Overture publishes about once a month, so most mornings it just says "no new release". New places added by people in the app show up straight away and don't wait for this.

To refresh by hand:

```bash
python -m pip install --user duckdb
```

```bash
python scripts/fetch_places.py
```

It does nothing if you already have the latest release. Add `--force` to rebuild anyway, for example after editing `scripts/areas.py`. Ratings and saved places are never lost: when you rate or save a place, the app keeps its own copy of it.

### How areas are worked out (`scripts/areas.py`)

1. **From the address or name.** About 6,800 places name their area ("…Gandhi Bazaar Main Rd, Basavanagudi", "Koramangala Social"). `areas.py` holds a list of about 60 Bangalore areas and the spellings people use for them (Kormangala, J P Nagar, HAL 2nd Stage…). Add any spellings that are missing there.
2. **From neighbours.** The other ~10,000 places take the area most of their nearest address-labelled neighbours have, so borders come from real addresses.
3. **Accuracy:** when tested on places whose area is known, the neighbour method is right **85%** of the time, compared with 59% for plain map boundaries. Misses are almost always the next-door area, for example on the BTM–Koramangala border.

**Good to know:**
- No list is complete. Tiny darshinis and carts are often missing, which is why the "Can't find it? Add it yourself" option exists.
- A few listings have their pin in the wrong place in the source data. Their dot on the map will be wrong too.

## Google photos (optional)

Real restaurant photos come from Google. Google **requires a billing account with a card**, but includes a monthly free allowance of roughly 1,000 photo lookups. To use it without ever being charged:

1. At https://console.cloud.google.com, create a project and turn on billing. Under **APIs & Services → Library**, enable **Maps JavaScript API** and **Places API (New)**. Then go to **Credentials → Create credentials → API key**.
2. In Google Cloud go to **APIs & Services → Places API (New) → Quotas** and cap the requests per day (for example 30) so you can't go over the free amount. Also add a ₹0 **budget alert**.
3. Restrict the key to your website address(es).
4. Paste it into `js/config.js`.

By default only the place page loads a Google photo. That keeps you inside the free allowance much longer. `GOOGLE_PHOTOS_IN_LISTS: true` shows photos on every card, but uses the allowance up quickly. Photos people upload with their ratings are always free and always shown first.

## Shared database (Supabase, free plan)

Ratings, photos, Want to Try lists and circles are stored in Supabase, so everyone sees everyone's ratings.

- **Project settings:** `SUPABASE_URL` and `SUPABASE_KEY` (the publishable key) in `js/config.js`. Never put the secret / service_role key there.
- **Database setup:** `supabase/schema.sql`, run once in the Supabase SQL Editor. It creates the tables, photo storage and security rules: anyone can read ratings, but only you can change your own, and your Want to Try list is private. Later fixes go in `supabase/fix-*.sql`.
- **Sign-up:** people type just their name, using Supabase "anonymous sign-ins" (Authentication → Sign In / Providers). That account lives in one browser; clearing browser data loses it. *Next step: "Sign in with Google" so accounts are permanent and work across devices.*
- **Invites:** 💌 Invite creates a link. Whoever opens it joins your circle and you join theirs.
- **Before sharing widely:** turn on CAPTCHA for sign-ups (Authentication → Attack Protection) to stop bots creating accounts.

Leave `SUPABASE_URL` empty to run the offline demo instead, with made-up people saved only in your browser.

## Files

```
index.html                 page shell, tab bar
css/styles.css             all styling
js/config.js               Supabase project, city settings (+ optional Google key)
js/cloud.js                talks to Supabase: sign-up, ratings, photos, circles, invites
js/seed.js                 demo people and ratings (offline demo mode only)
supabase/schema.sql        database setup (run once in Supabase)
js/store.js                data: places, reviews, friends, want-to-try, trending, top lists
js/maps.js                 map, place search, directions
js/app.js                  screens and interactions
data/bangalore-places.json all Bangalore food places (generated)
scripts/fetch_places.py    rebuilds the JSON from Overture Maps
scripts/areas.py           works out each place's area
.github/workflows/         daily automatic refresh (runs on GitHub)
```
