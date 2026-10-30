const config = require('./config');
const { open } = require('./db');
const { createApp } = require('./app');

const db = open();
if (db.prepare('SELECT COUNT(*) n FROM users').get().n === 0 && process.env.AUTO_SEED !== '0') {
  require('./seed').seed(db);
  console.log('Seeded demo data');
}
const app = createApp(db);
app.ctx.jobs.start(1000); // durable job worker: auction timers, refunds, alerts
app.listen(config.port, '0.0.0.0', () => {
  console.log(`Connectly API on :${config.port}`);
  const lan = Object.values(require('os').networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  if (require('fs').existsSync(require('path').join(__dirname, '..', 'web', 'index.html'))) {
    console.log(`\n  Open the app:  http://localhost:${config.port}`);
    lan.forEach((ip) => console.log(`  On your phone (same Wi-Fi):  http://${ip}:${config.port}`));
    console.log('  Demo login:    demo@connectly.app / demo1234   (phone sign-in code: 123456)\n');
  }
});
