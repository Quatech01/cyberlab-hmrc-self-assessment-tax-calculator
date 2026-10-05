CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at DATETIME NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS tax_returns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    tax_year TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    employment_income REAL NOT NULL DEFAULT 0,
    employment_tax_paid REAL NOT NULL DEFAULT 0,
    self_employment_profit REAL NOT NULL DEFAULT 0,
    rental_income REAL NOT NULL DEFAULT 0,
    rental_expenses REAL NOT NULL DEFAULT 0,
    dividend_income REAL NOT NULL DEFAULT 0,
    savings_interest REAL NOT NULL DEFAULT 0,
    capital_gains REAL NOT NULL DEFAULT 0,
    capital_losses REAL NOT NULL DEFAULT 0,
    pension_contributions REAL NOT NULL DEFAULT 0,
    gift_aid_donations REAL NOT NULL DEFAULT 0,
    blind_persons_allowance INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE (user_id, tax_year)
);

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,
    details TEXT,
    ip_address TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);
