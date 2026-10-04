CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_id` text NOT NULL,
	`group_id` text,
	`title` text NOT NULL,
	`markdown` text DEFAULT '' NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`source_chat_id` text,
	`source_message_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `subject_groups`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `notes_subject_updated` ON `notes` (`subject_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `notes_group` ON `notes` (`group_id`);