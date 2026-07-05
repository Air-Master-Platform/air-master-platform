'use strict';
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { runPlan } = require('./engine');
const { askAgent } = require('./agent');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Behind Vercel's edge/proxy: TLS is terminated upstream, so Express sees http
// internally. Trust the proxy so proto/secure detection is correct.
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// --- Stateless JWT session (survives serverless instances; no store) ---
// We sign a JWT with the user and store it in a plain httpOnly cookie that we
// set/read ourselves. This avoids cookie-session's HTTPS-detection quirks on
// Vercel that were silently dropping the Set-Cookie header.
const JWT_SECRET = process.env.SESSION_SECRET || 'dev-insecure-secret';
const SESSION_COOKIE = 'am_token';
const SESSION_MAX_AGE = 1000 * 60 * 60 * 8; // 8h

function setSession(res, user) {
  const token = jwt.sign({ user }, JWT_SECRET, { expiresIn: '8h' });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true, // served over HTTPS on Vercel; harmless locally via proxy trust
    maxAge: SESSION_MAX_AGE,
    path: '/',
  });
}

function clearSession(res) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

// Populate req.session.user from the JWT cookie so existing routes are unchanged.
app.use((req, res, next) => {
  req.session = {};
  const token = req.cookies && req.cookies[SESSION_COOKIE];
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.session.user = decoded.user;
    } catch {
      /* invalid/expired token → treated as logged out */
    }
  }
  next();
});

// --- auth guard ---
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.status(401).json({ error: 'Not authenticated' });
}

function requirePage(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.redirect('/login');
}

// --- pages ---
const pub = path.join(__dirname, 'public');

app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/app');
  return res.redirect('/login');
});

app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/app');
  res.sendFile(path.join(pub, 'login.html'));
});

app.get('/app', requirePage, (req, res) => {
  res.sendFile(path.join(pub, 'app.html'));
});

// static assets (css/js/logo). Page routes above take precedence.
// no-cache during active development so edited app.js/app.css always reload.
app.use(express.static(pub, {
  etag: true,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));

// --- auth API ---
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required.' });
  }
  try {
    const { rows } = await db.query(
      'SELECT id, username, password_hash, role FROM users WHERE username = $1',
      [username]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials.' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials.' });

    const sessionUser = { id: user.id, username: user.username, role: user.role };
    setSession(res, sessionUser);
    res.json({ ok: true, user: sessionUser });
  } catch (err) {
    console.error('login error:', err.message);
    res.status(500).json({ error: 'Server error. Check DB connection.' });
  }
});

app.post('/api/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: req.session.user });
});

// --- loading engine API ---
// Run the CargoFlow Python engine (build-up + balance + re-validate) on a
// manifest and return the plan as JSON. Shared runner in engine.js.
app.post('/api/loadplan', requireAuth, async (req, res) => {
  const { family, boxes } = req.body || {};
  const r = await runPlan({ family, boxes });
  if (r.ok) return res.json(r.plan);
  const code = /non-empty/.test(r.error) ? 400 : (/timed out/.test(r.error) ? 504 : 500);
  return res.status(code).json({ ok: false, error: r.error, stderr: r.stderr });
});

// --- door envelope API ---
// Serves the real cargo-door height/width/max-length matrix (the exact CSVs
// the Python engine reads for its door-envelope gate) so the front end can
// render a true-to-the-manual "why doesn't this fit" diagram. Parsed once,
// cached in memory (the CSVs are static reference data).
const DOOR_DATA_DIR = path.join(__dirname, 'engine', 'data');

function parseDoorCsv(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length);
  // line 0 = "Maximum Allowed Length (CM)" banner; line 1 = header row.
  const widthCols = lines[1].split(',').slice(1)
    .map((c) => c.trim()).filter((c) => c !== '').map(Number);
  const rows = [];
  for (let i = 2; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const height = Number(cols[0]);
    if (!Number.isFinite(height)) continue;
    const limits = [];
    for (let c = 0; c < widthCols.length; c++) {
      const v = cols[c + 1] !== undefined ? cols[c + 1].trim() : '';
      if (v !== '') limits.push({ width: widthCols[c], max_length: Number(v) });
    }
    rows.push({ height, limits });
  }
  // Ascending by height so "first bracket >= item height" lookups are simple.
  rows.sort((a, b) => a.height - b.height);
  return rows;
}

