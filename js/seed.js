// Demo data so the app feels alive before real users join.
// Restaurants are real Bangalore spots (coordinates are approximate — with a Google key
// they get corrected automatically). People and their ratings are made up.
window.Seed = (function () {
  const USERS = [
    { id: 'me', name: 'You', color: '#FFE66D', isMe: true },
    // your circle
    { id: 'u-aarav', name: 'Aarav', color: '#C9F1FF' },
    { id: 'u-diya', name: 'Diya', color: '#FFD6E7' },
    { id: 'u-kabir', name: 'Kabir', color: '#C8F7DC' },
    { id: 'u-meera', name: 'Meera', color: '#E4D9FF' },
    { id: 'u-rohan', name: 'Rohan', color: '#FFE0B8' },
    // other people in Bangalore
    { id: 'u-ananya', name: 'Ananya', color: '#D9F99D' },
    { id: 'u-vikram', name: 'Vikram', color: '#FECACA' },
    { id: 'u-sneha', name: 'Sneha', color: '#BAE6FD' },
    { id: 'u-arjun', name: 'Arjun', color: '#FDE68A' },
    { id: 'u-priya', name: 'Priya', color: '#F5D0FE' },
    { id: 'u-nikhil', name: 'Nikhil', color: '#A7F3D0' },
    { id: 'u-zoya', name: 'Zoya', color: '#FBCFE8' },
  ];
  const FRIENDS = ['u-aarav', 'u-diya', 'u-kabir', 'u-meera', 'u-rohan'];

  // quality = typical score, buzz = lots of recent ratings (shows up in Trending)
  const PLACES = [
    // Koramangala
    { id: 'meghana-koramangala', name: 'Meghana Foods', area: 'Koramangala', cuisine: 'Biryani', price: 700, lat: 12.9346, lng: 77.6140, dishes: ['Boneless Chicken Biryani', 'Andhra Chilli Chicken'], quality: 8.6, buzz: true },
    { id: 'truffles-koramangala', name: 'Truffles', area: 'Koramangala', cuisine: 'Burgers', price: 900, lat: 12.9332, lng: 77.6144, dishes: ['All American Cheese Burger', 'Peri Peri Fries'], quality: 7.6, buzz: true },
    { id: 'black-pearl-koramangala', name: 'The Black Pearl', area: 'Koramangala', cuisine: 'Barbecue', price: 1600, lat: 12.9360, lng: 77.6248, dishes: ['Grill platter', 'Mutton seekh kebab'], quality: 7.0 },
    { id: 'hole-in-the-wall-koramangala', name: 'Hole in the Wall Cafe', area: 'Koramangala', cuisine: 'Breakfast', price: 700, lat: 12.9330, lng: 77.6308, dishes: ['Big breakfast', 'Pancakes'], quality: 7.9 },
    { id: 'third-wave-koramangala', name: 'Third Wave Coffee', area: 'Koramangala', cuisine: 'Café', price: 600, lat: 12.9350, lng: 77.6275, dishes: ['Cold brew', 'Chicken pesto sandwich'], quality: 6.8 },
    // Indiranagar
    { id: 'toit-indiranagar', name: 'Toit', area: 'Indiranagar', cuisine: 'Brewpub', price: 2000, lat: 12.9793, lng: 77.6406, dishes: ['Toit Weiss', 'Pepperoni pizza'], quality: 8.3, buzz: true },
    { id: 'glens-indiranagar', name: "Glen's Bakehouse", area: 'Indiranagar', cuisine: 'Bakery', price: 800, lat: 12.9780, lng: 77.6386, dishes: ['Red velvet cake', 'Chicken lasagne'], quality: 7.3 },
    { id: 'burma-burma-indiranagar', name: 'Burma Burma', area: 'Indiranagar', cuisine: 'Burmese', price: 1600, veg: true, lat: 12.9728, lng: 77.6408, dishes: ['Khow Suey', 'Tea leaf salad'], quality: 8.7 },
    { id: 'chinita-indiranagar', name: 'Chinita Real Mexican Food', area: 'Indiranagar', cuisine: 'Mexican', price: 1200, lat: 12.9787, lng: 77.6392, dishes: ['Tacos al pastor', 'Churros'], quality: 8.0, buzz: true },
    { id: 'sly-granny-indiranagar', name: 'Sly Granny', area: 'Indiranagar', cuisine: 'European', price: 2200, lat: 12.9722, lng: 77.6394, dishes: ['Truffle fries', 'Pork belly'], quality: 7.2 },
    // Church Street / MG Road
    { id: 'koshys-church-street', name: "Koshy's", area: 'Church Street', cuisine: 'Café', price: 900, lat: 12.9757, lng: 77.6041, dishes: ['Fish & chips', 'Appam & stew'], quality: 7.4 },
    { id: 'brik-oven-church-street', name: 'Brik Oven', area: 'Church Street', cuisine: 'Pizza', price: 1200, lat: 12.9751, lng: 77.6052, dishes: ['Margherita', 'Diavola'], quality: 8.1, buzz: true },
    { id: 'nagarjuna-church-street', name: 'Nagarjuna', area: 'Church Street', cuisine: 'Andhra', price: 700, lat: 12.9703, lng: 77.6064, dishes: ['Andhra meals', 'Chicken fry'], quality: 8.2 },
    { id: 'empire-church-street', name: 'Empire Restaurant', area: 'Church Street', cuisine: 'North Indian', price: 600, lat: 12.9752, lng: 77.6045, dishes: ['Ghee rice & kebab', 'Chicken shawarma'], quality: 6.4 },
    // Basavanagudi & around
    { id: 'vidyarthi-bhavan', name: 'Vidyarthi Bhavan', area: 'Basavanagudi', cuisine: 'South Indian', price: 200, veg: true, lat: 12.9452, lng: 77.5713, dishes: ['Masala dosa', 'Kesari bath'], quality: 9.0, buzz: true },
    { id: 'brahmins-coffee-bar', name: "Brahmin's Coffee Bar", area: 'Basavanagudi', cuisine: 'South Indian', price: 150, veg: true, lat: 12.9545, lng: 77.5689, dishes: ['Idli vada', 'Filter coffee'], quality: 8.5 },
    { id: 'mtr-lalbagh', name: 'MTR (Mavalli Tiffin Rooms)', area: 'Lalbagh', cuisine: 'South Indian', price: 400, veg: true, lat: 12.9553, lng: 77.5857, dishes: ['Rava idli', 'Masala dosa'], quality: 8.4 },
    { id: 'corner-house-jayanagar', name: 'Corner House', area: 'Jayanagar', cuisine: 'Desserts', price: 300, veg: true, lat: 12.9293, lng: 77.5835, dishes: ['Death by Chocolate', 'Hot chocolate fudge'], quality: 8.8 },
    // Malleshwaram
    { id: 'ctr-malleshwaram', name: 'CTR (Shri Sagar)', area: 'Malleshwaram', cuisine: 'South Indian', price: 200, veg: true, lat: 13.0004, lng: 77.5697, dishes: ['Benne masala dosa', 'Mangalore bajji'], quality: 9.1, buzz: true },
    { id: 'veena-stores-malleshwaram', name: 'Veena Stores', area: 'Malleshwaram', cuisine: 'South Indian', price: 150, veg: true, lat: 12.9990, lng: 77.5711, dishes: ['Idli', 'Kesari bath'], quality: 8.3 },
    { id: 'halli-mane-malleshwaram', name: 'Halli Mane', area: 'Malleshwaram', cuisine: 'South Indian', price: 300, veg: true, lat: 12.9975, lng: 77.5705, dishes: ['Akki roti', 'Ragi mudde meal'], quality: 7.5 },
  ];

  const NOTES = {
    loved: [
      'Bro this spot slaps. Get the {dish}.',
      'Top 3 in the city for me, no debate.',
      'Came for one dish, stayed for three.',
      'Worth the wait. Go hungry.',
      'The {dish} alone is worth the trip.',
      'Took my parents, they still talk about it.',
    ],
    fine: [
      'Decent, nothing life-changing.',
      "Good for a quick bite, wouldn't cross the city for it.",
      'Hit or miss — the {dish} was the hit.',
      'Solid, but overhyped on reels.',
      'Okay vibes, slow service on a weekend.',
    ],
    nope: [
      'Waited 40 mins for something mid.',
      "Not it. Skip unless you're already nearby.",
      'Was really looking forward to this. Disappointed.',
    ],
  };

  // Small seeded random generator so the demo looks the same every reset.
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const bucketFor = s => (s >= 7 ? 'loved' : s >= 4 ? 'fine' : 'nope');

  function build() {
    const rnd = mulberry32(20261005);
    const now = Date.now();
    const DAY = 864e5;
    const pick = arr => arr[Math.floor(rnd() * arr.length)];
    const others = USERS.filter(u => !u.isMe).map(u => u.id);
    const reviews = [];
    let n = 0;

    PLACES.forEach(p => {
      const count = 3 + Math.floor(rnd() * 5);
      const pool = [...others].sort(() => rnd() - 0.5).slice(0, count);
      pool.forEach(userId => {
        const raw = p.quality + (rnd() * 2.6 - 1.6);
        const score = Math.round(Math.min(10, Math.max(1, raw)) * 10) / 10;
        const bucket = bucketFor(score);
        const ageDays = p.buzz ? rnd() * 9 : rnd() * 45;
        const dish = rnd() < 0.75 ? pick(p.dishes) : '';
        reviews.push({
          id: 'r' + (++n),
          userId,
          placeId: p.id,
          bucket,
          score,
          dish,
          note: pick(NOTES[bucket]).replace('{dish}', dish || p.dishes[0]),
          photo: null,
          createdAt: Math.round(now - ageDays * DAY),
        });
      });
    });

    // A few ratings of your own so "Been" and list progress have something to show.
    [
      ['meghana-koramangala', 8.8, 'Boneless Chicken Biryani', 'The benchmark. Every other biryani gets compared to this.', 3],
      ['vidyarthi-bhavan', 9.2, 'Masala dosa', 'Crispy, buttery, worth the Sunday queue.', 11],
      ['truffles-koramangala', 6.1, 'All American Cheese Burger', 'Good burger, but the hype is doing a lot of work.', 20],
    ].forEach(([placeId, score, dish, note, ageDays]) => {
      reviews.push({ id: 'r' + (++n), userId: 'me', placeId, bucket: bucketFor(score), score, dish, note, photo: null, createdAt: now - ageDays * DAY });
    });

    const places = PLACES.map(({ quality, buzz, ...p }) => ({
      veg: false, googleId: null, osmId: null, address: `${p.area}, Bengaluru`, ...p,
    }));

    return {
      version: 1,
      meId: 'me',
      users: USERS.map(u => ({ ...u })),
      friendIds: [...FRIENDS],
      places,
      reviews,
      want: ['burma-burma-indiranagar', 'toit-indiranagar', 'ctr-malleshwaram']
        .map((placeId, i) => ({ placeId, addedAt: now - i * DAY })),
    };
  }

  return { build };
})();
