CREATE TABLE `jira_links` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`token_enc` text NOT NULL,
	`account_id` text NOT NULL,
	`display_name` text,
	`share` text DEFAULT 'title' NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
