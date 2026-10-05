# HMRC Self-Assessment Tax Calculator

A full-stack UK self-assessment income tax calculation and filing preparation tool that demonstrates secure web application development with JWT authentication, role-based access control, and comprehensive DevSecOps practices.

## What This Demonstrates

This project shows how to build a financially sensitive web application securely. Tax data is among the most sensitive personal information — this app demonstrates how real-world financial services enforce data isolation (users only ever see their own returns), calculate sensitive figures server-side (client JS cannot manipulate tax amounts), and protect every state-changing request with CSRF tokens.

The tax calculation engine implements UK 2024–25 rates: the personal allowance taper above £100,000, NI Class 2 and Class 4 for the self-employed, dividend allowance (£500), CGT annual exemption (£3,000), and payment on account rules — exactly as HMRC's own systems compute them.

## How It Works

```
backend/          Express API with JWT auth, SQLite, and all DevSecOps controls
  routes/         auth.js (login/register/refresh), tax.js (returns + calculation), admin.js (RBAC)
  middleware/     auth.js (JWT verify), security.js (CSRF), validation.js (express-validator)
  db/             node:sqlite schema, seed data, connection singleton

frontend/         Self-contained SPA — no build step, no CDN, all CSS/JS inline
                  Multi-step return form, live calculator, tax breakdown chart on Canvas

tests/            node:test suite — 26 tests across health, auth, RBAC, headers, validation, business logic
```

The test suite proves: JWT auth (login, refresh, profile), RBAC enforcement (users blocked from admin routes), Helmet security headers on every response, CSRF rejection of missing tokens, input validation rejecting malformed data, and calculation correctness (PA taper, CGT exemption, NI Class 4, payment on account).

## Quick Start

```bash
# Install backend dependencies
cd backend && npm install && cd ..

# Run the server
cd backend && node index.js
# Open http://localhost:3000

# Run the test suite
cd tests && npm test
```

Demo accounts: `alice / AlicePass1!` | `admin / AdminPass123!`

## Example Tax Calculation

**Inputs:** Employment income £45,000, PAYE paid £6,486, self-employment profit £8,000

```json
{
  "personal_allowance": 12570,
  "taxable_income": 40430,
  "income_tax": 8086,
  "ni_class2": 179.40,
  "ni_class4": 1388.70,
  "total_tax_liability": 9654.10,
  "tax_already_paid": 6486,
  "tax_due": 3168.10,
  "payment_on_account": {
    "required": true,
    "first_payment": 1584.05,
    "second_payment": 1584.05,
    "first_due": "31 January",
    "second_due": "31 July"
  }
}
```

## Key Takeaways

- **Server-side calculations are non-negotiable for financial data.** The client submits raw income figures; the server calculates all tax amounts. If the client could submit a pre-calculated tax figure, it could claim zero liability on any income.
- **Personal allowance tapers** — above £100,000, the £12,570 allowance reduces by £1 for every £2 earned. At £125,140 it reaches zero, creating an effective 60% marginal rate between £100k and £125k.
- **Payment on account** — if your self-assessment tax bill exceeds £1,000 and less than 80% was collected at source via PAYE, HMRC requires two advance payments for the *next* year.
- **JWT with short access tokens (15 min) and revocable refresh tokens** — access tokens expire quickly to limit exposure if stolen; refresh tokens are stored server-side so a forced logout can invalidate them immediately.
- **CSRF double-submit cookie** — the server sets a readable cookie on login; every state-changing request must echo that value in `X-CSRF-Token`. A cross-origin attacker cannot read the cookie value due to the browser's same-origin policy.

## Further Reading

- [HMRC Self Assessment tax rates and allowances 2024–25](https://www.gov.uk/government/publications/rates-and-allowances-income-tax)
- [OWASP Top 10: Broken Access Control](https://owasp.org/Top10/A01_2021-Broken_Access_Control/)
- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
