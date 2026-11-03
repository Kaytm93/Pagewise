CREATE TABLE `code_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`message_id` text NOT NULL,
	`purpose` text,
	`script` text NOT NULL,
	`outcome` text NOT NULL,
	`exit_code` integer,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`files` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `code_runs_message` ON `code_runs` (`message_id`);--> statement-breakpoint
CREATE INDEX `code_runs_chat` ON `code_runs` (`chat_id`);--> statement-breakpoint
ALTER TABLE `providers` ADD `allow_code` integer DEFAULT false NOT NULL;