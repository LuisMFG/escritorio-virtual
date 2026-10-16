CREATE TABLE `room_doors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` text NOT NULL,
	`x` integer NOT NULL,
	`y` integer NOT NULL,
	`target_room_id` text NOT NULL,
	`target_x` integer NOT NULL,
	`target_y` integer NOT NULL,
	`target_dir` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action
);
