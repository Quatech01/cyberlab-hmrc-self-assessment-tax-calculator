'use strict';
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('node:path');

const authRouter = require('./routes/auth');
const { router: taxRouter } = require('./routes/tax');
const adminRouter = require('./routes/admin');
const { csrfMiddleware } = require('./middleware/security');
const { seed } = require('./db/seed');

const app = express();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true },
}));

app.use(express.json());

// Parse cookies manually (no dependency needed for simple string parsing)
app.use((req, res, next) => {
  const raw = req.headers.cookie || '';
  req.cookies = Object.fromEntries(
    raw.split(';')
      .map(p => p.trim().split('='))
      .filter(p => p.length === 2)
      .map(([k, v]) => [k.trim(), v.trim()])
  );
  next();
});

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
const apiLimiter  = rateLimit({ windowMs: 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false });

app.use('/api/auth', authLimiter);
app.use('/api/', apiLimiter);
// Auth routes issue the CSRF token — they must not require it
app.use('/api/tax', csrfMiddleware);
app.use('/api/admin', csrfMiddleware);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRouter);
app.use('/api/tax', taxRouter);
app.use('/api/admin', adminRouter);

// Serve frontend
app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

function start(port = 3000) {
  return new Promise((resolve, reject) => {
    seed().then(() => {
      const server = app.listen(port, '127.0.0.1', () => resolve(server));
      server.on('error', reject);
    }).catch(reject);
  });
}

module.exports = { app, start };

if (require.main === module) {
  start(3000).then(() => console.log('Server running on http://127.0.0.1:3000'));
}
