CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`message_id` text NOT NULL,
	`kind` text NOT NULL,
	`mime` text NOT NULL,
	`name` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assets_message` ON `assets` (`message_id`);--> statement-breakpoint
CREATE INDEX `assets_chat` ON `assets` (`chat_id`);--> statement-breakpoint
CREATE TABLE `engine_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`model` text,
	`timeout_minutes` integer DEFAULT 20 NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `engine_profiles_name_nocase` ON `engine_profiles` (lower("name"));--> statement-breakpoint
ALTER TABLE `chats` ADD `engine_profile_id` text REFERENCES engine_profiles(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `chats` ADD `agent_session_id` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `engine_profile_id` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `activity` text;--> statement-breakpoint
ALTER TABLE `subjects` ADD `engine_profile_id` text REFERENCES engine_profiles(id) ON DELETE SET NULL;