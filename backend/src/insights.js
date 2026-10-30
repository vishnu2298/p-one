// Client for the Python insights service (moderation + price guidance).
// The API never depends on it: every call degrades to a safe local fallback.
const config = require('./config');

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

const moderate = (text) => call('/moderate', { text }, { allowed: true, flags: [], source: 'fallback' });
const priceHint = (payload) => call('/price-hint', payload, { available: false, source: 'fallback' });

module.exports = { moderate, priceHint };