let doorEnvelopeCache = null;
function getDoorEnvelope() {
  if (!doorEnvelopeCache) {
    doorEnvelopeCache = {
      fwd: parseDoorCsv(path.join(DOOR_DATA_DIR, 'b737_800sf_door_fwd.csv')),
      aft: parseDoorCsv(path.join(DOOR_DATA_DIR, 'b737_800sf_door_aft.csv')),
    };
  }
  return doorEnvelopeCache;
}

app.get('/api/door-envelope', requireAuth, (req, res) => {
  try {
    res.json({ ok: true, ...getDoorEnvelope() });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Could not load door envelope data: ' + e.message });
  }
});

// --- agent API ---
// Send a message in a session. Creates the session if new, persists both
// the user message and the agent reply, then returns the reply.
app.post('/api/agent', requireAuth, async (req, res) => {
  const userId = req.session.user.id;
  let { message, session_id } = req.body || {};
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Message required.' });
  }
  try {
    // Ensure session exists (or create it).
    if (!session_id) session_id = crypto.randomUUID();
    const existing = await db.query(
      'SELECT id, name FROM chat_sessions WHERE id = $1 AND user_id = $2',
      [session_id, userId]
    );
    let isNew = false;
    if (existing.rowCount === 0) {
      isNew = true;
      // Name the thread from the first message (trimmed).
      const autoName = message.trim().slice(0, 48);
      await db.query(
        'INSERT INTO chat_sessions (id, user_id, name) VALUES ($1, $2, $3)',
        [session_id, userId, autoName]
      );
    } else {
      await db.query('UPDATE chat_sessions SET updated_at = now() WHERE id = $1', [session_id]);
    }

    // Persist user message.
    await db.query(
      'INSERT INTO chat_messages (id, session_id, user_id, role, content) VALUES ($1, $2, $3, $4, $5)',
      [crypto.randomUUID(), session_id, userId, 'user', message]
    );

    // Get agent reply + persist.
    const reply = await askAgent(message, { username: req.session.user.username, sessionId: session_id });
    await db.query(
      'INSERT INTO chat_messages (id, session_id, user_id, role, content) VALUES ($1, $2, $3, $4, $5)',
      [crypto.randomUUID(), session_id, userId, 'assistant', reply]
    );

    res.json({ reply, session_id, isNew });
  } catch (err) {
    console.error('agent error:', err.message);
    res.status(500).json({ error: 'Agent failed to respond.' });
  }
});

// --- chat history API ---
// List threads for the current user.
app.get('/api/chat-history/threads', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, name, updated_at FROM chat_sessions
       WHERE user_id = $1 ORDER BY updated_at DESC`,
      [req.session.user.id]
    );
    res.json({ threads: rows });
  } catch (err) {
    console.error('threads error:', err.message);
    res.status(500).json({ error: 'Failed to load threads.' });
  }
});

// Get messages for one thread.
app.get('/api/chat-history', requireAuth, async (req, res) => {
  const sessionId = req.query.session_id;
  if (!sessionId) return res.status(400).json({ error: 'session_id required.' });
  try {
    const { rows } = await db.query(
      `SELECT m.id, m.role, m.content, m.created_at
       FROM chat_messages m
       JOIN chat_sessions s ON s.id = m.session_id
       WHERE m.session_id = $1 AND s.user_id = $2
       ORDER BY m.created_at`,
      [sessionId, req.session.user.id]
    );
    res.json({ messages: rows });
  } catch (err) {
    console.error('chat-history error:', err.message);
    res.status(500).json({ error: 'Failed to load messages.' });
  }
});

// Rename a thread.
app.patch('/api/chat-history/threads/:id', requireAuth, async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name required.' });
  try {
    const r = await db.query(
      'UPDATE chat_sessions SET name = $1 WHERE id = $2 AND user_id = $3',
      [name.trim().slice(0, 80), req.params.id, req.session.user.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Thread not found.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('rename error:', err.message);
    res.status(500).json({ error: 'Failed to rename.' });
  }
});

// Delete a thread.
app.delete('/api/chat-history/threads/:id', requireAuth, async (req, res) => {
  try {
    const r = await db.query(
      'DELETE FROM chat_sessions WHERE id = $1 AND user_id = $2',
      [req.params.id, req.session.user.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Thread not found.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete.' });
  }
});

// On Vercel the platform imports the app; elsewhere (Fly, local) we listen.
// Bind 0.0.0.0 so Fly's proxy can reach the container.
if (!process.env.VERCEL) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Air Master platform on http://0.0.0.0:${PORT}`);
  });
}

module.exports = app;
