CREATE TABLE `parts` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`message_id` text NOT NULL,
	`type` text NOT NULL,
	`data_json` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_parts_session_message` ON `parts` (`session_id`, `message_id`);
