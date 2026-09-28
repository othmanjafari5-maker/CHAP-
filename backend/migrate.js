require('dotenv').config({ quiet: true, path: require('node:path').join(__dirname, '.env') });
const pool = require('./db');
const fs = require('node:fs');
async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(fs.readFileSync(require('node:path').join(__dirname, 'schema.sql'), 'utf8'));
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
if (require.main === module) migrate().then(() => console.log('Schema ready')).catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end());
module.exports = migrate;
