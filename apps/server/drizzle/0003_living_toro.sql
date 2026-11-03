CREATE TABLE `learning_states` (
	`account_id` text NOT NULL,
	`word_id` text NOT NULL,
	`mode` text NOT NULL,
	`payload` text NOT NULL,
	PRIMARY KEY(`account_id`, `word_id`, `mode`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`word_id`) REFERENCES `words`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `accounts` ADD `preferences` text DEFAULT '{}' NOT NULL;