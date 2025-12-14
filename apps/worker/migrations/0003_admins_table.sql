-- Admins Table: Multiple admin support
-- Migration: 0003_admins_table.sql

CREATE TABLE IF NOT EXISTS admins (
    id TEXT PRIMARY KEY,
    telegram_handle TEXT NOT NULL UNIQUE,
    added_by TEXT, -- admin_id who added this admin
    added_at INTEGER NOT NULL,
    last_login_at INTEGER
);

-- Index for quick lookup
CREATE INDEX IF NOT EXISTS idx_admins_handle 
ON admins (telegram_handle);

-- Bootstrap: Insert first admin from ADMIN_TELEGRAM_HANDLE env var
-- This will be done via code on first OTP request if table is empty
