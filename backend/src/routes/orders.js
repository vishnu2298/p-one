const express = require('express');
const { HttpError, str } = require('../util');

// Order lifecycle: requested -> accepted -> completed (or declined / cancelled).
// Payment happens in person at handover; the app records the agreement and builds trust.
module.exports = ({ db, ser, auth, notify }) => {
  const r = express.Router();
  const getOrder = db.prepare('SELECT * FROM orders WHERE id = ?');
  const getListing = db.prepare('SELECT * FROM listings WHERE id = ?');
  const getUser = db.prepare('SELECT * FROM users WHERE id = ?');

  const shape = (o, me) => {
    const l = getListing.get(o.listing_id);
    const reviewed = db.prepare('SELECT 1 FROM reviews WHERE order_id = ? AND reviewer_id = ?').get(o.id, me.id);
    const other = getUser.get(o.buyer_id === me.id ? o.seller_id : o.buyer_id);
    const agreed = ['accepted', 'completed'].includes(o.status);
    const mine = o.buyer_id === me.id;
    return {
      id: o.id,
      status: o.status,
      price: o.price,
      listPrice: o.list_price || o.price,
      // Phone numbers are revealed only once the seller has accepted, and only between the two parties.
      contactPhone: agreed && other.phone ? other.phone : null,
      // The seller's UPI ID is revealed to the buyer only after acceptance, so they can pay at handover.
      pay: mine && o.status === 'accepted' && other.upi_id ? { upiId: other.upi_id, payeeName: other.name || 'Seller', amount: o.price } : null,
      commission: o.commission || 0,
      note: o.note,
      createdAt: o.created_at,
      role: o.buyer_id === me.id ? 'buyer' : 'seller',
      listing: ser.listing(l, me),
      buyer: ser.user(getUser.get(o.buyer_id)),
      seller: ser.user(getUser.get(o.seller_id)),
      reviewed: !!reviewed,
    };
  };

  r.post('/orders', auth.required, (req, res) => {
    const l = getListing.get(Number(req.body.listingId));
    if (!l || l.status !== 'active') throw new HttpError(404, 'This item is no longer available');
    if (l.seller_id === req.user.id) throw new HttpError(400, 'You cannot buy your own item');
    if (db.prepare("SELECT 1 FROM orders WHERE listing_id = ? AND buyer_id = ? AND status IN ('requested','accepted')").get(l.id, req.user.id)) {
      throw new HttpError(409, 'You already have an open request for this item');
    }
    // Bargaining is normal in India: buyers may offer less than the asking price (not below 30% of it).
    let price = l.price;
    if (req.body.offer !== undefined && req.body.offer !== null && req.body.offer !== '') {
      price = Math.round(Number(req.body.offer));
      if (!Number.isFinite(price) || price < Math.ceil(l.price * 0.3) || price > l.price) {
        throw new HttpError(400, `Please offer between ₹${Math.ceil(l.price * 0.3).toLocaleString('en-IN')} and ₹${l.price.toLocaleString('en-IN')}`);
      }
    }
    const info = db
      .prepare('INSERT INTO orders (listing_id,buyer_id,seller_id,price,list_price,note) VALUES (?,?,?,?,?,?)')
      .run(l.id, req.user.id, l.seller_id, price, l.price, str(req.body.note, { max: 300 }));
    notify(l.seller_id, { type: 'order_request', title: price < l.price ? 'New offer' : 'New buy request', body: price < l.price ? `${req.user.name || 'Someone'} offered ₹${price.toLocaleString('en-IN')} for ${l.title}` : `${req.user.name || 'Someone'} wants to buy ${l.title}`, data: { orderId: Number(info.lastInsertRowid) } });
    res.status(201).json({ order: shape(getOrder.get(info.lastInsertRowid), req.user) });
  });

  r.get('/orders', auth.required, (req, res) => {
    const role = req.query.role === 'selling' ? 'seller_id' : 'buyer_id';
    const rows = db.prepare(`SELECT * FROM orders WHERE ${role} = ? ORDER BY id DESC`).all(req.user.id);
    res.json({ orders: rows.map((o) => shape(o, req.user)) });
  });

  r.get('/orders/:id', auth.required, (req, res) => {
    const o = getOrder.get(req.params.id);
    if (!o || (o.buyer_id !== req.user.id && o.seller_id !== req.user.id)) throw new HttpError(404, 'Order not found');
    res.json({ order: shape(o, req.user) });
  });

  r.post('/orders/:id/review', auth.required, (req, res) => {
    const o = getOrder.get(req.params.id);
    if (!o || (o.buyer_id !== req.user.id && o.seller_id !== req.user.id)) throw new HttpError(404, 'Order not found');
    if (o.status !== 'completed') throw new HttpError(400, 'You can review once the deal is completed');
    const rating = Math.round(Number(req.body.rating));
    if (!(rating >= 1 && rating <= 5)) throw new HttpError(400, 'Please choose 1 to 5 stars');
    const reviewee = o.buyer_id === req.user.id ? o.seller_id : o.buyer_id;
    try {
      db.prepare('INSERT INTO reviews (order_id, reviewer_id, reviewee_id, rating, comment) VALUES (?,?,?,?,?)')
        .run(o.id, req.user.id, reviewee, rating, str(req.body.comment, { max: 400 }));
    } catch {
      throw new HttpError(409, 'You have already reviewed this deal');
    }
    notify(reviewee, { type: 'review', title: `You received ${rating} star${rating > 1 ? 's' : ''}`, body: str(req.body.comment, { max: 100 }) || 'Someone reviewed their experience with you.', data: { userId: req.user.id } });
    res.status(201).json({ ok: true });
  });

  r.post('/orders/:id/:action', auth.required, (req, res) => {
    const o = getOrder.get(req.params.id);
    if (!o || (o.buyer_id !== req.user.id && o.seller_id !== req.user.id)) throw new HttpError(404, 'Order not found');
    const isSeller = o.seller_id === req.user.id;
    const { action } = req.params;
    const set = (status) => db.prepare('UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, o.id);

    if (action === 'accept' && isSeller && o.status === 'requested') {
      set('accepted');
    } else if (action === 'decline' && isSeller && o.status === 'requested') {
      set('declined');
    } else if (action === 'cancel' && !isSeller && ['requested', 'accepted'].includes(o.status)) {
      set('cancelled');
    } else if (action === 'complete' && isSeller && o.status === 'accepted') {
      set('completed');
      db.prepare("UPDATE listings SET status = 'sold' WHERE id = ?").run(o.listing_id);
      // Individuals are never charged. Brokerage applies only to brand sellers.
      const seller = getUser.get(o.seller_id);
      if (seller.account_type === 'brand') {
        const fee = Math.round(o.price * seller.commission_rate);
        db.prepare('UPDATE orders SET commission = ? WHERE id = ?').run(fee, o.id);
        db.prepare('INSERT OR IGNORE INTO revenue_events (kind, amount, ref, brand_id) VALUES (?,?,?,?)').run('brokerage', fee, `order:${o.id}`, seller.id);
      }
      db.prepare("UPDATE orders SET status = 'declined' WHERE listing_id = ? AND id != ? AND status IN ('requested','accepted')").run(o.listing_id, o.id);
    } else {
      throw new HttpError(400, 'That action is not available for this order');
    }
    const titles = { accept: 'Request accepted', decline: 'Request declined', cancel: 'Request cancelled', complete: 'Deal completed' };
    const listingTitle = getListing.get(o.listing_id)?.title || 'your item';
    notify(isSeller ? o.buyer_id : o.seller_id, { type: 'order_update', title: titles[action], body: `${req.user.name || 'The other person'}: ${listingTitle}`, data: { orderId: o.id } });
    res.json({ order: shape(getOrder.get(o.id), req.user) });
  });

  return r;
};
