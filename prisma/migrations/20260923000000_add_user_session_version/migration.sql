-- Lets a password change or reset invalidate sessions that are already out
-- there. Existing rows start at 0, which is also what a session issued before
-- this migration is treated as carrying, so nobody is logged out by the deploy.
ALTER TABLE `users` ADD COLUMN `sessionVersion` INTEGER NOT NULL DEFAULT 0;
