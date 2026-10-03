CREATE TABLE `auth_credentials` (
	`id` integer PRIMARY KEY NOT NULL,
	`passcode_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "auth_credentials_singleton" CHECK("auth_credentials"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`csrf_token` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sessions_expires_at` ON `sessions` (`expires_at`);