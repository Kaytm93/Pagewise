ALTER TABLE `messages` ADD `reasoning` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `generation_ms` integer;--> statement-breakpoint
ALTER TABLE `messages` ADD `cost_usd` real;