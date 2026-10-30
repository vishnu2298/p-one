const { HttpError } = require('../util');

// Role -> permissions. Cashiers never see accounting or owner-only settings.
const ALL = [
  'business.manage', 'team.manage', 'products.read', 'products.write', 'inventory.read', 'inventory.write',
  'purchases.read', 'purchases.write', 'sales.read', 'sales.write', 'sales.refund', 'customers.read', 'customers.write',
  'suppliers.read', 'suppliers.write', 'expenses.write', 'accounting.read', 'accounting.write', 'reports.read',
  'storefront.manage', 'services.manage', 'appointments.manage', 'clinical.read', 'clinical.write', 'dashboard.read',
];
const ROLES = {
  owner: ALL,
  manager: ALL.filter((p) => !['business.manage', 'team.manage', 'accounting.write'].includes(p)),
  cashier: ['products.read', 'sales.read', 'sales.write', 'customers.read', 'customers.write', 'inventory.read'],
  inventory: ['products.read', 'products.write', 'inventory.read', 'inventory.write', 'purchases.read', 'purchases.write', 'suppliers.read', 'suppliers.write', 'dashboard.read'],
  accountant: ['accounting.read', 'accounting.write', 'reports.read', 'expenses.write', 'sales.read', 'purchases.read', 'customers.read', 'suppliers.read', 'products.read', 'inventory.read', 'dashboard.read'],
  doctor: ['appointments.manage', 'clinical.read', 'clinical.write', 'customers.read', 'services.manage', 'products.read'],
  receptionist: ['appointments.manage', 'customers.read', 'customers.write', 'sales.read', 'sales.write', 'products.read'],
};

/** Resolves the signed-in user's membership for :businessId and enforces a permission. */
function requireBiz(ctx, permission) {
  const check = (req, _res, next) => {
    const id = Number(req.params.businessId);
    const biz = id ? ctx.db.prepare('SELECT * FROM businesses WHERE id = ?').get(id) : null;
    const member = biz ? ctx.db.prepare("SELECT * FROM business_members WHERE business_id = ? AND user_id = ? AND status = 'active'").get(id, req.user.id) : null;
    // Same message for "no such business" and "not yours" so tenants cannot probe each other.
    if (!biz || !member) return next(new HttpError(404, 'Business not found'));
    const perms = ROLES[member.role] || [];
    if (permission && !perms.includes(permission)) return next(new HttpError(403, 'You do not have permission to do this'));
    req.biz = biz; req.member = member; req.perms = perms;
    next();
  };
  return [ctx.auth.required, check];
}

module.exports = { ROLES, ALL, requireBiz };
