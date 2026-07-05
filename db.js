'use strict';
require('dotenv').config();
const { Pool } = require('pg');

// Prefer a connection URL if provided, else build from PG* vars.
// POSTGRES_URL is a non-reserved name (DATABASE_URL is managed/reserved by
// Vercel Postgres and can be blanked out); we accept either.
const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
    })
  : new Pool({
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT) || 5432,
      database: process.env.PGDATABASE,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      ssl: { rejectUnauthorized: false },
    });

pool.on('error', (err) => {
  console.error('Unexpected Postgres pool error:', err.message);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
