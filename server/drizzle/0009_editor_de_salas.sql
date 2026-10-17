ALTER TABLE `rooms` ADD `sort` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `can_edit_rooms` integer DEFAULT false NOT NULL;