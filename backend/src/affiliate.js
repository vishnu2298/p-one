// Affiliate products (SearchAPI Google Shopping) and click/conversion tracking.
const crypto = require('crypto');
const config = require('./config');

const CATEGORY_QUERIES = {
  trending: ['best deals today', 'top rated smartphones', 'smart watch', 'bluetooth earbuds'],
  electronics: ['smartphones', 'laptops', 'bluetooth earbuds', 'smart tv'],
  fashion: ['men sneakers', 'women kurta', 'wrist watches', 'backpacks'],
  home: ['air fryer', 'mixer grinder', 'office chair', 'bed sheets'],
  vehicles: ['bike helmet', 'car vacuum cleaner', 'dash cam', 'bike accessories'],
  services: ['tool kit', 'cordless drill', 'water purifier'],
  others: ['books bestseller', 'yoga mat', 'badminton racket'],
};
const CATEGORY_KEYS = Object.keys(CATEGORY_QUERIES);

const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);

function parsePrice(r) {
  if (typeof r.extracted_price === 'number') return Math.round(r.extracted_price);
  if (typeof r.price === 'number') return Math.round(r.price);
  const n = parseFloat(String(r.price || '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

// Tolerant of field-name differences between SearchAPI response versions.
function normalize(results) {
  const out = [];
  for (const r of results || []) {
    const url = r.link || r.product_link || r.offers_link || r.url;
    const price = parsePrice(r);
    if (!r.title || !price || typeof url !== 'string' || !/^https?:\/\//i.test(url)) continue;
    out.push({
      id: sha(url),
      title: String(r.title).slice(0, 160),
      price,
      priceText: typeof r.price === 'string' ? r.price : null,
      merchant: r.source || r.seller || r.merchant || r.store || '',
      image: r.thumbnail || r.image || '',
      rating: typeof r.rating === 'number' ? r.rating : null,
      reviews: typeof r.reviews === 'number' ? r.reviews : null,
      delivery: r.delivery || r.shipping || '',
      url,
    });
  }
  return out;
}

// Offline sample catalogue so the app works before a SearchAPI key is configured. Never used in production.
const DEMO = [
  ['Samsung Galaxy M35 5G (8GB/128GB)', 17999, 'Amazon.in', 4.3, 12850, 'electronics'],
  ['boAt Airdopes 141 Bluetooth Earbuds', 1099, 'Flipkart', 4.1, 98200, 'electronics'],
  ['Noise ColorFit Pro 5 Smart Watch', 2999, 'Amazon.in', 4.2, 15400, 'electronics'],
  ['HP 15s Laptop, Core i5, 16GB RAM', 48990, 'Amazon.in', 4.4, 3120, 'electronics'],
  ['Puma Men Running Shoes', 2399, 'Myntra', 4.2, 4410, 'fashion'],
  ['Prestige Mixer Grinder 750W', 3599, 'Flipkart', 4.4, 22100, 'home'],
  ['Philips Air Fryer HD9200', 6995, 'Amazon.in', 4.3, 18800, 'home'],
  ['Ergonomic Mesh Office Chair', 5499, 'Amazon.in', 4.0, 7200, 'home'],
  ['Steelbird Full Face Helmet', 1299, 'Amazon.in', 4.2, 9100, 'vehicles'],
  ['Atomic Habits by James Clear', 399, 'Amazon.in', 4.6, 61000, 'others'],
].map(([title, price, merchant, rating, reviews, cat]) => ({
  id: sha('demo:' + title), title, price, priceText: null, merchant, image: '', rating, reviews, delivery: '', category: cat,
  url: `https://www.${merchant.toLowerCase().startsWith('amazon') ? 'amazon.in/s?k=' : merchant.toLowerCase() === 'flipkart' ? 'flipkart.com/search?q=' : 'myntra.com/'}${encodeURIComponent(title)}`,
  demo: true,
}));

function createAffiliate(db, fetchImpl = fetch) {
  const getCache = db.prepare('SELECT payload, fetched_at FROM product_cache WHERE cache_key = ?');
  const putCache = db.prepare('INSERT INTO product_cache (cache_key, payload, fetched_at) VALUES (?,?,?) ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at');
  const putProduct = db.prepare('INSERT INTO affiliate_products (id,title,merchant,price,url,seen_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET price = excluded.price, url = excluded.url, seen_at = excluded.seen_at');
  const inflight = new Map();

  async function fetchLive(q) {
    const u = new URL(config.searchApiBase);
    u.search = new URLSearchParams({ engine: 'google_shopping', q, gl: config.shoppingCountry, hl: 'en', api_key: config.searchApiKey }).toString();
    const res = await fetchImpl(u, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`SearchAPI ${res.status}`);
    return normalize((await res.json()).shopping_results);
  }

  /** Cached search. Serves stale data if the live call fails. */
  async function search(q) {
    const key = `${config.shoppingCountry}|${q.toLowerCase().trim()}`;
    const cached = getCache.get(key);
    const fresh = cached && Date.now() - cached.fetched_at < config.productCacheTtlMs;
    if (fresh) return JSON.parse(cached.payload);
    if (!config.searchApiKey) {
      if (config.isProd) return cached ? JSON.parse(cached.payload) : [];
      const words = q.toLowerCase().split(/\s+/).filter(Boolean);
      return DEMO.filter((p) => !words.length || words.some((w) => p.title.toLowerCase().includes(w) || p.category === w));
    }
    if (!inflight.has(key)) {
      inflight.set(key, fetchLive(q)
        .then((items) => { putCache.run(key, JSON.stringify(items), Date.now()); return items; })
        .catch((e) => { console.error('shopping search failed:', e.message); return cached ? JSON.parse(cached.payload) : []; })
        .finally(() => inflight.delete(key)));
    }
    return inflight.get(key);
  }

  async function feed({ q, category }) {
    let items;
    if (q) items = await search(q);
    else {
      const key = CATEGORY_KEYS.includes(category) ? category : 'trending';
      const queries = CATEGORY_QUERIES[key];
      if (!config.searchApiKey && !config.isProd) items = DEMO.filter((p) => key === 'trending' || p.category === key);
      else {
        // One query per day-slot rotates content without spending credits on every request.
        const pick = queries[Math.floor(Date.now() / 86400000) % queries.length];
        items = await search(pick);
      }
    }
    const now = Date.now();
    for (const p of items) putProduct.run(p.id, p.title, p.merchant, p.price, p.url, now);
    return items.map(({ url, category: _c, ...rest }) => rest); // merchant URLs are never sent to clients
  }

  return { feed, search };
}

/* ---------- Link decoration (affiliate tags + sub ids) ---------- */
function networkRules() {
  const rules = [];
  if (config.affiliateNetworks) {
    try { rules.push(...JSON.parse(config.affiliateNetworks)); } catch { console.error('AFFILIATE_NETWORKS is not valid JSON'); }
  }
  if (config.amazonTag) rules.push({ match: 'amazon.', params: { tag: config.amazonTag }, subParam: 'ascsubtag' });
  if (config.flipkartAffid) rules.push({ match: 'flipkart.com', params: { affid: config.flipkartAffid }, subParam: 'affExtParam1' });
  return rules;
}

/**
 * Applies the first matching rule:
 *   { match: "host substring", params: {k: v}, subParam: "click-id query param" }
 *   { match: "*", template: "https://tracker.example/r?u={url}&sub={click}" }   (deep-link wrappers such as Cuelinks / Skimlinks)
 */
function decorate(destUrl, clickId) {
  const u = new URL(destUrl);
  for (const rule of networkRules()) {
    if (rule.match !== '*' && !u.hostname.includes(rule.match)) continue;
    if (rule.template) {
      return rule.template.replaceAll('{url}', encodeURIComponent(destUrl)).replaceAll('{click}', encodeURIComponent(clickId));
    }
    for (const [k, v] of Object.entries(rule.params || {})) u.searchParams.set(k, v);
    if (rule.subParam) u.searchParams.set(rule.subParam, clickId);
    return u.toString();
  }
  return destUrl;
}

module.exports = { createAffiliate, normalize, decorate, CATEGORY_KEYS };
