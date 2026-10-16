CREATE TABLE `room_furni` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`def_id` text NOT NULL,
	`x` integer NOT NULL,
	`y` integer NOT NULL,
	`z` real NOT NULL,
	`rot` integer NOT NULL,
	`placed_by` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`placed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `room_furni_room_id_idx` ON `room_furni` (`room_id`);--> statement-breakpoint
ALTER TABLE `rooms` ADD `furni_seeded` integer DEFAULT false NOT NULL;