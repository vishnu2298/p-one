const bcrypt = require('bcryptjs');
const { open, newReferralCode } = require('./db');
const { CITIES, jitter } = require('./util');

const PASSWORD = 'demo1234';

const USERS = [
  ['Demo User', 'demo@connectly.app', 'Chennai', 'Happy to buy and sell locally.', 'Tech,Gadgets,Bikes', 1],
  ['Rohit Kumar', 'rohit@connectly.app', 'Chennai', 'Gadget lover. Fair prices, quick replies.', 'Bikes,Gadgets', 1],
  ['Sneha Nair', 'sneha@connectly.app', 'Chennai', 'Home decor and fashion enthusiast.', 'Home decor,Fashion', 1],
  ['Arun Prakash', 'arun@connectly.app', 'Chennai', 'Tech and small business owner.', 'Tech,Business', 1],
  ['Divya S', 'divya@connectly.app', 'Chennai', 'Fitness and travel.', 'Fitness,Travel', 0],
  ['Priya Raman', 'priya@connectly.app', 'Chennai', 'Selling things I no longer use.', 'Books,Home decor', 1],
  ['Meena Iyer', 'meena@connectly.app', 'Bengaluru', 'Looking for good deals nearby.', 'Cooking,Home decor', 0],
  ['Karthik M', 'karthik@connectly.app', 'Coimbatore', 'Bike enthusiast.', 'Bikes,Travel', 0],
];

// seller index, title, category, price, condition, brand, warranty, description
const LISTINGS = [
  [0, 'iPhone 15 (128 GB)', 'electronics', 52000, 'Like New', 'Apple', 'No', 'Used for 6 months. Excellent condition. With original box and charger.'],
  [3, 'Office Chair, ergonomic', 'home', 3500, 'Good', 'Featherlite', 'No', 'Comfortable mesh-back chair with adjustable height. Very little wear.'],
  [0, 'Mountain Bike, 21 speed', 'vehicles', 6500, 'Good', 'Hercules', 'No', 'Well maintained, new tyres fitted last month. Test ride welcome.'],
  [0, 'Sofa Set (3+1+1)', 'home', 12000, 'Good', '', 'No', 'Solid wood frame, washable covers. Pickup only.'],
  [3, 'Samsung 43" Smart TV', 'electronics', 18500, 'Like New', 'Samsung', 'Yes', '2 years old, full HD, remote and wall mount included.'],
  [5, 'Maths and Science textbooks (Class 10)', 'others', 600, 'Good', '', 'No', 'Complete set, minimal highlighting.'],
  [2, 'Women\'s silk saree, wedding wear', 'fashion', 2800, 'Like New', '', 'No', 'Worn once. Dry cleaned.'],
  [3, 'Honda Activa 2019', 'vehicles', 42000, 'Fair', 'Honda', 'No', 'Single owner, 28,000 km, all papers clear.'],
  [4, 'Home tutor for Maths (Class 8-10)', 'services', 500, 'Good', '', 'No', 'Per hour. Experienced teacher, home visits within 5 km.'],
  [0, 'Dell Inspiron laptop, i5, 8 GB', 'electronics', 24000, 'Good', 'Dell', 'No', 'Great for work and study. New battery.'],
  [5, '1 BHK for rent, Adyar', 'realestate', 14000, 'Good', '', 'No', 'Monthly rent. Family preferred. Near bus stop.'],
  [4, 'Part-time shop assistant needed', 'jobs', 9000, 'Good', '', 'No', 'Monthly pay. 4 hours a day, T Nagar.'],
  [2, 'Kids bicycle, 16 inch', 'vehicles', 1800, 'Good', 'BSA', 'No', 'Training wheels included.'],
  [3, 'Wooden study table', 'home', 2200, 'Good', '', 'No', 'With 2 drawers. 4 ft wide.'],
  [5, 'Cricket bat and kit', 'others', 1500, 'Good', 'SG', 'No', 'English willow bat, pads and gloves.'],
  [6, 'Plumbing and electrical repairs', 'services', 400, 'Good', '', 'No', 'Visit charge. Same day service.'],
];

