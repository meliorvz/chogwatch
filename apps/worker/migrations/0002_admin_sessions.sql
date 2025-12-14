-- Admin Sessions: OTP authentication for admin dashboard
-- Migration: 0002_admin_sessions.sql

CREATE TABLE IF NOT EXISTS admin_sessions (
    id TEXT PRIMARY KEY,
    otp_hash TEXT NOT NULL,
    telegram_handle TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    verified_at INTEGER,
    session_token_hash TEXT
);

-- Index for cleanup of expired sessions
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires 
ON admin_sessions (expires_at);

-- Add screening interval setting (for Phase 3)
INSERT OR IGNORE INTO settings (key, value) VALUES 
    ('screening_interval_hours', '24');
