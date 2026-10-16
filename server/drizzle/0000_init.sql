CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`heightmap` text NOT NULL,
	`spawn_x` integer NOT NULL,
	`spawn_y` integer NOT NULL,
	`spawn_dir` integer NOT NULL,
	`floor_color` text NOT NULL,
	`wall_color` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`session_token_hash` text NOT NULL,
	`figure` text NOT NULL,
	`gender` text DEFAULT 'M' NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_session_token_hash_unique` ON `users` (`session_token_hash`);