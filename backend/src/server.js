const config = require('./config');
const { open } = require('./db');
const { createApp } = require('./app');

const db = open();
if (db.prepare('SELECT COUNT(*) n FROM users').get().n === 0 && process.env.AUTO_SEED !== '0') {
  require('./seed').seed(db);
  console.log('Seeded demo data');
}
createApp(db).listen(config.port, '0.0.0.0', () => console.log(`Connectly API on :${config.port}`));
