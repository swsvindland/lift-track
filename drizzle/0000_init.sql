CREATE TABLE `custom_exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`equipment` text NOT NULL,
	`pattern` text NOT NULL,
	`muscles` text NOT NULL,
	`unilateral` integer DEFAULT false NOT NULL,
	`load` text,
	`rep_min` integer NOT NULL,
	`rep_max` integer NOT NULL,
	`cue` text DEFAULT '' NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `exercise_settings` (
	`exercise_id` text PRIMARY KEY NOT NULL,
	`favorite` integer DEFAULT false NOT NULL,
	`avoid` integer DEFAULT false NOT NULL,
	`rest_seconds` integer,
	`note` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `gyms` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`unit` text NOT NULL,
	`bar_weight` real NOT NULL,
	`plates` text NOT NULL,
	`dumbbell_step` real NOT NULL,
	`dumbbell_max` real NOT NULL,
	`machine_step` real NOT NULL,
	`equipment` text NOT NULL,
	`archived` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `health_links` (
	`key` text PRIMARY KEY NOT NULL,
	`local_kind` text NOT NULL,
	`local_id` integer NOT NULL,
	`remote_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`origin` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `preferences` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workout_exercise_id` integer NOT NULL,
	`position` integer NOT NULL,
	`kind` text DEFAULT 'working' NOT NULL,
	`weight_kg` real,
	`reps` integer,
	`rir` real,
	`side` text,
	`completed_at` text,
	`target_weight_kg` real,
	`target_reps` integer,
	`target_rir` real,
	FOREIGN KEY (`workout_exercise_id`) REFERENCES `workout_exercises`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sets_workout_exercise` ON `sets` (`workout_exercise_id`);--> statement-breakpoint
CREATE TABLE `weight_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`weight_kg` real NOT NULL,
	`measured_at` text NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `workout_exercises` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workout_id` integer NOT NULL,
	`exercise_id` text NOT NULL,
	`position` integer NOT NULL,
	`superset_group` integer,
	`rep_min` integer NOT NULL,
	`rep_max` integer NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`workout_id`) REFERENCES `workouts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workout_exercises_workout` ON `workout_exercises` (`workout_id`);--> statement-breakpoint
CREATE INDEX `workout_exercises_exercise` ON `workout_exercises` (`exercise_id`);--> statement-breakpoint
CREATE TABLE `workouts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`gym_id` integer,
	`body_weight_kg` real,
	`note` text DEFAULT '' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`gym_id`) REFERENCES `gyms`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `workouts_started` ON `workouts` (`started_at`);