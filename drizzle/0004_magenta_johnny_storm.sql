CREATE TABLE `espn_athletes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scorer_odds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`match_id` integer NOT NULL,
	`player_name` text NOT NULL,
	`american` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scorer_odds_match_player` ON `scorer_odds` (`match_id`,`player_name`);--> statement-breakpoint
ALTER TABLE `leagues` ADD `auto_underdog_enabled` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `matches` ADD `odds_json` text;--> statement-breakpoint
ALTER TABLE `matches` ADD `odds_updated_at` integer;