function seed(db) {
  const hash = bcrypt.hashSync(PASSWORD, 8);
  const insU = db.prepare('INSERT INTO users (name,email,password_hash,city,lat,lng,bio,interests,verified,last_seen,referral_code) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  const ids = USERS.map(([name, email, city, bio, interests, verified], i) => {
    const [lat, lng] = CITIES[city];
    // Chennai users sit at increasing distances from the demo user.
    const last = i === 1 || i === 3 ? new Date().toISOString().slice(0, 19).replace('T', ' ') : '2020-01-01 00:00:00';
    return Number(insU.run(name, email, hash, city, lat + i * 0.011, lng + i * 0.009, bio, interests, verified, last, newReferralCode()).lastInsertRowid);
  });

  // A brand partner (Sneha's shop) with one sponsored ad, so the Sponsored slots have content in demos.
  db.prepare("UPDATE users SET account_type = 'brand', brand_name = 'Nair Home Studio' WHERE id = ?").run(ids[2]);

  const insL = db.prepare('INSERT INTO listings (seller_id,title,description,category,price,condition,brand,warranty,city,lat,lng) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  const listingIds = LISTINGS.map(([s, title, cat, price, cond, brand, warr, desc]) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(ids[s]);
    return Number(insL.run(u.id, title, desc, cat, price, cond, brand, warr, u.city, jitter(u.lat, 0.02), jitter(u.lng, 0.02)).lastInsertRowid);
  });

  const adTarget = listingIds[1];
  db.prepare("INSERT INTO ads (brand_id,title,body,cta_label,target_listing_id,placement,cost_per_click,daily_budget) VALUES (?,?,?,?,?,'all',3,300)").run(ids[2], 'Comfort for your home office', 'Ergonomic chairs and tables from Nair Home Studio.', 'See the chair', adTarget);

  // Connections: demo is connected with Arun, has requests from Rohit & Sneha.
  const conn = db.prepare('INSERT INTO connections (requester_id, addressee_id, status) VALUES (?,?,?)');
  conn.run(ids[0], ids[3], 'accepted');
  conn.run(ids[1], ids[0], 'pending');
  conn.run(ids[2], ids[0], 'pending');
  conn.run(ids[5], ids[0], 'accepted');

  // A chat about the demo user's iPhone.
  const conv = Number(db.prepare('INSERT INTO conversations (user_a,user_b,listing_id) VALUES (?,?,?)').run(ids[1], ids[0], listingIds[0]).lastInsertRowid);
  const msg = db.prepare('INSERT INTO messages (conversation_id,sender_id,body) VALUES (?,?,?)');
  msg.run(conv, ids[1], 'Hi! Is this still available?');
  msg.run(conv, ids[0], 'Yes, it is available. Would you like to see more photos?');
  msg.run(conv, ids[1], 'Great! Can you share your location?');
  const conv2 = Number(db.prepare('INSERT INTO conversations (user_a,user_b,listing_id) VALUES (?,?,?)').run(ids[2], ids[0], listingIds[3]).lastInsertRowid);
  msg.run(conv2, ids[2], 'Interested in your sofa set. Can you do 11,000?');

  // One finished deal so ratings show up.
  const o = Number(db.prepare("INSERT INTO orders (listing_id,buyer_id,seller_id,price,status) VALUES (?,?,?,?, 'completed')").run(listingIds[5], ids[0], ids[5], 600).lastInsertRowid);
  db.prepare('INSERT INTO reviews (order_id,reviewer_id,reviewee_id,rating,comment) VALUES (?,?,?,?,?)').run(o, ids[0], ids[5], 5, 'Smooth deal. Books were as described.');
  db.prepare('INSERT INTO reviews (reviewer_id,reviewee_id,rating,comment) VALUES (?,?,?,?)').run(ids[1], ids[0], 5, 'Very honest seller.');
  db.prepare('INSERT INTO reviews (reviewer_id,reviewee_id,rating,comment) VALUES (?,?,?,?)').run(ids[3], ids[0], 4, 'Good communication.');
}

module.exports = { seed, PASSWORD };

if (require.main === module) {
  const db = open();
  if (db.prepare('SELECT COUNT(*) n FROM users').get().n > 0) {
    console.log('Database already has data; delete data/connectly.db to reseed.');
  } else {
    seed(db);
    console.log(`Seeded. Demo login: demo@connectly.app / ${PASSWORD}`);
  }
}
