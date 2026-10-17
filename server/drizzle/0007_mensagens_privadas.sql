CREATE TABLE `direct_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`from_user_id` text NOT NULL,
	`to_user_id` text NOT NULL,
	`text` text NOT NULL,
	`created_at` integer NOT NULL,
	`read_at` integer,
	FOREIGN KEY (`from_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `dm_to_unread_idx` ON `direct_messages` (`to_user_id`,`read_at`);--> statement-breakpoint
CREATE INDEX `dm_pair_idx` ON `direct_messages` (`from_user_id`,`to_user_id`,`id`);