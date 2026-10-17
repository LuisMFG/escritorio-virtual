CREATE TABLE `chat_reactions` (
	`message_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`emoji` text NOT NULL,
	PRIMARY KEY(`message_id`, `user_id`, `emoji`),
	FOREIGN KEY (`message_id`) REFERENCES `chat_messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `dm_reactions` (
	`message_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`emoji` text NOT NULL,
	PRIMARY KEY(`message_id`, `user_id`, `emoji`),
	FOREIGN KEY (`message_id`) REFERENCES `direct_messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `reply_to_id` integer REFERENCES chat_messages(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `direct_messages` ADD `reply_to_id` integer REFERENCES direct_messages(id) ON DELETE SET NULL;