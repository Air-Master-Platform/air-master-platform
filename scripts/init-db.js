'use strict';
// Creates tables. Run: npm run init-db
const fs = require('fs');
const path = require('path');
const db = require('../db');

(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
    await db.query(sql);
    console.log('Schema applied: users table ready.');
  } catch (err) {
    console.error('init-db failed:', err.message);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
})();
