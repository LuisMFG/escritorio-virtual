DROP INDEX `users_session_token_hash_unique`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `session_token_hash`;