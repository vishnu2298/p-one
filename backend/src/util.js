const CITIES = {
  Chennai: [13.0827, 80.2707],
  Bengaluru: [12.9716, 77.5946],
  Mumbai: [19.076, 72.8777],
  Delhi: [28.6139, 77.209],
  Hyderabad: [17.385, 78.4867],
  Pune: [18.5204, 73.8567],
  Coimbatore: [11.0168, 76.9558],
  Madurai: [9.9252, 78.1198],
  Kolkata: [22.5726, 88.3639],
  Kochi: [9.9312, 76.2673],
};

const CATEGORIES = [
  { id: 'electronics', name: 'Electronics', hint: 'Mobiles, laptops, gadgets', icon: 'phone-portrait', color: '#1D4ED8', bg: '#DBEAFE' },
  { id: 'fashion', name: 'Fashion', hint: 'Men, women, kids', icon: 'shirt', color: '#BE185D', bg: '#FCE7F3' },
  { id: 'home', name: 'Home & Living', hint: 'Furniture, decor, kitchen', icon: 'home', color: '#15803D', bg: '#DCFCE7' },
  { id: 'vehicles', name: 'Vehicles', hint: 'Cars, bikes, scooters', icon: 'car', color: '#0E7490', bg: '#CFFAFE' },
  { id: 'services', name: 'Services', hint: 'Home services, repairs', icon: 'construct', color: '#1D4ED8', bg: '#E0E7FF' },
  { id: 'jobs', name: 'Jobs', hint: 'Part-time, full-time', icon: 'briefcase', color: '#B45309', bg: '#FEF3C7' },
  { id: 'realestate', name: 'Real Estate', hint: 'Rent, buy, PG', icon: 'business', color: '#0369A1', bg: '#E0F2FE' },
  { id: 'others', name: 'Others', hint: 'Books, sports, more', icon: 'apps', color: '#7E22CE', bg: '#F3E8FF' },
];
const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

function haversineKm(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some((v) => v == null)) return null;
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.asin(Math.sqrt(a)) * 10) / 10;
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const str = (v, { min = 0, max = 500, name = 'Field' } = {}) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < min) throw new HttpError(400, min === 1 ? `${name} is required` : `${name} must be at least ${min} characters`);
  if (s.length > max) throw new HttpError(400, `${name} is too long`);
  return s;
};

const jitter = (n, amt = 0.04) => n + (Math.random() - 0.5) * amt;

module.exports = { CITIES, CATEGORIES, CATEGORY_IDS, haversineKm, HttpError, str, jitter };
