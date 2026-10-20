ALTER TABLE `users` ADD `desk` text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_desk_unique` ON `users` (`desk`);