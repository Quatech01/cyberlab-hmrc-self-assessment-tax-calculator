'use strict';
const express = require('express');
const { getDb } = require('../db/index');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// Admin/accountant: list all users
router.get('/users', requireAuth, requireRole('admin', 'accountant'), (req, res) => {
  const db = getDb();
  const users = db.prepare(
    'SELECT id, username, email, role, created_at FROM users ORDER BY id'
  ).all();
  res.json(users);
});

// Admin/accountant: list all tax returns
router.get('/returns', requireAuth, requireRole('admin', 'accountant'), (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT tr.*, u.username FROM tax_returns tr
    JOIN users u ON tr.user_id = u.id
    ORDER BY tr.updated_at DESC
  `).all();
  res.json(rows);
});

// Admin only: audit log
router.get('/audit', requireAuth, requireRole('admin'), (req, res) => {
  const db = getDb();
  const logs = db.prepare(`
    SELECT al.*, u.username FROM audit_log al
    LEFT JOIN users u ON al.user_id = u.id
    ORDER BY al.timestamp DESC LIMIT 200
  `).all();
  res.json(logs);
});

// Admin only: change user role
router.put('/users/:id/role', requireAuth, requireRole('admin'), (req, res) => {
  const { role } = req.body;
  if (!['user', 'accountant', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  const db = getDb();
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  res.json({ message: 'Role updated' });
});

module.exports = router;
