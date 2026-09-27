CREATE TABLE `ai_nudges` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workout_id` integer NOT NULL,
	`exercise_id` text,
	`muscle` text,
	`value` integer NOT NULL,
	`reason` text NOT NULL,
	`dismissed` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`workout_id`) REFERENCES `workouts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_nudges_workout` ON `ai_nudges` (`workout_id`);