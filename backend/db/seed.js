'use strict';
const bcrypt = require('bcryptjs');
const { getDb } = require('./index');

async function seed() {
  const db = getDb();

  const users = [
    { username: 'admin', email: 'admin@example.com', password: 'AdminPass123!', role: 'admin' },
    { username: 'accountant01', email: 'accountant@example.com', password: 'Accountant1!', role: 'accountant' },
    { username: 'alice', email: 'alice@example.com', password: 'AlicePass1!', role: 'user' },
    { username: 'bob', email: 'bob@example.com', password: 'BobPass123!', role: 'user' },
    { username: 'carol', email: 'carol@example.com', password: 'CarolPass1!', role: 'user' },
  ];

  for (const u of users) {
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(u.username);
    if (!existing) {
      const hash = await bcrypt.hash(u.password, 12);
      db.prepare(
        'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)'
      ).run(u.username, u.email, hash, u.role);
    }
  }

  const aliceId = db.prepare('SELECT id FROM users WHERE username = ?').get('alice').id;
  const bobId   = db.prepare('SELECT id FROM users WHERE username = ?').get('bob').id;

  const returns = [
    {
      user_id: aliceId, tax_year: '2023-24',
      employment_income: 45000, employment_tax_paid: 6486,
      self_employment_profit: 8000,
      rental_income: 6000, rental_expenses: 1500,
      dividend_income: 1200, savings_interest: 300,
      capital_gains: 5000, capital_losses: 0,
      pension_contributions: 2000, gift_aid_donations: 500,
      blind_persons_allowance: 0, status: 'submitted'
    },
    {
      user_id: aliceId, tax_year: '2024-25',
      employment_income: 52000, employment_tax_paid: 7900,
      self_employment_profit: 12000,
      rental_income: 8400, rental_expenses: 2000,
      dividend_income: 2000, savings_interest: 600,
      capital_gains: 8000, capital_losses: 1000,
      pension_contributions: 3000, gift_aid_donations: 1000,
      blind_persons_allowance: 0, status: 'draft'
    },
    {
      user_id: bobId, tax_year: '2024-25',
      employment_income: 28000, employment_tax_paid: 3086,
      self_employment_profit: 0,
      rental_income: 0, rental_expenses: 0,
      dividend_income: 400, savings_interest: 100,
      capital_gains: 0, capital_losses: 0,
      pension_contributions: 500, gift_aid_donations: 0,
      blind_persons_allowance: 0, status: 'draft'
    },
  ];

  for (const r of returns) {
    const existing = db.prepare(
      'SELECT id FROM tax_returns WHERE user_id = ? AND tax_year = ?'
    ).get(r.user_id, r.tax_year);
    if (!existing) {
      db.prepare(`
        INSERT INTO tax_returns
          (user_id, tax_year, status, employment_income, employment_tax_paid,
           self_employment_profit, rental_income, rental_expenses,
           dividend_income, savings_interest, capital_gains, capital_losses,
           pension_contributions, gift_aid_donations, blind_persons_allowance)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        r.user_id, r.tax_year, r.status,
        r.employment_income, r.employment_tax_paid,
        r.self_employment_profit, r.rental_income, r.rental_expenses,
        r.dividend_income, r.savings_interest,
        r.capital_gains, r.capital_losses,
        r.pension_contributions, r.gift_aid_donations,
        r.blind_persons_allowance
      );
    }
  }

  console.log('Seed complete');
}

module.exports = { seed };
