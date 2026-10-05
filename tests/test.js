'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { start } = require('../backend/index.js');

let server, baseUrl;

before(async () => {
  const { existsSync, unlinkSync } = require('node:fs');
  const path = require('node:path');
  const dbPath = path.join(__dirname, '../backend/db/cyberlab.db');
  for (const p of [dbPath, dbPath + '-shm', dbPath + '-wal']) {
    if (existsSync(p)) unlinkSync(p);
  }
  const port = 4000 + Math.floor(Math.random() * 900);
  server = await start(port);
  baseUrl = `http://127.0.0.1:${port}`;
});

after(() => { server.close(); });

async function api(path, opts = {}) {
  const { headers: extraHeaders, ...restOpts } = opts;
  const res = await fetch(`${baseUrl}/api${path}`, {
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    ...restOpts,
  });
  return res;
}

let adminToken, adminCsrf;
let userToken, userCsrf;
let anotherToken, anotherCsrf;
let returnId;
const testUsername = `testuser${Date.now()}`;

// ─── Group 1: Health ─────────────────────────────────────────────────────────
describe('Health', () => {
  it('GET /health returns 200 and status ok', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, 'ok');
  });
});

// ─── Group 2: Auth flow ───────────────────────────────────────────────────────
describe('Auth flow', () => {
  it('POST /auth/register creates a new user', async () => {
    const res = await api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: testUsername, email: `${testUsername}@example.com`, password: 'TestPass99!' }),
    });
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.ok(body.userId, 'should return userId');
  });

  it('POST /auth/register with duplicate username returns 409', async () => {
    const res = await api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: testUsername, email: `other${testUsername}@example.com`, password: 'TestPass99!' }),
    });
    assert.strictEqual(res.status, 409);
  });

  it('POST /auth/login with correct credentials returns tokens', async () => {
    const res = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'alice', password: 'AlicePass1!' }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.access_token, 'should have access_token');
    assert.ok(body.refresh_token, 'should have refresh_token');
    assert.ok(body.csrf_token, 'should have csrf_token');
    userToken = body.access_token;
    userCsrf = body.csrf_token;
  });

  it('POST /auth/login with wrong password returns 401', async () => {
    const res = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'alice', password: 'wrongpassword' }),
    });
    assert.strictEqual(res.status, 401);
  });

  it('GET /auth/me without token returns 401', async () => {
    const res = await api('/auth/me');
    assert.strictEqual(res.status, 401);
  });

  it('GET /auth/me with valid token returns user profile', async () => {
    const res = await api('/auth/me', {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.username, 'alice');
  });

  it('POST /auth/login for admin user returns tokens', async () => {
    const res = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: 'AdminPass123!' }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    adminToken = body.access_token;
    adminCsrf = body.csrf_token;
    assert.strictEqual(body.role, 'admin');
  });

  it('POST /auth/login for bob user', async () => {
    const res = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'bob', password: 'BobPass123!' }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    anotherToken = body.access_token;
    anotherCsrf = body.csrf_token;
  });
});

// ─── Group 3: RBAC ────────────────────────────────────────────────────────────
describe('RBAC', () => {
  it('Admin can GET /admin/users', async () => {
    const res = await api('/admin/users', {
      headers: { Authorization: `Bearer ${adminToken}`, 'X-CSRF-Token': adminCsrf, Cookie: `csrf_token=${adminCsrf}` },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body), 'should return array of users');
  });

  it('Regular user cannot GET /admin/users (403)', async () => {
    const res = await api('/admin/users', {
      headers: { Authorization: `Bearer ${userToken}`, 'X-CSRF-Token': userCsrf, Cookie: `csrf_token=${userCsrf}` },
    });
    assert.strictEqual(res.status, 403);
  });

  it('Unauthenticated request to /admin/users returns 401', async () => {
    const res = await api('/admin/users');
    assert.strictEqual(res.status, 401);
  });

  it('Admin can GET /admin/audit', async () => {
    const res = await api('/admin/audit', {
      headers: { Authorization: `Bearer ${adminToken}`, 'X-CSRF-Token': adminCsrf, Cookie: `csrf_token=${adminCsrf}` },
    });
    assert.strictEqual(res.status, 200);
  });
});

