CREATE TABLE `approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`permission` text NOT NULL,
	`pattern` text NOT NULL,
	`session_id` text NOT NULL,
	`decision` text NOT NULL,
	`timestamp` integer NOT NULL,
	`expires_at` integer
);
--> statement-breakpoint
CREATE TABLE `checkpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`message_index` integer NOT NULL,
	`snapshot_json` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`parts_json` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `persistent_permissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`permission` text NOT NULL,
	`pattern` text NOT NULL,
	`action` text DEFAULT 'allow' NOT NULL,
	`source` text DEFAULT 'user' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`model` text,
	`parent_id` text,
	`project_dir` text,
	`tokens_input` integer DEFAULT 0 NOT NULL,
	`tokens_output` integer DEFAULT 0 NOT NULL,
	`tokens_reasoning` integer DEFAULT 0 NOT NULL,
	`cost` integer DEFAULT 0 NOT NULL,
	`agent_state_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_messages_session` ON `messages` (`session_id`);
--> statement-breakpoint
CREATE INDEX `idx_messages_created` ON `messages` (`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_checkpoints_session` ON `checkpoints` (`session_id`);
--> statement-breakpoint
CREATE INDEX `idx_permissions_pattern` ON `persistent_permissions` (`permission`, `pattern`);
--> statement-breakpoint
CREATE INDEX `idx_approvals_permission` ON `approvals` (`permission`, `pattern`);
--> statement-breakpoint
CREATE INDEX `idx_approvals_session` ON `approvals` (`session_id`);
