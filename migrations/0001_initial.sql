-- CHOG Eligibility Verifier - Initial Schema
-- Migration: 0001_initial.sql

-- Profiles: Telegram handles with edit secrets
CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    telegram_handle TEXT NOT NULL,
    edit_secret_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Unique index on normalized telegram handle (lowercase)
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_handle 
ON profiles (lower(telegram_handle));

-- Wallets: Linked addresses (globally unique to prevent multi-profile linking)
CREATE TABLE IF NOT EXISTS wallets (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    address TEXT NOT NULL,
    wallet_rdns TEXT,
    verified_at INTEGER,
    last_checked_at INTEGER,
    last_direct_chog_raw TEXT,
    last_lp_chog_raw TEXT,
    last_total_chog_raw TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    error_reason TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

-- Each wallet address can only be linked to ONE profile globally
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallets_address 
ON wallets (lower(address));

-- Index for profile lookups
CREATE INDEX IF NOT EXISTS idx_wallets_profile 
ON wallets (profile_id);

-- Nonces: SIWE replay protection
CREATE TABLE IF NOT EXISTS nonces (
    nonce TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

-- Cleanup expired nonces
CREATE INDEX IF NOT EXISTS idx_nonces_expires 
ON nonces (expires_at);

-- LP Pairs: Whitelisted V2 LP pair contracts for CHOG exposure
CREATE TABLE IF NOT EXISTS lp_pairs (
    pair_address TEXT PRIMARY KEY,
    name TEXT,
    token0 TEXT NOT NULL,
    token1 TEXT NOT NULL,
    chog_side INTEGER NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
);

-- Screening runs: Audit log for daily cron jobs
CREATE TABLE IF NOT EXISTS screening_runs (
    id TEXT PRIMARY KEY,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    status TEXT NOT NULL DEFAULT 'running',
    error TEXT,
    profiles_processed INTEGER NOT NULL DEFAULT 0,
    wallets_processed INTEGER NOT NULL DEFAULT 0,
    eligible_count INTEGER NOT NULL DEFAULT 0,
    message_sent INTEGER NOT NULL DEFAULT 0
);

-- Profile snapshots: Per-run eligibility snapshots
CREATE TABLE IF NOT EXISTS profile_snapshots (
    run_id TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    total_chog_raw TEXT NOT NULL,
    eligible INTEGER NOT NULL,
    details_json TEXT NOT NULL,
    PRIMARY KEY (run_id, profile_id),
    FOREIGN KEY (run_id) REFERENCES screening_runs(id) ON DELETE CASCADE,
    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

-- Settings: KV config store
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Insert default settings
INSERT OR IGNORE INTO settings (key, value) VALUES 
    ('chog_decimals', '18'),
    ('eligibility_threshold_raw', '1000000000000000000000000');