// ─── Group 4: Security headers ────────────────────────────────────────────────
describe('Security headers', () => {
  it('Response includes X-Content-Type-Options: nosniff', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
  });

  it('Response includes X-Frame-Options: SAMEORIGIN or DENY', async () => {
    const res = await fetch(`${baseUrl}/health`);
    const xfo = res.headers.get('x-frame-options');
    assert.ok(xfo && (xfo === 'SAMEORIGIN' || xfo === 'DENY'), `Expected X-Frame-Options, got: ${xfo}`);
  });

  it('Response includes Content-Security-Policy header', async () => {
    const res = await fetch(`${baseUrl}/health`);
    const csp = res.headers.get('content-security-policy');
    assert.ok(csp && csp.includes('default-src'), `CSP header missing or malformed: ${csp}`);
  });

  it('Response includes Strict-Transport-Security header', async () => {
    const res = await fetch(`${baseUrl}/health`);
    const hsts = res.headers.get('strict-transport-security');
    assert.ok(hsts && hsts.includes('max-age'), `HSTS header missing: ${hsts}`);
  });
});

// ─── Group 5: Input validation ────────────────────────────────────────────────
describe('Input validation', () => {
  it('Register with empty username returns 422', async () => {
    const res = await api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: '', email: 'new@example.com', password: 'SomePass1!' }),
    });
    assert.ok([400, 422].includes(res.status), `Expected 400/422, got ${res.status}`);
  });

  it('Register with invalid email returns 422', async () => {
    const res = await api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: 'validuser', email: 'not-an-email', password: 'SomePass1!' }),
    });
    assert.ok([400, 422].includes(res.status));
  });

  it('SQL injection string in username does not crash server', async () => {
    const res = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: "' OR '1'='1", password: 'anything' }),
    });
    assert.ok([400, 401, 422].includes(res.status), `Expected 400/401/422, got ${res.status}`);
  });

  it('Tax return with negative income field is rejected', async () => {
    const res = await api('/tax/returns', {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}`, 'X-CSRF-Token': userCsrf, Cookie: `csrf_token=${userCsrf}` },
      body: JSON.stringify({
        tax_year: '2022-23', employment_income: -5000, employment_tax_paid: 0,
        self_employment_profit: 0, rental_income: 0, rental_expenses: 0,
        dividend_income: 0, savings_interest: 0, capital_gains: 0, capital_losses: 0,
        pension_contributions: 0, gift_aid_donations: 0, blind_persons_allowance: 0,
      }),
    });
    assert.ok([400, 422].includes(res.status));
  });
});

// ─── Group 6: Business logic ──────────────────────────────────────────────────
describe('Business logic', () => {
  it('POST /tax/calculate returns correct personal allowance', async () => {
    const res = await api('/tax/calculate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}`, 'X-CSRF-Token': userCsrf, Cookie: `csrf_token=${userCsrf}` },
      body: JSON.stringify({
        employment_income: 30000, employment_tax_paid: 3486,
        self_employment_profit: 0, rental_income: 0, rental_expenses: 0,
        dividend_income: 0, savings_interest: 0, capital_gains: 0, capital_losses: 0,
        pension_contributions: 0, gift_aid_donations: 0, blind_persons_allowance: 0,
      }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.personal_allowance, 12570, 'Standard PA should be £12,570');
    assert.ok(body.income_tax > 0, 'Income tax should be positive');
    assert.ok(typeof body.tax_due === 'number');
  });

  it('POST /tax/calculate tapers personal allowance above £100k', async () => {
    const res = await api('/tax/calculate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}`, 'X-CSRF-Token': userCsrf, Cookie: `csrf_token=${userCsrf}` },
      body: JSON.stringify({
        employment_income: 110000, employment_tax_paid: 35000,
        self_employment_profit: 0, rental_income: 0, rental_expenses: 0,
        dividend_income: 0, savings_interest: 0, capital_gains: 0, capital_losses: 0,
        pension_contributions: 0, gift_aid_donations: 0, blind_persons_allowance: 0,
      }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.personal_allowance < 12570, `PA should be tapered below £12,570 at £110k income, got ${body.personal_allowance}`);
  });

  it('POST /tax/calculate CGT uses £3,000 annual exemption', async () => {
    const res = await api('/tax/calculate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}`, 'X-CSRF-Token': userCsrf, Cookie: `csrf_token=${userCsrf}` },
      body: JSON.stringify({
        employment_income: 0, employment_tax_paid: 0,
        self_employment_profit: 0, rental_income: 0, rental_expenses: 0,
        dividend_income: 0, savings_interest: 0, capital_gains: 2000, capital_losses: 0,
        pension_contributions: 0, gift_aid_donations: 0, blind_persons_allowance: 0,
      }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.capital_gains_tax, 0, 'Gains under £3k exemption should produce zero CGT');
  });

  it('POST /tax/returns creates a new draft return', async () => {
    const res = await api('/tax/returns', {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}`, 'X-CSRF-Token': userCsrf, Cookie: `csrf_token=${userCsrf}` },
      body: JSON.stringify({
        tax_year: '2022-23', employment_income: 45000, employment_tax_paid: 6000,
        self_employment_profit: 0, rental_income: 0, rental_expenses: 0,
        dividend_income: 0, savings_interest: 0, capital_gains: 0, capital_losses: 0,
        pension_contributions: 0, gift_aid_donations: 0, blind_persons_allowance: 0,
      }),
    });
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.status, 'draft');
    assert.ok(body.calculation, 'should include calculation');
    returnId = body.id;
  });

  it('GET /tax/returns lists own returns', async () => {
    const res = await api('/tax/returns', {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body));
    assert.ok(body.length >= 1, 'alice should have at least one return');
  });

  it('PUT /tax/returns/:id updates own draft', async () => {
    const res = await api(`/tax/returns/${returnId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${userToken}`, 'X-CSRF-Token': userCsrf, Cookie: `csrf_token=${userCsrf}` },
      body: JSON.stringify({
        tax_year: '2022-23', employment_income: 50000, employment_tax_paid: 7500,
        self_employment_profit: 0, rental_income: 0, rental_expenses: 0,
        dividend_income: 0, savings_interest: 0, capital_gains: 0, capital_losses: 0,
        pension_contributions: 0, gift_aid_donations: 0, blind_persons_allowance: 0,
      }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.employment_income, 50000);
  });

  it('Another user cannot update the return (403)', async () => {
    const res = await api(`/tax/returns/${returnId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${anotherToken}`, 'X-CSRF-Token': anotherCsrf, Cookie: `csrf_token=${anotherCsrf}` },
      body: JSON.stringify({
        tax_year: '2022-23', employment_income: 99999, employment_tax_paid: 0,
        self_employment_profit: 0, rental_income: 0, rental_expenses: 0,
        dividend_income: 0, savings_interest: 0, capital_gains: 0, capital_losses: 0,
        pension_contributions: 0, gift_aid_donations: 0, blind_persons_allowance: 0,
      }),
    });
    assert.strictEqual(res.status, 403);
  });

  it('POST /tax/returns/:id/submit locks the return', async () => {
    const res = await api(`/tax/returns/${returnId}/submit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}`, 'X-CSRF-Token': userCsrf, Cookie: `csrf_token=${userCsrf}` },
      body: JSON.stringify({}),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, 'submitted');
  });

  it('Cannot edit a submitted return (400)', async () => {
    const res = await api(`/tax/returns/${returnId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${userToken}`, 'X-CSRF-Token': userCsrf, Cookie: `csrf_token=${userCsrf}` },
      body: JSON.stringify({
        tax_year: '2022-23', employment_income: 55000, employment_tax_paid: 8000,
        self_employment_profit: 0, rental_income: 0, rental_expenses: 0,
        dividend_income: 0, savings_interest: 0, capital_gains: 0, capital_losses: 0,
        pension_contributions: 0, gift_aid_donations: 0, blind_persons_allowance: 0,
      }),
    });
    assert.strictEqual(res.status, 400);
  });

  it('Duplicate tax year return is rejected (409)', async () => {
    const res = await api('/tax/returns', {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}`, 'X-CSRF-Token': userCsrf, Cookie: `csrf_token=${userCsrf}` },
      body: JSON.stringify({
        tax_year: '2022-23', employment_income: 1000, employment_tax_paid: 0,
        self_employment_profit: 0, rental_income: 0, rental_expenses: 0,
        dividend_income: 0, savings_interest: 0, capital_gains: 0, capital_losses: 0,
        pension_contributions: 0, gift_aid_donations: 0, blind_persons_allowance: 0,
      }),
    });
    assert.strictEqual(res.status, 409);
  });

  it('POST /tax/calculate NI Class 4 applied on self-employment profit', async () => {
    const res = await api('/tax/calculate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}`, 'X-CSRF-Token': userCsrf, Cookie: `csrf_token=${userCsrf}` },
      body: JSON.stringify({
        employment_income: 0, employment_tax_paid: 0,
        self_employment_profit: 30000, rental_income: 0, rental_expenses: 0,
        dividend_income: 0, savings_interest: 0, capital_gains: 0, capital_losses: 0,
        pension_contributions: 0, gift_aid_donations: 0, blind_persons_allowance: 0,
      }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.ni_class4 > 0, 'NI Class 4 should be > 0 for profit of £30k');
    assert.ok(body.ni_class2 > 0, 'NI Class 2 should be > 0 for profit above threshold');
  });

  it('CSRF protection rejects state-changing request without token', async () => {
    const res = await fetch(`${baseUrl}/api/tax/returns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({
        tax_year: '2021-22', employment_income: 25000, employment_tax_paid: 2000,
        self_employment_profit: 0, rental_income: 0, rental_expenses: 0,
        dividend_income: 0, savings_interest: 0, capital_gains: 0, capital_losses: 0,
        pension_contributions: 0, gift_aid_donations: 0, blind_persons_allowance: 0,
      }),
    });
    assert.strictEqual(res.status, 403, 'CSRF check should reject request missing X-CSRF-Token');
  });

  it('Admin can see all returns via /admin/returns', async () => {
    const res = await api('/admin/returns', {
      headers: { Authorization: `Bearer ${adminToken}`, 'X-CSRF-Token': adminCsrf, Cookie: `csrf_token=${adminCsrf}` },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body));
    assert.ok(body.length >= 2, 'Admin should see returns from multiple users');
  });

  it('GET /tax/returns/:id another user cannot view (403)', async () => {
    const res = await api(`/tax/returns/${returnId}`, {
      headers: { Authorization: `Bearer ${anotherToken}` },
    });
    assert.strictEqual(res.status, 403);
  });

  it('POST /tax/calculate returns payment_on_account when tax due exceeds £1000', async () => {
    const res = await api('/tax/calculate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}`, 'X-CSRF-Token': userCsrf, Cookie: `csrf_token=${userCsrf}` },
      body: JSON.stringify({
        employment_income: 0, employment_tax_paid: 0,
        self_employment_profit: 40000, rental_income: 0, rental_expenses: 0,
        dividend_income: 0, savings_interest: 0, capital_gains: 0, capital_losses: 0,
        pension_contributions: 0, gift_aid_donations: 0, blind_persons_allowance: 0,
      }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.payment_on_account, 'should include payment_on_account field');
    assert.strictEqual(body.payment_on_account.required, true, 'self-employed with no PAYE should require payment on account');
  });
});
