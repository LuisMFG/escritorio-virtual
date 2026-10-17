CREATE TABLE `whiteboard_strokes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`furni_id` text NOT NULL,
	`user_id` text NOT NULL,
	`data` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`furni_id`) REFERENCES `room_furni`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `whiteboard_strokes_furni_idx` ON `whiteboard_strokes` (`furni_id`,`id`);