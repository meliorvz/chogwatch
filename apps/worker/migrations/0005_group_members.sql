-- Group membership tracking
-- Migration: 0005_group_members.sql

-- Track Telegram group members (via webhook events or manual import)
CREATE TABLE IF NOT EXISTS group_members (
    telegram_user_id INTEGER PRIMARY KEY,
    telegram_username TEXT,
    first_name TEXT,
    joined_at INTEGER NOT NULL,
    left_at INTEGER,              -- NULL if still in group
    source TEXT NOT NULL DEFAULT 'webhook',  -- 'webhook' or 'import'
    updated_at INTEGER NOT NULL
);

-- Index for username lookups (case-insensitive matching)
CREATE INDEX IF NOT EXISTS idx_group_members_username 
ON group_members (lower(telegram_username));

-- Add bot_notifications_enabled setting
INSERT OR IGNORE INTO settings (key, value) VALUES 
    ('bot_notifications_enabled', 'true');
