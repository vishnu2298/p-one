const CITY_INFO = {
  'Chennai': [13.0827, 80.2707, 'Tamil Nadu'],
  'Coimbatore': [11.0168, 76.9558, 'Tamil Nadu'],
  'Madurai': [9.9252, 78.1198, 'Tamil Nadu'],
  'Tiruchirappalli': [10.7905, 78.7047, 'Tamil Nadu'],
  'Salem': [11.6643, 78.146, 'Tamil Nadu'],
  'Tirunelveli': [8.7139, 77.7567, 'Tamil Nadu'],
  'Vellore': [12.9165, 79.1325, 'Tamil Nadu'],
  'Bengaluru': [12.9716, 77.5946, 'Karnataka'],
  'Mysuru': [12.2958, 76.6394, 'Karnataka'],
  'Hyderabad': [17.385, 78.4867, 'Telangana'],
  'Visakhapatnam': [17.6868, 83.2185, 'Andhra Pradesh'],
  'Kochi': [9.9312, 76.2673, 'Kerala'],
  'Thiruvananthapuram': [8.5241, 76.9366, 'Kerala'],
  'Mumbai': [19.076, 72.8777, 'Maharashtra'],
  'Pune': [18.5204, 73.8567, 'Maharashtra'],
  'Nagpur': [21.1458, 79.0882, 'Maharashtra'],
  'Delhi': [28.6139, 77.209, 'Delhi'],
  'Noida': [28.5355, 77.391, 'Uttar Pradesh'],
  'Gurugram': [28.4595, 77.0266, 'Haryana'],
  'Lucknow': [26.8467, 80.9462, 'Uttar Pradesh'],
  'Chandigarh': [30.7333, 76.7794, 'Chandigarh'],
  'Jaipur': [26.9124, 75.7873, 'Rajasthan'],
  'Ahmedabad': [23.0225, 72.5714, 'Gujarat'],
  'Surat': [21.1702, 72.8311, 'Gujarat'],
  'Vadodara': [22.3072, 73.1812, 'Gujarat'],
  'Indore': [22.7196, 75.8577, 'Madhya Pradesh'],
  'Bhopal': [23.2599, 77.4126, 'Madhya Pradesh'],
  'Kolkata': [22.5726, 88.3639, 'West Bengal'],
  'Patna': [25.5941, 85.1376, 'Bihar'],
  'Ranchi': [23.3441, 85.3096, 'Jharkhand'],
  'Bhubaneswar': [20.2961, 85.8245, 'Odisha'],
  'Guwahati': [26.1445, 91.7362, 'Assam'],
};
// name -> [lat, lng]
const CITIES = Object.fromEntries(Object.entries(CITY_INFO).map(([k, v]) => [k, [v[0], v[1]]]));
const CITY_LIST = Object.entries(CITY_INFO).map(([name, v]) => ({ name, lat: v[0], lng: v[1], state: v[2] }));

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

module.exports = { CITIES, CITY_LIST, CATEGORIES, CATEGORY_IDS, haversineKm, HttpError, str, jitter };
