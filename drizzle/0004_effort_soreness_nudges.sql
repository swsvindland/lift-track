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
CREATE INDEX `ai_nudges_workout` ON `ai_nudges` (`workout_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_muscle_feedback` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workout_id` integer NOT NULL,
	`muscle` text NOT NULL,
	`rating` text,
	`soreness` text,
	FOREIGN KEY (`workout_id`) REFERENCES `workouts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_muscle_feedback`("id", "workout_id", "muscle", "rating", "soreness") SELECT "id", "workout_id", "muscle", "rating", NULL FROM `muscle_feedback`;--> statement-breakpoint
DROP TABLE `muscle_feedback`;--> statement-breakpoint
ALTER TABLE `__new_muscle_feedback` RENAME TO `muscle_feedback`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `muscle_feedback_workout_muscle` ON `muscle_feedback` (`workout_id`,`muscle`);--> statement-breakpoint
ALTER TABLE `sets` ADD `effort` text;