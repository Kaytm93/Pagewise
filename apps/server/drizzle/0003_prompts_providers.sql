CREATE TABLE `providers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'openai-compatible' NOT NULL,
	`preset` text DEFAULT 'custom' NOT NULL,
	`base_url` text NOT NULL,
	`models` text DEFAULT '[]' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `providers_name_nocase` ON `providers` (lower("name"));--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `profile` ADD `school_prompt` text;--> statement-breakpoint
ALTER TABLE `subject_groups` ADD `extra_prompt` text;--> statement-breakpoint
ALTER TABLE `subjects` ADD `system_prompt` text;