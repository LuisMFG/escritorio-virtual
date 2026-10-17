CREATE TABLE `board_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`furni_id` text NOT NULL,
	`user_id` text NOT NULL,
	`text` text NOT NULL,
	`color` text DEFAULT 'yellow' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`furni_id`) REFERENCES `room_furni`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `board_notes_furni_idx` ON `board_notes` (`furni_id`);--> statement-breakpoint
ALTER TABLE `room_furni` ADD `state` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `ambient` text DEFAULT 'none' NOT NULL;