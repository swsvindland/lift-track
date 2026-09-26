-- ALTER statements carry ON DELETE SET NULL by hand: drizzle-kit drops it when adding columns.
CREATE TABLE `meso_days` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`meso_id` integer NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`meso_id`) REFERENCES `mesocycles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `meso_days_meso` ON `meso_days` (`meso_id`);--> statement-breakpoint
CREATE TABLE `meso_skips` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`meso_id` integer NOT NULL,
	`week` integer NOT NULL,
	`day_id` integer NOT NULL,
	FOREIGN KEY (`meso_id`) REFERENCES `mesocycles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`day_id`) REFERENCES `meso_days`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `meso_slots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`day_id` integer NOT NULL,
	`position` integer NOT NULL,
	`exercise_id` text NOT NULL,
	`sets` integer NOT NULL,
	`rep_min` integer NOT NULL,
	`rep_max` integer NOT NULL,
	FOREIGN KEY (`day_id`) REFERENCES `meso_days`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `meso_slots_day` ON `meso_slots` (`day_id`);--> statement-breakpoint
CREATE TABLE `mesocycles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`rir` text NOT NULL,
	`deload` integer DEFAULT true NOT NULL,
	`method` integer NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text
);
--> statement-breakpoint
CREATE TABLE `muscle_feedback` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workout_id` integer NOT NULL,
	`muscle` text NOT NULL,
	`rating` text NOT NULL,
	FOREIGN KEY (`workout_id`) REFERENCES `workouts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `muscle_feedback_workout_muscle` ON `muscle_feedback` (`workout_id`,`muscle`);--> statement-breakpoint
ALTER TABLE `workout_exercises` ADD `slot_id` integer REFERENCES meso_slots(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `workout_exercises` ADD `advice` text;--> statement-breakpoint
ALTER TABLE `workouts` ADD `meso_id` integer REFERENCES mesocycles(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `workouts` ADD `meso_week` integer;--> statement-breakpoint
ALTER TABLE `workouts` ADD `meso_day_id` integer REFERENCES meso_days(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `workouts` ADD `deload` integer DEFAULT false NOT NULL;