CREATE TABLE `chats` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_id` text NOT NULL,
	`group_id` text,
	`title` text DEFAULT '' NOT NULL,
	`model_provider_id` text,
	`model_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `subject_groups`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`model_provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `chats_subject_updated` ON `chats` (`subject_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `chats_group` ON `chats` (`group_id`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`seq` integer NOT NULL,
	`role` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'complete' NOT NULL,
	`provider_id` text,
	`model` text,
	`error_code` text,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "messages_role" CHECK("messages"."role" in ('user', 'assistant')),
	CONSTRAINT "messages_status" CHECK("messages"."status" in ('complete', 'streaming', 'stopped', 'error', 'interrupted'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_chat_seq` ON `messages` (`chat_id`,`seq`);--> statement-breakpoint
ALTER TABLE `subjects` ADD `model_provider_id` text REFERENCES providers(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `subjects` ADD `model_id` text;