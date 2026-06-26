require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function check() {
  try {
    const res = await pool.query('SELECT COUNT(*) FROM properties');
    console.log('Total properties in DB:', res.rows[0].count);
  } catch(e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
check();
