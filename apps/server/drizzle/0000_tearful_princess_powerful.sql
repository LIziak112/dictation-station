CREATE TABLE `batches` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`source_text` text DEFAULT '' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `metadata` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
