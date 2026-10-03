ALTER TABLE `subjects` ADD `template_key` text;--> statement-breakpoint
ALTER TABLE `subjects` ADD `kind` text DEFAULT 'subject' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `subjects_single_default` ON `subjects` (`kind`) WHERE `kind` = 'default';