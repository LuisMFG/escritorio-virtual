CREATE TABLE `poll_votes` (
	`poll_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`option` integer NOT NULL,
	`voted_at` integer NOT NULL,
	PRIMARY KEY(`poll_id`, `user_id`),
	FOREIGN KEY (`poll_id`) REFERENCES `polls`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `polls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`message_id` integer NOT NULL,
	`room_id` text NOT NULL,
	`question` text NOT NULL,
	`options` text NOT NULL,
	`anonymous` integer DEFAULT false NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`closed_at` integer,
	FOREIGN KEY (`message_id`) REFERENCES `chat_messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `polls_message_id_unique` ON `polls` (`message_id`);