'use strict';
// Creates (or resets) an admin user. Run: npm run seed-admin
// Optional env overrides: ADMIN_USER, ADMIN_PASS
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');

(async () => {
  const username = process.env.ADMIN_USER || 'admin';
  // Use given password, else generate a readable random one.
  const password =
    process.env.ADMIN_PASS || crypto.randomBytes(9).toString('base64url');

  try {
    const hash = await bcrypt.hash(password, 10);
    await db.query(
      `INSERT INTO users (username, password_hash, role)
       VALUES ($1, $2, 'admin')
       ON CONFLICT (username)
       DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin'`,
      [username, hash]
    );
    console.log('--------------------------------------------');
    console.log('Admin user ready. Use these to log in:');
    console.log('  username:', username);
    console.log('  password:', password);
    console.log('--------------------------------------------');
    if (!process.env.ADMIN_PASS) {
      console.log('(Password was auto-generated. Save it now.)');
    }
  } catch (err) {
    console.error('seed-admin failed:', err.message);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
})();
