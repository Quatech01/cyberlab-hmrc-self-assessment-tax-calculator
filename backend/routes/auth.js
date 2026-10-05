'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const { getDb } = require('../db/index');
const { signAccess, signRefresh, verifyToken } = require('../middleware/auth');
const { issueCsrfToken } = require('../middleware/security');
const { validate, registerRules, loginRules } = require('../middleware/validation');

const router = express.Router();

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

router.post('/register', validate(registerRules), async (req, res) => {
  const { username, email, password } = req.body;
  const db = getDb();
  try {
    const exists = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email);
    if (exists) return res.status(409).json({ error: 'Username or email already taken' });

    const hash = await bcrypt.hash(password, 12);
    const result = db.prepare(
      'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)'
    ).run(username, email, hash, 'user');

    db.prepare('INSERT INTO audit_log (user_id, action, ip_address) VALUES (?, ?, ?)').run(
      result.lastInsertRowid, 'register', req.ip
    );

    res.status(201).json({ message: 'Account created', userId: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', validate(loginRules), async (req, res) => {
  const { username, password } = req.body;
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  const payload = { sub: user.id, username: user.username, role: user.role };
  const accessToken = signAccess(payload);
  const refreshToken = signRefresh(payload);

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)'
  ).run(user.id, hashToken(refreshToken), expiresAt);

  db.prepare('INSERT INTO audit_log (user_id, action, ip_address) VALUES (?, ?, ?)').run(
    user.id, 'login', req.ip
  );

  const csrfToken = issueCsrfToken(res);
  res.json({ access_token: accessToken, refresh_token: refreshToken, csrf_token: csrfToken, role: user.role });
});

router.post('/refresh', (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) return res.status(401).json({ error: 'Missing refresh token' });

  let payload;
  try {
    payload = verifyToken(refresh_token);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }

  const db = getDb();
  const stored = db.prepare(
    'SELECT * FROM refresh_tokens WHERE token_hash = ? AND revoked = 0'
  ).get(hashToken(refresh_token));

  if (!stored || new Date(stored.expires_at) < new Date()) {
    return res.status(401).json({ error: 'Refresh token revoked or expired' });
  }

  db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?').run(stored.id);

  const newPayload = { sub: payload.sub, username: payload.username, role: payload.role };
  const accessToken = signAccess(newPayload);
  const newRefresh = signRefresh(newPayload);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)'
  ).run(payload.sub, hashToken(newRefresh), expiresAt);

  const csrfToken = issueCsrfToken(res);
  res.json({ access_token: accessToken, refresh_token: newRefresh, csrf_token: csrfToken });
});

router.post('/logout', (req, res) => {
  const { refresh_token } = req.body;
  if (refresh_token) {
    const db = getDb();
    db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?').run(hashToken(refresh_token));
  }
  res.clearCookie('csrf_token');
  res.json({ message: 'Logged out' });
});

router.get('/me', (req, res) => {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthenticated' });
  try {
    const payload = verifyToken(header.slice(7));
    const db = getDb();
    const user = db.prepare('SELECT id, username, email, role, created_at FROM users WHERE id = ?').get(payload.sub);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

module.exports = router;
