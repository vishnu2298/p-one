const express = require('express');
const config = require('../config');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Public item page with Open Graph tags, so a link pasted into WhatsApp shows a photo, title and price.
module.exports = ({ db }) => {
  const r = express.Router();
  r.get('/l/:id', (req, res) => {
    const l = db.prepare("SELECT * FROM listings WHERE id = ? AND status != 'removed'").get(Number(req.params.id) || 0);
    if (!l) return res.status(404).type('html').send('<h1>This item is no longer available</h1>');
    const base = config.publicUrl || `${req.protocol}://${req.get('host')}`;
    const images = JSON.parse(l.images || '[]');
    const img = images[0] ? base + images[0] : '';
    const price = '₹' + l.price.toLocaleString('en-IN');
    const store = config.androidStoreUrl || config.iosStoreUrl || '#';
    const title = `${l.title} · ${price}`;
    const desc = (l.description || `Available in ${l.city} on Connectly`).slice(0, 150);
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src * data:").type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:type" content="product">${img ? `<meta property="og:image" content="${esc(img)}">` : ''}<meta name="twitter:card" content="summary_large_image">
<style>body{font-family:system-ui,sans-serif;margin:0;background:#F7F5F1;color:#0B1B2B;display:flex;justify-content:center;padding:16px}.c{background:#fff;border-radius:22px;max-width:440px;width:100%;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)}img{width:100%;max-height:300px;object-fit:cover}.b{padding:20px}h1{font-size:26px;margin:0 0 6px}.p{font-size:30px;font-weight:800;color:#1747C6}p{font-size:18px;line-height:1.45}a.k{display:block;margin-top:12px;padding:18px;border-radius:16px;font-size:20px;font-weight:700;text-align:center;text-decoration:none;color:#fff;background:#1747C6}a.s{background:#fff;color:#1747C6;border:2px solid #1747C6}</style></head>
<body><div class="c">${img ? `<img src="${esc(img)}" alt="">` : ''}<div class="b"><h1>${esc(l.title)}</h1><div class="p">${esc(price)}</div><p>${esc(l.city)} · ${esc(l.condition)}</p><p>${esc(desc)}</p><a class="k" href="connectly://item/${l.id}">Open in Connectly</a><a class="k s" href="${esc(store)}">Get the app</a></div></div></body></html>`);
  });
  return r;
};
