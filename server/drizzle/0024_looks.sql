CREATE TABLE `user_looks` (
	`user_id` text NOT NULL,
	`slot` integer NOT NULL,
	`figure` text NOT NULL,
	`gender` text NOT NULL,
	`saved_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `slot`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
