CREATE TABLE `profile` (
	`id` integer PRIMARY KEY NOT NULL,
	`federal_state` text,
	`school_type` text,
	`grade_level` text,
	`onboarding_completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "profile_singleton" CHECK("profile"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `subject_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_id` text NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subject_groups_name_nocase` ON `subject_groups` (`subject_id`,lower("name"));--> statement-breakpoint
CREATE TABLE `subjects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subjects_name_nocase` ON `subjects` (lower("name"));