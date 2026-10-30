const { haversineKm } = require('./util');

function makeSerializers(db) {
  const ratingStmt = db.prepare('SELECT COALESCE(ROUND(AVG(rating),1),0) AS avg, COUNT(*) AS n FROM reviews WHERE reviewee_id = ?');
  const listingCount = db.prepare("SELECT COUNT(*) AS n FROM listings WHERE seller_id = ? AND status = 'active'");
  const connCount = db.prepare("SELECT COUNT(*) AS n FROM connections WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)");
  const favStmt = db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND listing_id = ?');
  const getUser = db.prepare('SELECT * FROM users WHERE id = ?');

  const ONLINE_MS = 5 * 60 * 1000;
  const parseTs = (s) => (s ? new Date(s.replace(' ', 'T') + 'Z').getTime() : 0);

  function user(u, { full = false } = {}) {
    if (!u) return null;
    const r = ratingStmt.get(u.id);
    const base = {
      id: u.id,
      name: u.name || 'New member',
      city: u.city,
      avatar: u.avatar || '',
      verified: !!u.verified,
      isBrand: u.account_type === 'brand',
      brandName: u.account_type === 'brand' ? u.brand_name : '',
      rating: r.avg,
      reviewCount: r.n,
      online: Date.now() - parseTs(u.last_seen) < ONLINE_MS,
    };
    if (!full) return base;
    return {
      ...base,
      bio: u.bio,
      interests: u.interests ? u.interests.split(',').map((s) => s.trim()).filter(Boolean) : [],
      listingCount: listingCount.get(u.id).n,
      connectionCount: connCount.get(u.id, u.id).n,
      memberSince: u.created_at,
      lastSeen: u.last_seen,
    };
  }

  function me(u) {
    return {
      ...user(u, { full: true }), email: u.email || '', phone: u.phone, lat: u.lat, lng: u.lng,
      hasPassword: !!u.password_hash, commissionRate: u.account_type === 'brand' ? u.commission_rate : 0, authProvider: u.auth_provider, pushEnabled: !!u.push_enabled, needsProfile: !u.name,
    };
  }

  function listing(l, viewer) {
    if (!l) return null;
    return {
      id: l.id,
      title: l.title,
      description: l.description,
      category: l.category,
      price: l.price,
      condition: l.condition,
      brand: l.brand,
      warranty: l.warranty,
      city: l.city,
      images: JSON.parse(l.images || '[]'),
      status: l.status,
      views: l.views,
      createdAt: l.created_at,
      seller: user(getUser.get(l.seller_id)),
      distanceKm: viewer ? haversineKm(viewer.lat, viewer.lng, l.lat, l.lng) : null,
      isFavorite: viewer ? !!favStmt.get(viewer.id, l.id) : false,
      isMine: viewer ? viewer.id === l.seller_id : false,
    };
  }

  return { user, me, listing };
}

module.exports = { makeSerializers };
