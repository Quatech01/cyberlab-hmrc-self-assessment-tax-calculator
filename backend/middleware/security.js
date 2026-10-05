'use strict';
const crypto = require('node:crypto');

function csrfMiddleware(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const token = req.headers['x-csrf-token'];
  const cookie = req.cookies && req.cookies['csrf_token'];
  if (!token || !cookie || token !== cookie) {
    return res.status(403).json({ error: 'CSRF token mismatch' });
  }
  next();
}

function issueCsrfToken(res) {
  const token = crypto.randomUUID();
  res.cookie('csrf_token', token, { httpOnly: false, sameSite: 'strict', path: '/' });
  return token;
}

module.exports = { csrfMiddleware, issueCsrfToken };
