const express = require('express');
const config = require('../config');

const VERSION = '2026-10';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Plain-language templates. A lawyer must review these before public launch.
function docs() {
  const c = config;
  return {
    terms: {
      title: 'Terms of Use',
      sections: [
        ['Who we are', `${c.companyName} ("we") runs an online platform that helps people buy, sell and connect with others nearby. We are an intermediary: we do not own, sell or inspect items, and we are not a party to deals between users.`],
        ['Your account', 'You must be 18 or older. Give true information, keep your sign-in safe, and do not share OTPs with anyone. You are responsible for what you post.'],
        ['What you may not post', 'Weapons, drugs, wildlife products, fake documents, stolen goods, organs, adult services, scams, hate or abusive content, or anything illegal in India. We may remove content and suspend accounts that break these rules.'],
        ['Deals between users', 'Meet in a safe public place, check the item, and pay only after you are satisfied. Payments happen directly between you and the other person (cash or UPI). We never hold your money and we are not responsible for disputes, though you can report problems to us.'],
        ['Free for individuals', 'Using the app is free for individuals. Brands and businesses may pay for sponsored placements and a commission on completed deals; GST is added where applicable.'],
        ['Ads and affiliate links', 'Items marked "Ad" or "Sponsored" are paid placements. When you buy through a deal link we may earn a commission at no extra cost to you.'],
        ['Ending your account', 'You can delete your account in Settings at any time. We may suspend accounts that put others at risk.'],
        ['Contact', `${c.companyName}, ${c.companyAddress}. Email: ${c.supportEmail}.`],
      ],
    },
    privacy: {
      title: 'Privacy Policy',
      sections: [
        ['What we collect', 'Your phone number or email, name, city, photo (optional), the items you list, your chats and orders, and basic device information used to send notifications.'],
        ['Why we use it', 'To run your account, show nearby items and people, deliver messages and alerts, keep the platform safe, and show relevant ads. We do not sell your personal data.'],
        ['Your contacts', 'If you choose to invite friends, we read your contacts on your phone only to open your messaging app. They are never uploaded.'],
        ['Location', 'We use your city, and your exact location only if you tap "Use my location" or share it in a chat. Only your city and approximate distance are shown to others.'],
        ['Who sees what', 'Your phone number is hidden until you and another person agree to a deal, and then only that person sees it. Your profile name, city and ratings are visible to other users.'],
        ['Your rights', 'You can see and download your data (Settings, Download my data), correct it, withdraw consent and delete your account. We keep limited records only where the law requires.'],
        ['Security and retention', 'Data is stored securely and kept while your account is active. When you delete your account your personal data is erased, except records we must keep by law.'],
        ['Children', 'The app is not for people under 18.'],
        ['Grievances', `Write to our Grievance Officer: ${c.grievanceName}, ${c.grievanceEmail}${c.grievancePhone ? ', ' + c.grievancePhone : ''}.`],
      ],
    },
    grievance: {
      title: 'Grievance Officer',
      sections: [
        ['How to complain', 'Use the Report button on any item or person, or write to the Grievance Officer below. We acknowledge complaints within 24 hours and resolve them within 15 days. Content that breaks the law is removed promptly.'],
        ['Grievance Officer', `Name: ${c.grievanceName}\nEmail: ${c.grievanceEmail}${c.grievancePhone ? '\nPhone: ' + c.grievancePhone : ''}\nAddress: ${c.companyAddress}`],
      ],
    },
  };
}

module.exports = ({ db, auth }) => {
  const r = express.Router();

  r.get('/legal/:doc', (req, res) => {
    const d = docs()[req.params.doc];
    if (!d) return res.status(404).json({ error: 'Not found' });
    const sections = d.sections.map(([heading, text]) => ({ heading, text }));
    if (req.query.format === 'json' || (req.get('accept') || '').includes('application/json')) {
      return res.json({ title: d.title, version: VERSION, sections });
    }
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'").type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(d.title)} · ${esc(config.companyName)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:0 auto;padding:24px;line-height:1.55;color:#0B1B2B;font-size:18px}h1{font-size:30px}h2{font-size:21px;margin-top:28px}p{white-space:pre-line}small{color:#475467}</style></head>
<body><h1>${esc(d.title)}</h1><small>Version ${VERSION}</small>${sections.map((s) => `<h2>${esc(s.heading)}</h2><p>${esc(s.text)}</p>`).join('')}</body></html>`);
  });

  // DPDP Act: right of access. Everything we hold about the signed-in user, as a JSON download.
  r.get('/me/export', auth.required, (req, res) => {
    const id = req.user.id;
    const all = (sql, ...a) => db.prepare(sql).all(...a);
    const { password_hash, firebase_uid, ...profile } = req.user; // never export secrets
    void password_hash; void firebase_uid;
    res.set('Content-Disposition', 'attachment; filename="connectly-my-data.json"').json({
      exportedAt: new Date().toISOString(),
      profile,
      listings: all('SELECT * FROM listings WHERE seller_id = ?', id),
      favorites: all('SELECT listing_id FROM favorites WHERE user_id = ?', id),
      orders: all('SELECT * FROM orders WHERE buyer_id = ? OR seller_id = ?', id, id),
      reviewsGiven: all('SELECT * FROM reviews WHERE reviewer_id = ?', id),
      reviewsReceived: all('SELECT rating, comment, created_at FROM reviews WHERE reviewee_id = ?', id),
      messagesSent: all('SELECT conversation_id, body, type, created_at FROM messages WHERE sender_id = ?', id),
      connections: all('SELECT * FROM connections WHERE requester_id = ? OR addressee_id = ?', id, id),
      groups: all('SELECT g.id, g.name FROM groups g JOIN group_members m ON m.group_id = g.id WHERE m.user_id = ?', id),
      notifications: all('SELECT type, title, body, created_at FROM notifications WHERE user_id = ?', id),
      invitesSent: all('SELECT channel, created_at FROM invites WHERE inviter_id = ?', id),
    });
  });
  return r;
};

module.exports.VERSION = VERSION;
