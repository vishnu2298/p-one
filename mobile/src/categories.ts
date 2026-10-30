import { Category } from './types';

// Mirrors the API's category list so category visuals work instantly, offline.
export const CATEGORIES: Category[] = [
  { id: 'electronics', name: 'Electronics', hint: 'Mobiles, laptops, gadgets', icon: 'phone-portrait', color: '#1747C6', bg: '#E1EAFD' },
  { id: 'fashion', name: 'Fashion', hint: 'Men, women, kids', icon: 'shirt', color: '#B4165F', bg: '#FCE4F0' },
  { id: 'home', name: 'Home & Living', hint: 'Furniture, decor, kitchen', icon: 'home', color: '#12794A', bg: '#DDF3E7' },
  { id: 'vehicles', name: 'Vehicles', hint: 'Cars, bikes, scooters', icon: 'car', color: '#0A6C85', bg: '#D5F1F8' },
  { id: 'services', name: 'Services', hint: 'Home services, repairs', icon: 'construct', color: '#4F46E5', bg: '#E5E4FD' },
  { id: 'jobs', name: 'Jobs', hint: 'Part-time, full-time', icon: 'briefcase', color: '#9A5B00', bg: '#FDEFC9' },
  { id: 'realestate', name: 'Real Estate', hint: 'Rent, buy, PG', icon: 'business', color: '#0369A1', bg: '#DCEFFB' },
  { id: 'others', name: 'Others', hint: 'Books, sports, more', icon: 'apps', color: '#7E22CE', bg: '#F1E4FC' },
];
export const catById = (id: string) => CATEGORIES.find((c) => c.id === id) || CATEGORIES[CATEGORIES.length - 1];
export const CONDITIONS = ['Like New', 'Good', 'Fair', 'Needs Repair'];
export const CITY_LIST: { name: string; state: string; lat: number; lng: number }[] = [
  { name: 'Chennai', state: 'Tamil Nadu', lat: 13.0827, lng: 80.2707 },
  { name: 'Coimbatore', state: 'Tamil Nadu', lat: 11.0168, lng: 76.9558 },
  { name: 'Madurai', state: 'Tamil Nadu', lat: 9.9252, lng: 78.1198 },
  { name: 'Tiruchirappalli', state: 'Tamil Nadu', lat: 10.7905, lng: 78.7047 },
  { name: 'Salem', state: 'Tamil Nadu', lat: 11.6643, lng: 78.146 },
  { name: 'Tirunelveli', state: 'Tamil Nadu', lat: 8.7139, lng: 77.7567 },
  { name: 'Vellore', state: 'Tamil Nadu', lat: 12.9165, lng: 79.1325 },
  { name: 'Bengaluru', state: 'Karnataka', lat: 12.9716, lng: 77.5946 },
  { name: 'Mysuru', state: 'Karnataka', lat: 12.2958, lng: 76.6394 },
  { name: 'Hyderabad', state: 'Telangana', lat: 17.385, lng: 78.4867 },
  { name: 'Visakhapatnam', state: 'Andhra Pradesh', lat: 17.6868, lng: 83.2185 },
  { name: 'Kochi', state: 'Kerala', lat: 9.9312, lng: 76.2673 },
  { name: 'Thiruvananthapuram', state: 'Kerala', lat: 8.5241, lng: 76.9366 },
  { name: 'Mumbai', state: 'Maharashtra', lat: 19.076, lng: 72.8777 },
  { name: 'Pune', state: 'Maharashtra', lat: 18.5204, lng: 73.8567 },
  { name: 'Nagpur', state: 'Maharashtra', lat: 21.1458, lng: 79.0882 },
  { name: 'Delhi', state: 'Delhi', lat: 28.6139, lng: 77.209 },
  { name: 'Noida', state: 'Uttar Pradesh', lat: 28.5355, lng: 77.391 },
  { name: 'Gurugram', state: 'Haryana', lat: 28.4595, lng: 77.0266 },
  { name: 'Lucknow', state: 'Uttar Pradesh', lat: 26.8467, lng: 80.9462 },
  { name: 'Chandigarh', state: 'Chandigarh', lat: 30.7333, lng: 76.7794 },
  { name: 'Jaipur', state: 'Rajasthan', lat: 26.9124, lng: 75.7873 },
  { name: 'Ahmedabad', state: 'Gujarat', lat: 23.0225, lng: 72.5714 },
  { name: 'Surat', state: 'Gujarat', lat: 21.1702, lng: 72.8311 },
  { name: 'Vadodara', state: 'Gujarat', lat: 22.3072, lng: 73.1812 },
  { name: 'Indore', state: 'Madhya Pradesh', lat: 22.7196, lng: 75.8577 },
  { name: 'Bhopal', state: 'Madhya Pradesh', lat: 23.2599, lng: 77.4126 },
  { name: 'Kolkata', state: 'West Bengal', lat: 22.5726, lng: 88.3639 },
  { name: 'Patna', state: 'Bihar', lat: 25.5941, lng: 85.1376 },
  { name: 'Ranchi', state: 'Jharkhand', lat: 23.3441, lng: 85.3096 },
  { name: 'Bhubaneswar', state: 'Odisha', lat: 20.2961, lng: 85.8245 },
  { name: 'Guwahati', state: 'Assam', lat: 26.1445, lng: 91.7362 },
];
export const CITIES = CITY_LIST.map((c) => c.name);
