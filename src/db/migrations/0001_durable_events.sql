CREATE TABLE `durable_events` (
	`id` text PRIMARY KEY NOT NULL,
	`seq` integer NOT NULL,
	`aggregate_id` text NOT NULL,
	`version` integer NOT NULL,
	`definition` text NOT NULL,
	`data_json` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_durable_events_aggregate` ON `durable_events` (`aggregate_id`, `seq`);
--> statement-breakpoint
CREATE INDEX `idx_durable_events_seq` ON `durable_events` (`seq`);
