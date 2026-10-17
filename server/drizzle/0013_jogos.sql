CREATE TABLE `game_scores` (
	`user_id` text NOT NULL,
	`game` text NOT NULL,
	`wins` integer DEFAULT 0 NOT NULL,
	`losses` integer DEFAULT 0 NOT NULL,
	`draws` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `game`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `kind` text DEFAULT 'text' NOT NULL;