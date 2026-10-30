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
export const CITIES = ['Chennai', 'Bengaluru', 'Mumbai', 'Delhi', 'Hyderabad', 'Pune', 'Coimbatore', 'Madurai', 'Kolkata', 'Kochi'];
