'use strict';
const express = require('express');
const { getDb } = require('../db/index');
const { requireAuth } = require('../middleware/auth');
const { validate, taxReturnRules } = require('../middleware/validation');

const router = express.Router();

// UK 2024-25 tax rates and thresholds
const TAX_RATES = {
  personalAllowance: 12570,
  basicRateLimit: 50270,
  higherRateLimit: 125140,
  basicRate: 0.20,
  higherRate: 0.40,
  additionalRate: 0.45,
  paReduceFrom: 100000,
  niClass2WeeklyRate: 3.45,
  niClass2Threshold: 12570,
  niClass4Lower: 12570,
  niClass4Upper: 50270,
  niClass4LowerRate: 0.09,
  niClass4UpperRate: 0.02,
  dividendAllowance: 500,
  dividendBasicRate: 0.0875,
  dividendHigherRate: 0.3375,
  dividendAdditionalRate: 0.3935,
  cgtAnnualExemption: 3000,
  cgtBasicRate: 0.10,
  cgtHigherRate: 0.20,
  paymentOnAccountThreshold: 1000,
};

function calculateTax(data) {
  const {
    employment_income = 0,
    employment_tax_paid = 0,
    self_employment_profit = 0,
    rental_income = 0,
    rental_expenses = 0,
    dividend_income = 0,
    savings_interest = 0,
    capital_gains = 0,
    capital_losses = 0,
    pension_contributions = 0,
    gift_aid_donations = 0,
    blind_persons_allowance = 0,
  } = data;

  const r = TAX_RATES;

  // Net rental profit
  const netRental = Math.max(0, rental_income - rental_expenses);

  // Total non-dividend non-CGT income
  const totalIncome = employment_income + self_employment_profit + netRental + savings_interest;

  // Personal allowance — taper above £100k (£1 reduction per £2 above)
  let pa = r.personalAllowance;
  if (blind_persons_allowance) pa += 3070; // 2024-25 blind person's allowance
  if (totalIncome > r.paReduceFrom) {
    const reduction = Math.floor((totalIncome - r.paReduceFrom) / 2);
    pa = Math.max(0, pa - reduction);
  }

  // Gross up gift aid donations to extend basic rate band
  const giftAidExtension = gift_aid_donations * (100 / 80 - 1); // basic rate relief added to bands
  const basicRateLimit = r.basicRateLimit + gift_aid_donations / 0.8 - gift_aid_donations + pension_contributions;
  const higherRateLimit = r.higherRateLimit + gift_aid_donations / 0.8 - gift_aid_donations + pension_contributions;

  // Taxable income after personal allowance
  const taxableIncome = Math.max(0, totalIncome - pa);

  // Income tax bands
  let incomeTax = 0;
  let basicRateUsed = 0;
  if (taxableIncome <= (basicRateLimit - pa)) {
    incomeTax = taxableIncome * r.basicRate;
    basicRateUsed = taxableIncome;
  } else if (taxableIncome <= (higherRateLimit - pa)) {
    const basic = basicRateLimit - pa;
    basicRateUsed = basic;
    incomeTax = basic * r.basicRate + (taxableIncome - basic) * r.higherRate;
  } else {
    const basic = basicRateLimit - pa;
    const higher = higherRateLimit - basicRateLimit;
    basicRateUsed = basic;
    incomeTax = basic * r.basicRate + higher * r.higherRate + (taxableIncome - basic - higher) * r.additionalRate;
  }

  // Dividend tax — taxed after other income, using remaining band
  const remainingBasic = Math.max(0, basicRateLimit - pa - taxableIncome);
  const taxableDividends = Math.max(0, dividend_income - r.dividendAllowance);
  let dividendTax = 0;
  if (taxableDividends > 0) {
    if (taxableDividends <= remainingBasic) {
      dividendTax = taxableDividends * r.dividendBasicRate;
    } else {
      const totalAboveBasic = totalIncome + taxableDividends;
      if (totalAboveBasic <= higherRateLimit) {
        dividendTax = remainingBasic * r.dividendBasicRate +
          (taxableDividends - remainingBasic) * r.dividendHigherRate;
      } else {
        dividendTax = remainingBasic * r.dividendBasicRate +
          Math.min(taxableDividends - remainingBasic, higherRateLimit - basicRateLimit) * r.dividendHigherRate +
          Math.max(0, taxableDividends - remainingBasic - (higherRateLimit - basicRateLimit)) * r.dividendAdditionalRate;
      }
    }
  }

  // Capital gains tax
  const netGains = Math.max(0, capital_gains - capital_losses - r.cgtAnnualExemption);
  const remainingBasicForCGT = Math.max(0, basicRateLimit - totalIncome - dividend_income);
  let cgt = 0;
  if (netGains > 0) {
    if (netGains <= remainingBasicForCGT) {
      cgt = netGains * r.cgtBasicRate;
    } else {
      cgt = remainingBasicForCGT * r.cgtBasicRate +
        (netGains - remainingBasicForCGT) * r.cgtHigherRate;
    }
  }

  // NI Class 2 (self-employed, flat weekly rate)
  let niClass2 = 0;
  if (self_employment_profit > r.niClass2Threshold) {
    niClass2 = r.niClass2WeeklyRate * 52;
  }

  // NI Class 4 (self-employed, on profits)
  let niClass4 = 0;
  if (self_employment_profit > r.niClass4Lower) {
    const band1 = Math.min(self_employment_profit, r.niClass4Upper) - r.niClass4Lower;
    const band2 = Math.max(0, self_employment_profit - r.niClass4Upper);
    niClass4 = band1 * r.niClass4LowerRate + band2 * r.niClass4UpperRate;
  }

  const totalTaxLiability = incomeTax + dividendTax + cgt + niClass2 + niClass4;
  const taxAlreadyPaid = employment_tax_paid;
  const taxDue = Math.max(0, totalTaxLiability - taxAlreadyPaid);
  const taxRefund = Math.max(0, taxAlreadyPaid - totalTaxLiability);

  // Payment on account: due if tax owed > £1000 and < 80% collected at source
  let paymentOnAccount = null;
  if (taxDue > r.paymentOnAccountThreshold) {
    const paye_fraction = taxAlreadyPaid / (totalTaxLiability || 1);
    if (paye_fraction < 0.8) {
      paymentOnAccount = {
        required: true,
        first_payment: round2(taxDue / 2),
        second_payment: round2(taxDue / 2),
        first_due: '31 January',
        second_due: '31 July',
      };
    }
  }
  if (!paymentOnAccount) paymentOnAccount = { required: false };

  return {
    personal_allowance: round2(pa),
    taxable_income: round2(taxableIncome),
    income_tax: round2(incomeTax),
    dividend_tax: round2(dividendTax),
    capital_gains_tax: round2(cgt),
    ni_class2: round2(niClass2),
    ni_class4: round2(niClass4),
    total_tax_liability: round2(totalTaxLiability),
    tax_already_paid: round2(taxAlreadyPaid),
    tax_due: round2(taxDue),
    tax_refund: round2(taxRefund),
    payment_on_account: paymentOnAccount,
    breakdown: {
      basic_rate_band: { rate: '20%', amount: round2(Math.min(taxableIncome, Math.max(0, basicRateLimit - pa))) },
      higher_rate_band: { rate: '40%', amount: round2(Math.max(0, taxableIncome - Math.max(0, basicRateLimit - pa))) },
    },
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Calculate without saving
router.post('/calculate', requireAuth, (req, res) => {
  const result = calculateTax(req.body);
  res.json(result);
});

// List current user's returns
router.get('/returns', requireAuth, (req, res) => {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM tax_returns WHERE user_id = ? ORDER BY tax_year DESC'
  ).all(req.user.sub);
  res.json(rows);
});

// Get a specific return (own or admin/accountant)
router.get('/returns/:id', requireAuth, (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM tax_returns WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.user_id !== req.user.sub && !['admin', 'accountant'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const calculation = calculateTax(row);
  res.json({ ...row, calculation });
});

// Create or update a draft return
router.post('/returns', requireAuth, validate(taxReturnRules), (req, res) => {
  const db = getDb();
  const { tax_year } = req.body;

  const existing = db.prepare(
    'SELECT id FROM tax_returns WHERE user_id = ? AND tax_year = ?'
  ).get(req.user.sub, tax_year);
  if (existing) return res.status(409).json({ error: 'Return for this tax year already exists' });

  const fields = [
    'tax_year', 'employment_income', 'employment_tax_paid',
    'self_employment_profit', 'rental_income', 'rental_expenses',
    'dividend_income', 'savings_interest', 'capital_gains', 'capital_losses',
    'pension_contributions', 'gift_aid_donations', 'blind_persons_allowance',
  ];
  const values = fields.map(f => req.body[f] ?? 0);

  const result = db.prepare(`
    INSERT INTO tax_returns (user_id, ${fields.join(',')})
    VALUES (?, ${fields.map(() => '?').join(',')})
  `).run(req.user.sub, ...values);

  db.prepare('INSERT INTO audit_log (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)').run(
    req.user.sub, 'create_return', `tax_year=${tax_year}`, req.ip
  );

  const newRow = db.prepare('SELECT * FROM tax_returns WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ ...newRow, calculation: calculateTax(newRow) });
});

// Update a draft return (owner only)
router.put('/returns/:id', requireAuth, validate(taxReturnRules), (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM tax_returns WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.user_id !== req.user.sub) return res.status(403).json({ error: 'Forbidden' });
  if (row.status === 'submitted') return res.status(400).json({ error: 'Cannot edit a submitted return' });

  const fields = [
    'employment_income', 'employment_tax_paid',
    'self_employment_profit', 'rental_income', 'rental_expenses',
    'dividend_income', 'savings_interest', 'capital_gains', 'capital_losses',
    'pension_contributions', 'gift_aid_donations', 'blind_persons_allowance',
  ];

  db.prepare(`
    UPDATE tax_returns SET
      ${fields.map(f => `${f} = ?`).join(', ')},
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(...fields.map(f => req.body[f] ?? row[f]), row.id);

  db.prepare('INSERT INTO audit_log (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)').run(
    req.user.sub, 'update_return', `id=${row.id}`, req.ip
  );

  const updated = db.prepare('SELECT * FROM tax_returns WHERE id = ?').get(row.id);
  res.json({ ...updated, calculation: calculateTax(updated) });
});

// Submit a return (lock it)
router.post('/returns/:id/submit', requireAuth, (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM tax_returns WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.user_id !== req.user.sub) return res.status(403).json({ error: 'Forbidden' });
  if (row.status === 'submitted') return res.status(400).json({ error: 'Already submitted' });

  db.prepare("UPDATE tax_returns SET status = 'submitted', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(row.id);
  db.prepare('INSERT INTO audit_log (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)').run(
    req.user.sub, 'submit_return', `id=${row.id}`, req.ip
  );

  const submitted = db.prepare('SELECT * FROM tax_returns WHERE id = ?').get(row.id);
  res.json({ ...submitted, calculation: calculateTax(submitted) });
});

module.exports = { router, calculateTax };
