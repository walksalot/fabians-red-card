CREATE TABLE `app_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `leagues` ADD `auto_sync_enabled` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `matches` ADD `result_source` text;--> statement-breakpoint
ALTER TABLE `matches` ADD `live_home` integer;--> statement-breakpoint
ALTER TABLE `matches` ADD `live_away` integer;--> statement-breakpoint
ALTER TABLE `matches` ADD `live_status` text;--> statement-breakpoint
ALTER TABLE `matches` ADD `live_updated_at` integer;