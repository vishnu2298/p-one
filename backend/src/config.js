const path = require('path');

const config = {
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret-change-me',
  dbFile: process.env.DB_FILE || path.join(__dirname, '..', 'data', 'connectly.db'),
  uploadDir: process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'),
  insightsUrl: process.env.INSIGHTS_URL || 'http://127.0.0.1:5000',
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, ''),
  // Firebase: ID tokens are verified with the project id; push needs a service account.
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID || '',
  firebaseServiceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '',
  // Lets the app run without a Firebase project: phone code is always 123456. Never enable in production.
  firebaseDevMode: process.env.FIREBASE_DEV_MODE === '1',
  searchApiKey: process.env.SEARCHAPI_KEY || '',
  searchApiBase: process.env.SEARCHAPI_BASE || 'https://www.searchapi.io/api/v1/search',
  shoppingCountry: process.env.SHOPPING_COUNTRY || 'in',
  productCacheTtlMs: Number(process.env.PRODUCT_CACHE_HOURS || 12) * 3600 * 1000,
  affiliateNetworks: process.env.AFFILIATE_NETWORKS || '',
  amazonTag: process.env.AMAZON_TAG || '',
  flipkartAffid: process.env.FLIPKART_AFFID || '',
  affiliateSecret: process.env.AFFILIATE_POSTBACK_SECRET || '',
  inviteBaseUrl: (process.env.INVITE_BASE_URL || '').replace(/\/$/, ''),
  androidStoreUrl: process.env.ANDROID_STORE_URL || '',
  iosStoreUrl: process.env.IOS_STORE_URL || '',
  isProd: process.env.NODE_ENV === 'production',
};

if (config.isProd && config.firebaseDevMode) {
  throw new Error('FIREBASE_DEV_MODE must not be enabled in production');
}
if (config.isProd && config.jwtSecret === 'dev-only-secret-change-me') {
  throw new Error('JWT_SECRET must be set in production');
}

module.exports = config;
