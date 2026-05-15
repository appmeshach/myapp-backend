-- 015_user_password_hash.sql

ALTER TABLE users
ADD COLUMN IF NOT EXISTS password_hash TEXT;