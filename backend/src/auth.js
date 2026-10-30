const jwt = require('jsonwebtoken');
const config = require('./config');
const { HttpError } = require('./util');

const sign = (user) => jwt.sign({ uid: user.id }, config.jwtSecret, { expiresIn: '30d' });

function authMiddleware(db) {
  const getUser = db.prepare('SELECT * FROM users WHERE id = ?');
  const touch = db.prepare("UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?");
  const decode = (req) => {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return null;
    try {
      return getUser.get(jwt.verify(token, config.jwtSecret).uid) || null;
    } catch {
      return null;
    }
  };
  return {
    required(req, _res, next) {
      const user = decode(req);
      if (!user) return next(new HttpError(401, 'Please log in to continue'));
      req.user = user;
      touch.run(user.id);
      next();
    },
    optional(req, _res, next) {
      req.user = decode(req);
      next();
    },
  };
}

module.exports = { sign, authMiddleware };
