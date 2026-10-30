// Schema for Business, Inventory, Accounting, Storefront, Services, Auctions, Payments and Jobs.
// Money columns are integer PAISE (suffix _paise); tax rates are basis points (suffix _bps).
// Everything is CREATE IF NOT EXISTS, so existing databases upgrade in place.
function migrateModules(db) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT DEFAULT CURRENT_TIMESTAMP,
    actor_user_id INTEGER,
    business_id INTEGER,
    action TEXT NOT NULL,
    entity TEXT,
    entity_id TEXT,
    meta TEXT DEFAULT '{}'
  );
  CREATE INDEX IF NOT EXISTS idx_audit_biz ON audit_log(business_id, id);

  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    run_at INTEGER NOT NULL,
    payload TEXT DEFAULT '{}',
    status TEXT DEFAULT 'pending',
    attempts INTEGER DEFAULT 0,
    last_error TEXT,
    dedupe_key TEXT UNIQUE,
    created_at INTEGER,
    done_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_jobs_due ON jobs(status, run_at);

  CREATE TABLE IF NOT EXISTS payment_intents (
    id TEXT PRIMARY KEY,
    purpose TEXT NOT NULL,
    ref_id INTEGER NOT NULL,
    user_id INTEGER,
    amount_paise INTEGER NOT NULL,
    currency TEXT DEFAULT 'INR',
    status TEXT DEFAULT 'created',
    provider TEXT NOT NULL,
    provider_order_id TEXT UNIQUE,
    provider_payment_id TEXT,
    gateway_fee_paise INTEGER DEFAULT 0,
    created_at INTEGER,
    updated_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS webhook_events (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    payload TEXT,
    processed_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS refunds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_intent_id TEXT NOT NULL REFERENCES payment_intents(id),
    amount_paise INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    reason TEXT DEFAULT '',
    dedupe_key TEXT UNIQUE,
    provider_refund_id TEXT,
    created_at INTEGER,
    processed_at INTEGER
  );

  /* ---------------- Business ---------------- */
  CREATE TABLE IF NOT EXISTS businesses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT DEFAULT '',
    address TEXT DEFAULT '',
    city TEXT DEFAULT '',
    lat REAL, lng REAL,
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    gstin TEXT DEFAULT '',
    verified INTEGER DEFAULT 0,
    hours TEXT DEFAULT '{}',
    currency TEXT DEFAULT 'INR',
    costing TEXT DEFAULT 'wavg',
    allow_negative_stock INTEGER DEFAULT 0,
    public_slug TEXT UNIQUE,
    storefront_enabled INTEGER DEFAULT 0,
    pickup_enabled INTEGER DEFAULT 1,
    delivery_enabled INTEGER DEFAULT 0,
    delivery_fee_paise INTEGER DEFAULT 0,
    next_invoice_no INTEGER DEFAULT 1,
    next_entry_no INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS business_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id),
    role TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    invite_phone TEXT DEFAULT '',
    invite_email TEXT DEFAULT '',
    branch_id INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (business_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS business_branches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    address TEXT DEFAULT '',
    is_default INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  /* ---------------- Inventory ---------------- */
  CREATE TABLE IF NOT EXISTS biz_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    sku TEXT NOT NULL,
    barcode TEXT DEFAULT '',
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    category TEXT DEFAULT '',
    unit TEXT DEFAULT 'pcs',
    purchase_price_paise INTEGER DEFAULT 0,
    selling_price_paise INTEGER NOT NULL,
    tax_bps INTEGER DEFAULT 0,
    hsn TEXT DEFAULT '',
    is_service INTEGER DEFAULT 0,
    track_stock INTEGER DEFAULT 1,
    has_batches INTEGER DEFAULT 0,
    has_serials INTEGER DEFAULT 0,
    warranty_months INTEGER DEFAULT 0,
    reorder_level INTEGER DEFAULT 0,
    parent_id INTEGER,
    variant_label TEXT DEFAULT '',
    published INTEGER DEFAULT 0,
    image TEXT DEFAULT '',
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (business_id, sku)
  );
  CREATE INDEX IF NOT EXISTS idx_bprod_barcode ON biz_products(business_id, barcode);
  CREATE TABLE IF NOT EXISTS biz_stock_balance (
    business_id INTEGER NOT NULL,
    branch_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL REFERENCES biz_products(id),
    qty INTEGER NOT NULL DEFAULT 0,
    reserved INTEGER NOT NULL DEFAULT 0,
    value_paise INTEGER NOT NULL DEFAULT 0,
    avg_cost_paise INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (branch_id, product_id)
  );
  CREATE TABLE IF NOT EXISTS biz_stock_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    branch_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    qty_delta INTEGER NOT NULL,
    unit_cost_paise INTEGER NOT NULL DEFAULT 0,
    value_delta_paise INTEGER NOT NULL DEFAULT 0,
    batch_no TEXT DEFAULT '',
    expiry TEXT DEFAULT '',
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    reference TEXT DEFAULT '',
    note TEXT DEFAULT '',
    created_by INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (source_type, source_id, product_id, kind, batch_no)
  );
  CREATE INDEX IF NOT EXISTS idx_smov_prod ON biz_stock_movements(business_id, product_id, id);
  CREATE TABLE IF NOT EXISTS biz_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    branch_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    batch_no TEXT NOT NULL,
    expiry TEXT DEFAULT '',
    qty_remaining INTEGER NOT NULL DEFAULT 0,
    unit_cost_paise INTEGER DEFAULT 0,
    UNIQUE (branch_id, product_id, batch_no)
  );
  CREATE TABLE IF NOT EXISTS biz_serials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    serial TEXT NOT NULL,
    status TEXT DEFAULT 'in_stock',
    sold_invoice_id INTEGER,
    warranty_until TEXT DEFAULT '',
    UNIQUE (business_id, product_id, serial)
  );
  CREATE TABLE IF NOT EXISTS biz_reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    branch_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    qty INTEGER NOT NULL,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    created_at INTEGER,
    UNIQUE (source_type, source_id, product_id)
  );
  CREATE TABLE IF NOT EXISTS biz_stock_transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    from_branch_id INTEGER NOT NULL,
    to_branch_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    qty INTEGER NOT NULL,
    created_by INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  /* ---------------- CRM, purchasing ---------------- */
  CREATE TABLE IF NOT EXISTS biz_suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    phone TEXT DEFAULT '', email TEXT DEFAULT '', gstin TEXT DEFAULT '', address TEXT DEFAULT '',
    credit_limit_paise INTEGER DEFAULT 0,
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS biz_customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id INTEGER,
    kind TEXT DEFAULT 'customer',
    name TEXT NOT NULL,
    phone TEXT DEFAULT '', email TEXT DEFAULT '', gstin TEXT DEFAULT '',
    credit_limit_paise INTEGER DEFAULT 0,
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS biz_comms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    party_type TEXT NOT NULL,
    party_id INTEGER NOT NULL,
    channel TEXT DEFAULT 'note',
    body TEXT NOT NULL,
    created_by INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS biz_purchase_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    supplier_id INTEGER NOT NULL,
    branch_id INTEGER NOT NULL,
    po_no TEXT NOT NULL,
    status TEXT DEFAULT 'ordered',
    notes TEXT DEFAULT '',
    created_by INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS biz_po_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    po_id INTEGER NOT NULL REFERENCES biz_purchase_orders(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL,
    qty_ordered INTEGER NOT NULL,
    qty_received INTEGER NOT NULL DEFAULT 0,
    unit_cost_paise INTEGER NOT NULL,
    tax_bps INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS biz_goods_receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    po_id INTEGER,
    supplier_id INTEGER NOT NULL,
    branch_id INTEGER NOT NULL,
    grn_no TEXT NOT NULL,
    invoice_no TEXT DEFAULT '',
    subtotal_paise INTEGER NOT NULL,
    tax_paise INTEGER NOT NULL,
    total_paise INTEGER NOT NULL,
    paid_paise INTEGER NOT NULL DEFAULT 0,
    idempotency_key TEXT UNIQUE,
    received_by INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS biz_grn_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    grn_id INTEGER NOT NULL REFERENCES biz_goods_receipts(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL,
    qty INTEGER NOT NULL,
    unit_cost_paise INTEGER NOT NULL,
    tax_bps INTEGER DEFAULT 0,
    batch_no TEXT DEFAULT '',
    expiry TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS biz_purchase_returns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    supplier_id INTEGER NOT NULL,
    branch_id INTEGER NOT NULL,
    grn_id INTEGER,
    total_paise INTEGER NOT NULL,
    note TEXT DEFAULT '',
    idempotency_key TEXT UNIQUE,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS biz_supplier_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    supplier_id INTEGER NOT NULL,
    grn_id INTEGER,
    amount_paise INTEGER NOT NULL,
    method TEXT NOT NULL,
    reference TEXT DEFAULT '',
    idempotency_key TEXT UNIQUE,
    created_by INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  /* ---------------- Sales ---------------- */
  CREATE TABLE IF NOT EXISTS biz_sales_invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    branch_id INTEGER NOT NULL,
    invoice_no TEXT NOT NULL,
    token TEXT UNIQUE,
    customer_id INTEGER,
    customer_name TEXT DEFAULT '',
    status TEXT DEFAULT 'paid',
    subtotal_paise INTEGER NOT NULL,
    discount_paise INTEGER NOT NULL DEFAULT 0,
    tax_paise INTEGER NOT NULL,
    total_paise INTEGER NOT NULL,
    paid_paise INTEGER NOT NULL DEFAULT 0,
    returned_paise INTEGER NOT NULL DEFAULT 0,
    cogs_paise INTEGER NOT NULL DEFAULT 0,
    channel TEXT DEFAULT 'pos',
    source_type TEXT DEFAULT '',
    source_id TEXT DEFAULT '',
    idempotency_key TEXT UNIQUE,
    created_by INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (business_id, invoice_no)
  );
  CREATE TABLE IF NOT EXISTS biz_sales_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL REFERENCES biz_sales_invoices(id) ON DELETE CASCADE,
    product_id INTEGER,
    name TEXT NOT NULL,
    qty INTEGER NOT NULL,
    unit_price_paise INTEGER NOT NULL,
    discount_paise INTEGER NOT NULL DEFAULT 0,
    tax_bps INTEGER DEFAULT 0,
    tax_paise INTEGER NOT NULL DEFAULT 0,
    line_total_paise INTEGER NOT NULL,
    cost_paise INTEGER NOT NULL DEFAULT 0,
    returned_qty INTEGER NOT NULL DEFAULT 0,
    returned_cost_paise INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS biz_sales_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    invoice_id INTEGER NOT NULL,
    method TEXT NOT NULL,
    amount_paise INTEGER NOT NULL,
    reference TEXT DEFAULT '',
    idempotency_key TEXT UNIQUE,
    created_by INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS biz_sales_returns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    invoice_id INTEGER NOT NULL,
    return_no TEXT NOT NULL,
    subtotal_paise INTEGER NOT NULL,
    tax_paise INTEGER NOT NULL,
    total_paise INTEGER NOT NULL,
    refund_method TEXT DEFAULT 'cash',
    reason TEXT DEFAULT '',
    idempotency_key TEXT UNIQUE,
    created_by INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS biz_expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    account_code TEXT NOT NULL,
    amount_paise INTEGER NOT NULL,
    tax_paise INTEGER NOT NULL DEFAULT 0,
    method TEXT NOT NULL,
    payee TEXT DEFAULT '',
    note TEXT DEFAULT '',
    date TEXT NOT NULL,
    idempotency_key TEXT UNIQUE,
    created_by INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  /* ---------------- Accounting ---------------- */
  CREATE TABLE IF NOT EXISTS biz_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    system INTEGER DEFAULT 0,
    UNIQUE (business_id, code)
  );
  CREATE TABLE IF NOT EXISTS biz_journal_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    entry_no INTEGER NOT NULL,
    date TEXT NOT NULL,
    memo TEXT DEFAULT '',
    source_type TEXT DEFAULT '',
    source_id TEXT DEFAULT '',
    source_key TEXT,
    reversal_of INTEGER,
    created_by INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (business_id, source_key)
  );
  CREATE TABLE IF NOT EXISTS biz_journal_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER NOT NULL REFERENCES biz_journal_entries(id),
    account_id INTEGER NOT NULL REFERENCES biz_accounts(id),
    debit_paise INTEGER NOT NULL DEFAULT 0,
    credit_paise INTEGER NOT NULL DEFAULT 0,
    memo TEXT DEFAULT '',
    party_type TEXT DEFAULT '',
    party_id INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_jl_acct ON biz_journal_lines(account_id);
  CREATE TABLE IF NOT EXISTS biz_financial_periods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    period TEXT NOT NULL,
    closed_at TEXT DEFAULT CURRENT_TIMESTAMP,
    closed_by INTEGER,
    UNIQUE (business_id, period)
  );
  CREATE TABLE IF NOT EXISTS biz_daily_stats (
    business_id INTEGER NOT NULL,
    day TEXT NOT NULL,
    sales_paise INTEGER DEFAULT 0,
    invoices INTEGER DEFAULT 0,
    PRIMARY KEY (business_id, day)
  );

  /* ---------------- Storefront ---------------- */
  CREATE TABLE IF NOT EXISTS store_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    branch_id INTEGER NOT NULL,
    buyer_user_id INTEGER NOT NULL,
    status TEXT DEFAULT 'pending_payment',
    fulfillment TEXT DEFAULT 'pickup',
    address TEXT DEFAULT '',
    note TEXT DEFAULT '',
    pay_method TEXT DEFAULT 'online',
    subtotal_paise INTEGER NOT NULL,
    tax_paise INTEGER NOT NULL,
    delivery_fee_paise INTEGER NOT NULL DEFAULT 0,
    total_paise INTEGER NOT NULL,
    payment_intent_id TEXT,
    invoice_id INTEGER,
    idempotency_key TEXT UNIQUE,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS store_order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES store_orders(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    qty INTEGER NOT NULL,
    unit_price_paise INTEGER NOT NULL,
    tax_bps INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS store_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    rating INTEGER NOT NULL,
    comment TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (business_id, user_id)
  );

  /* ---------------- Services, appointments, clinic ---------------- */
  CREATE TABLE IF NOT EXISTS biz_services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    duration_min INTEGER NOT NULL DEFAULT 30,
    price_paise INTEGER NOT NULL,
    tax_bps INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS biz_staff_availability (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    staff_member_id INTEGER NOT NULL,
    weekday INTEGER NOT NULL,
    start_min INTEGER NOT NULL,
    end_min INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS biz_appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    service_id INTEGER NOT NULL,
    staff_member_id INTEGER,
    customer_user_id INTEGER,
    customer_id INTEGER,
    customer_name TEXT DEFAULT '',
    start_ts INTEGER NOT NULL,
    end_ts INTEGER NOT NULL,
    status TEXT DEFAULT 'requested',
    invoice_id INTEGER,
    note TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_appt_staff ON biz_appointments(staff_member_id, start_ts);
  CREATE TABLE IF NOT EXISTS biz_clinical_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    customer_id INTEGER NOT NULL,
    appointment_id INTEGER,
    consent INTEGER NOT NULL DEFAULT 0,
    ciphertext TEXT NOT NULL,
    author_member_id INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  /* ---------------- Auctions ---------------- */
  CREATE TABLE IF NOT EXISTS auctions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_id INTEGER NOT NULL REFERENCES users(id),
    business_id INTEGER,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    images TEXT DEFAULT '[]',
    videos TEXT DEFAULT '[]',
    category TEXT DEFAULT 'others',
    condition TEXT DEFAULT 'Good',
    verified_item INTEGER DEFAULT 0,
    city TEXT DEFAULT '',
    market_price_paise INTEGER DEFAULT 0,
    starting_bid_paise INTEGER NOT NULL,
    reserve_paise INTEGER,
    min_increment_paise INTEGER NOT NULL,
    buy_now_paise INTEGER,
    registration_fee_paise INTEGER NOT NULL DEFAULT 0,
    deposit_paise INTEGER NOT NULL DEFAULT 0,
    reg_opens_at INTEGER NOT NULL,
    reg_closes_at INTEGER NOT NULL,
    starts_at INTEGER NOT NULL,
    ends_at INTEGER NOT NULL,
    original_ends_at INTEGER NOT NULL,
    max_participants INTEGER,
    max_bids_per_user INTEGER,
    anti_snipe_window_s INTEGER DEFAULT 120,
    anti_snipe_extend_s INTEGER DEFAULT 120,
    max_extension_s INTEGER DEFAULT 1800,
    shipping TEXT DEFAULT '["pickup"]',
    pickup_address TEXT DEFAULT '',
    payment_deadline_hours INTEGER DEFAULT 24,
    default_policy TEXT DEFAULT 'forfeit_deposit',
    offer_next_bidder INTEGER DEFAULT 1,
    seller_verified INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'DRAFT',
    current_bid_paise INTEGER DEFAULT 0,
    current_bidder_id INTEGER,
    bid_count INTEGER DEFAULT 0,
    seq INTEGER DEFAULT 0,
    terms TEXT DEFAULT '{}',
    cancelled_reason TEXT DEFAULT '',
    created_at INTEGER,
    updated_at INTEGER,
    published_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_auc_status ON auctions(status, starts_at);
  CREATE TABLE IF NOT EXISTS auction_registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    auction_id INTEGER NOT NULL REFERENCES auctions(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'pending_payment',
    fee_paise INTEGER NOT NULL,
    deposit_paise INTEGER NOT NULL,
    payment_intent_id TEXT,
    paid_at INTEGER,
    created_at INTEGER,
    UNIQUE (auction_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS auction_bids (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    auction_id INTEGER NOT NULL REFERENCES auctions(id),
    seq INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    amount_paise INTEGER NOT NULL,
    idempotency_key TEXT NOT NULL,
    kind TEXT DEFAULT 'bid',
    created_at INTEGER,
    UNIQUE (auction_id, seq),
    UNIQUE (auction_id, user_id, idempotency_key)
  );
  CREATE TABLE IF NOT EXISTS auction_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    auction_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    payload TEXT DEFAULT '{}',
    created_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_aev ON auction_events(auction_id, id);
  CREATE TABLE IF NOT EXISTS auction_settlements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    auction_id INTEGER NOT NULL UNIQUE REFERENCES auctions(id),
    winner_user_id INTEGER NOT NULL,
    amount_paise INTEGER NOT NULL,
    offer_round INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'awaiting_payment',
    payment_deadline INTEGER,
    payment_intent_id TEXT,
    fulfillment TEXT DEFAULT '',
    shipping_address TEXT DEFAULT '',
    tracking TEXT DEFAULT '',
    shipped_at INTEGER,
    delivered_at INTEGER,
    commission_paise INTEGER DEFAULT 0,
    gateway_fee_paise INTEGER DEFAULT 0,
    seller_payout_paise INTEGER DEFAULT 0,
    payout_status TEXT DEFAULT 'pending',
    skipped_users TEXT DEFAULT '[]',
    created_at INTEGER,
    updated_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS auction_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    auction_id INTEGER NOT NULL,
    user_id INTEGER,
    kind TEXT NOT NULL,
    amount_paise INTEGER NOT NULL,
    ref TEXT DEFAULT '',
    dedupe_key TEXT UNIQUE,
    created_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_aled ON auction_ledger(auction_id, id);
  CREATE TABLE IF NOT EXISTS auction_amendments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    auction_id INTEGER NOT NULL,
    changes TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    consent_deadline INTEGER NOT NULL,
    created_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS auction_amendment_votes (
    amendment_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    accepted INTEGER NOT NULL,
    PRIMARY KEY (amendment_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS auction_disputes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    auction_id INTEGER NOT NULL,
    raised_by INTEGER NOT NULL,
    reason TEXT NOT NULL,
    status TEXT DEFAULT 'open',
    resolution TEXT DEFAULT '',
    created_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS biz_modules (
    business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (business_id, key)
  );
  CREATE TABLE IF NOT EXISTS biz_entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    label TEXT NOT NULL,
    plural TEXT NOT NULL,
    icon TEXT DEFAULT 'albums',
    def TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (business_id, key)
  );
  CREATE TABLE IF NOT EXISTS biz_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    entity_id INTEGER NOT NULL REFERENCES biz_entities(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    status TEXT DEFAULT '',
    search TEXT DEFAULT '',
    created_by INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_records_entity ON biz_records (entity_id, deleted_at, id);
  `);
}

module.exports = { migrateModules };
