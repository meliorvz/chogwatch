-- Add telegram_user_id to admins table for direct messaging
-- Migration: 0004_admin_telegram_user_id.sql

-- Add telegram_user_id column (nullable - populated when admin registers with bot)
ALTER TABLE admins ADD COLUMN telegram_user_id INTEGER;

-- Index for quick lookup by user_id
CREATE INDEX IF NOT EXISTS idx_admins_user_id 
ON admins (telegram_user_id);
