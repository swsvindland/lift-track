-- ALTER statements carry ON DELETE SET NULL by hand: drizzle-kit drops it when adding columns.
ALTER TABLE `gyms` ADD `excluded` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `gyms` ADD `included` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `mesocycles` ADD `gym_id` integer REFERENCES gyms(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `workouts` ADD `travel` integer DEFAULT false NOT NULL;
