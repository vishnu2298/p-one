// Client for the Python insights service (moderation + price guidance).
// The API never depends on it: every call degrades to a safe local fallback.
const config = require('./config');
const local = require('./moderation');

async function call(path, body, fallback) {
  try {
    const res = await fetch(config.insightsUrl + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return fallback;
    return await res.json();
  } catch {
    return fallback;
  }
}

// Local prohibited-item rules always apply; the Python service adds scam/fraud detection on top.
async function moderate(text) {
  const mine = local.check(text);
  if (!mine.allowed) return mine;
  return call('/moderate', { text }, { allowed: true, flags: [], source: 'fallback' });
}
const priceHint = (payload) => call('/price-hint', payload, { available: false, source: 'fallback' });

module.exports = { moderate, priceHint };
