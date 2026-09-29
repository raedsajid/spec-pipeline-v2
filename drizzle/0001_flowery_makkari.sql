CREATE TABLE `submittal_jobs` (
	`hash` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`cursor` integer DEFAULT 0 NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`lease` integer DEFAULT 0 NOT NULL,
	`error` text
);
--> statement-breakpoint
ALTER TABLE `messages` ADD `doc_id` text;--> statement-breakpoint
ALTER TABLE `project_docs` ADD `log_version` integer DEFAULT 0 NOT NULL;