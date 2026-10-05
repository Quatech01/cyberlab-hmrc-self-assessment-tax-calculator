'use strict';
const { body, validationResult } = require('express-validator');

function validate(rules) {
  return async (req, res, next) => {
    await Promise.all(rules.map(r => r.run(req)));
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ errors: errors.array() });
    }
    next();
  };
}

const registerRules = [
  body('username').trim().isLength({ min: 3, max: 30 }).matches(/^[a-zA-Z0-9_]+$/),
  body('email').trim().isEmail().normalizeEmail(),
  body('password').isLength({ min: 8, max: 128 }),
];

const loginRules = [
  body('username').trim().notEmpty(),
  body('password').notEmpty(),
];

const taxReturnRules = [
  body('tax_year').trim().matches(/^\d{4}-\d{2}$/),
  body('employment_income').isFloat({ min: 0, max: 10000000 }),
  body('employment_tax_paid').isFloat({ min: 0, max: 10000000 }),
  body('self_employment_profit').isFloat({ min: -10000000, max: 10000000 }),
  body('rental_income').isFloat({ min: 0, max: 10000000 }),
  body('rental_expenses').isFloat({ min: 0, max: 10000000 }),
  body('dividend_income').isFloat({ min: 0, max: 10000000 }),
  body('savings_interest').isFloat({ min: 0, max: 10000000 }),
  body('capital_gains').isFloat({ min: 0, max: 10000000 }),
  body('capital_losses').isFloat({ min: 0, max: 10000000 }),
  body('pension_contributions').isFloat({ min: 0, max: 10000000 }),
  body('gift_aid_donations').isFloat({ min: 0, max: 10000000 }),
  body('blind_persons_allowance').isInt({ min: 0, max: 1 }),
];

module.exports = { validate, registerRules, loginRules, taxReturnRules };
