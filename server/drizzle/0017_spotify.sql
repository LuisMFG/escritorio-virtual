CREATE TABLE `spotify_links` (
	`user_id` text PRIMARY KEY NOT NULL,
	`refresh_token` text NOT NULL,
	`access_token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`display_name` text,
	`hidden` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
