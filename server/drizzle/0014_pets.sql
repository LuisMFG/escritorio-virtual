CREATE TABLE `pets` (
	`user_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`species` text NOT NULL,
	`color` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
