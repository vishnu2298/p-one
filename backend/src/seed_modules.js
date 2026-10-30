// Demo data for the business and auction modules. Runs after the base seed, on an empty database only.
const acc = require('./modules/accounting');
const inv = require('./modules/inventory');
const sales = require('./modules/sales');
const { CITIES } = require('./util');

const HOUR = 3600000, MIN = 60000;
const R = (n) => Math.round(n * 100);

function seedModules(db, now = Date.now()) {
  const uid = (email) => db.prepare('SELECT id FROM users WHERE email = ?').get(email)?.id;
  const demo = uid('demo@connectly.app'), arun = uid('arun@connectly.app'), priya = uid('priya@connectly.app'), divya = uid('divya@connectly.app');
  const rohit = uid('rohit@connectly.app'), sneha = uid('sneha@connectly.app');
  if (!demo || db.prepare('SELECT COUNT(*) n FROM businesses').get().n) return;
  db.prepare('UPDATE users SET verified = 1').run();

  /* ---------------- Lakshmi Provision Stores (grocery, owned by the demo user) ---------------- */
  const [lat, lng] = CITIES.Chennai;
  const bizId = Number(db.prepare("INSERT INTO businesses (owner_user_id, name, category, description, address, city, lat, lng, phone, gstin, verified, hours, public_slug, storefront_enabled, pickup_enabled, delivery_enabled, delivery_fee_paise) VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?,1,1,1,?)")
    .run(demo, 'Lakshmi Provision Stores', 'grocery', 'Fresh groceries, dairy and daily needs. Family-run since 1998.', '12, Usman Road, T. Nagar', 'Chennai', lat + 0.012, lng - 0.004, '+919876500000', '33ABCDE1234F1Z5', JSON.stringify({ mon: '7:00-21:30', tue: '7:00-21:30', wed: '7:00-21:30', thu: '7:00-21:30', fri: '7:00-21:30', sat: '7:00-22:00', sun: '8:00-14:00' }), 'lakshmi-stores', R(30)).lastInsertRowid);
  db.prepare('INSERT INTO business_members (business_id, user_id, role) VALUES (?,?,?)').run(bizId, demo, 'owner');
  if (arun) db.prepare('INSERT INTO business_members (business_id, user_id, role) VALUES (?,?,?)').run(bizId, arun, 'cashier');
  if (priya) db.prepare('INSERT INTO business_members (business_id, user_id, role) VALUES (?,?,?)').run(bizId, priya, 'inventory');
  const branch = Number(db.prepare('INSERT INTO business_branches (business_id, name, address, is_default) VALUES (?,?,?,1)').run(bizId, 'T. Nagar (main)', '12, Usman Road').lastInsertRowid);
  db.prepare('INSERT INTO business_branches (business_id, name, address) VALUES (?,?,?)').run(bizId, 'Adyar', '4, Lattice Bridge Road');
  acc.seedChart(db, bizId);
  acc.post(db, { businessId: bizId, date: new Date(now - 30 * 86400000).toISOString().slice(0, 10), memo: 'Owner capital', sourceType: 'capital', sourceId: 'seed', sourceKey: 'capital:seed', by: demo, lines: [{ code: '1000', debit: R(150000) }, { code: '3000', credit: R(150000) }] });

  const supplier = Number(db.prepare('INSERT INTO biz_suppliers (business_id, name, phone, gstin) VALUES (?,?,?,?)').run(bizId, 'Sri Murugan Wholesale', '+919800011111', '33AAAPL1234C1ZV').lastInsertRowid);
  db.prepare('INSERT INTO biz_suppliers (business_id, name, phone) VALUES (?,?,?)').run(bizId, 'Aavin Dairy Distributor', '+919800022222');

  // name, sku, sell, cost, gst bps, opening qty, reorder, unit
  const catalog = [
    ['Ponni Rice 5 kg', 'RICE5', 320, 262, 500, 40, 10], ['Aashirvaad Atta 5 kg', 'ATTA5', 285, 240, 500, 30, 10], ['Sunflower Oil 1 L', 'OIL1', 165, 138, 500, 48, 12],
    ['Sugar 1 kg', 'SUG1', 48, 41, 0, 60, 15], ['Tata Tea Gold 250 g', 'TEA250', 135, 112, 500, 25, 8], ['Toor Dal 1 kg', 'DAL1', 158, 132, 0, 35, 10],
    ['Parle-G Biscuits', 'PARLE', 10, 8, 1800, 120, 40], ['Good Day Butter Cookies', 'GOOD', 30, 24, 1800, 80, 24], ['Maggi Noodles 4-pack', 'MAGGI', 56, 47, 1800, 50, 15],
    ['Lux Soap 3-pack', 'LUX3', 120, 98, 1800, 26, 8], ['Colgate Toothpaste 150 g', 'COLG', 98, 80, 1800, 32, 10], ['Surf Excel 1 kg', 'SURF', 210, 176, 1800, 18, 6],
    ['Coconut Oil 500 ml', 'COCO', 150, 124, 500, 22, 8], ['Turmeric Powder 200 g', 'TURM', 62, 50, 500, 30, 10], ['Idli Rice 5 kg', 'IDLI5', 270, 225, 500, 14, 10],
    ['Aavin Milk 500 ml', 'MILK', 27, 24, 0, 60, 20], ['Curd 400 g', 'CURD', 32, 27, 0, 3, 10], ['Brown Bread', 'BREAD', 45, 36, 500, 24, 8], ['Eggs (tray of 30)', 'EGG30', 195, 165, 0, 2, 5], ['Mineral Water 1 L', 'WATER', 20, 14, 1800, 100, 24],
  ];
  const pids = {};
  const expiryOf = { MILK: 4, CURD: 3, BREAD: 5, EGG30: 14 };
  for (const [name, sku, sell, cost, bps, qty, reorder] of catalog) {
    const batch = sku in expiryOf ? 1 : 0;
    const id = Number(db.prepare('INSERT INTO biz_products (business_id, sku, barcode, name, category, unit, purchase_price_paise, selling_price_paise, tax_bps, reorder_level, has_batches, published) VALUES (?,?,?,?,?,?,?,?,?,?,?,1)')
      .run(bizId, sku, `8901${String(1000 + Object.keys(pids).length)}`, name, 'Groceries', 'pcs', R(cost), R(sell), bps, reorder, batch).lastInsertRowid);
    pids[sku] = id;
    inv.adjust(db, { businessId: bizId, branchId: branch, productId: id, qtyDelta: qty >= 10 ? qty * 6 : qty, reason: 'opening', unitCostPaise: R(cost), batchNo: batch ? 'B-001' : undefined, expiry: batch ? new Date(now + expiryOf[sku] * 86400000).toISOString().slice(0, 10) : undefined, by: demo, key: `seed-open-${id}` });
  }
  void supplier;

  // customers + a fortnight of sales (some on credit)
  const customers = ['Ravi Kumar', 'Meena Iyer', 'Karthik M', 'Walk-in'].map((n, i) => Number(db.prepare('INSERT INTO biz_customers (business_id, name, phone, credit_limit_paise) VALUES (?,?,?,?)').run(bizId, n, i < 3 ? `+91980003000${i}` : '', i < 3 ? R(5000) : 0).lastInsertRowid));
  const skus = Object.keys(pids);
  let n = 0;
  for (let day = 13; day >= 0; day--) {
    const count = 3 + ((day * 7) % 5);
    for (let k = 0; k < count; k++) {
      n++;
      const a = skus[(n * 3) % skus.length], b = skus[(n * 7 + 1) % skus.length];
      const total = (sku, q) => q * (catalog.find((c) => c[1] === sku)[2] * 100);
      const items = [{ productId: pids[a], qty: 3 + 2 * (n % 3) }, ...(n % 2 ? [{ productId: pids[b], qty: 2 }] : [])];
      const sum = total(a, 3 + 2 * (n % 3)) + (n % 2 ? total(b, 2) : 0);
      const credit = n % 9 === 0 && day < 6;
      try {
        const out = sales.createInvoice(db, { businessId: bizId, branchId: branch, items, customerId: credit ? customers[n % 3] : customers[3], payments: credit ? [] : [{ method: ['cash', 'upi', 'cash', 'card'][n % 4], amountPaise: sum }], idempotencyKey: `seed-sale-${n}`, by: demo });
        db.prepare("UPDATE biz_sales_invoices SET created_at = datetime('now', ?) WHERE id = ?").run(`-${day} days`, out.invoice.id);
      } catch { /* a depleted item simply skips that sale */ }
    }
  }
  for (const [code, amt, note, payee] of [['6000', 1800, 'Shop rent', 'Landlord'], ['6020', 700, 'Electricity bill', 'TNEB'], ['6010', 1000, 'Part-time helper', 'Staff']]) {
    const info = db.prepare('INSERT INTO biz_expenses (business_id, account_code, amount_paise, tax_paise, method, payee, note, date, created_by) VALUES (?,?,?,0,?,?,?,date(\'now\'),?)').run(bizId, code, R(amt), 'bank', payee, note, demo);
    acc.post(db, { businessId: bizId, memo: `Expense: ${note}`, sourceType: 'expense', sourceId: info.lastInsertRowid, sourceKey: `expense:${info.lastInsertRowid}`, by: demo, lines: [{ code, debit: R(amt) }, { code: '1010', credit: R(amt) }] });
  }

  /* ---------------- Care Clinic (owned by Priya, Divya is the doctor) ---------------- */
  if (priya && divya) {
    const [clat, clng] = CITIES.Chennai;
    const clinic = Number(db.prepare("INSERT INTO businesses (owner_user_id, name, category, description, address, city, lat, lng, phone, verified, hours, public_slug, storefront_enabled) VALUES (?,?,?,?,?,?,?,?,?,1,?,?,1)")
      .run(priya, 'Care Family Clinic', 'clinic', 'General physician. Walk-ins and appointments. Lab tests on site.', '7, Lake Area, Nungambakkam', 'Chennai', clat + 0.02, clng + 0.01, '+919876500005', JSON.stringify({ mon: '10:00-13:00', tue: '10:00-13:00', wed: '10:00-13:00' }), 'care-family-clinic').lastInsertRowid);
    db.prepare('INSERT INTO business_members (business_id, user_id, role) VALUES (?,?,?)').run(clinic, priya, 'owner');
    const doc = Number(db.prepare('INSERT INTO business_members (business_id, user_id, role) VALUES (?,?,?)').run(clinic, divya, 'doctor').lastInsertRowid);
    db.prepare('INSERT INTO business_branches (business_id, name, is_default) VALUES (?,?,1)').run(clinic, 'Main');
    acc.seedChart(db, clinic);
    for (const [nm, mins, price] of [['General consultation', 20, 400], ['Follow-up visit', 15, 250], ['Health check-up', 45, 1200]]) db.prepare('INSERT INTO biz_services (business_id, name, duration_min, price_paise) VALUES (?,?,?,?)').run(clinic, nm, mins, R(price));
    for (const wd of [1, 2, 3, 4, 5, 6]) db.prepare('INSERT INTO biz_staff_availability (business_id, staff_member_id, weekday, start_min, end_min) VALUES (?,?,?,?,?)').run(clinic, doc, wd, 10 * 60, 13 * 60);
  }

  /* ---------------- Auctions: one live (demo is registered), one with registration open ---------------- */
  const auctions = require('./seed_auctions');
  auctions.seed(db, { now, rohit, sneha, arun, divya, demo });
}

module.exports = { seedModules };
