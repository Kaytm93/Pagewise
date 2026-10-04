CREATE TABLE `exams` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text,
	`date` text NOT NULL,
	`time` text,
	`topics` text,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `exams_date` ON `exams` (`date`);--> statement-breakpoint
CREATE INDEX `exams_subject` ON `exams` (`subject_id`);--> statement-breakpoint
CREATE TABLE `timetable_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`weekday` integer NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`subject_id` text,
	`room` text,
	`note` text,
	`week` text DEFAULT 'all' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "timetable_weekday_range" CHECK("timetable_entries"."weekday" between 1 and 7),
	CONSTRAINT "timetable_week_kind" CHECK("timetable_entries"."week" in ('all', 'a', 'b'))
);
--> statement-breakpoint
CREATE INDEX `timetable_weekday` ON `timetable_entries` (`weekday`,`start_time`);