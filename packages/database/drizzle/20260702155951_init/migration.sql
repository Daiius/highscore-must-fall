CREATE TABLE `account` (
	`id` varchar(36) PRIMARY KEY,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` timestamp(3),
	`refresh_token_expires_at` timestamp(3),
	`scope` text,
	`password` text,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now())
);
--> statement-breakpoint
CREATE TABLE `catalog_alias` (
	`id` varchar(36) PRIMARY KEY,
	`catalog_kind` enum('upgrade','reward') NOT NULL,
	`upgrade_catalog_id` varchar(36),
	`reward_catalog_id` varchar(36),
	`alias_key` varchar(191) NOT NULL,
	CONSTRAINT `catalog_alias_kind_key_uidx` UNIQUE INDEX(`catalog_kind`,`alias_key`),
	CONSTRAINT `catalog_alias_kind_target_chk` CHECK((`catalog_alias`.`catalog_kind` = 'upgrade' and `catalog_alias`.`upgrade_catalog_id` is not null and `catalog_alias`.`reward_catalog_id` is null)
        or (`catalog_alias`.`catalog_kind` = 'reward' and `catalog_alias`.`reward_catalog_id` is not null and `catalog_alias`.`upgrade_catalog_id` is null))
);
--> statement-breakpoint
CREATE TABLE `reward_catalog` (
	`id` varchar(36) PRIMARY KEY,
	`canonical_key` varchar(191) NOT NULL,
	`display_name` varchar(191) NOT NULL,
	`verified` boolean NOT NULL DEFAULT false,
	`first_seen_run_id` varchar(36),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `reward_catalog_canonical_key_uidx` UNIQUE INDEX(`canonical_key`)
);
--> statement-breakpoint
CREATE TABLE `reward_entry` (
	`id` varchar(36) PRIMARY KEY,
	`owner_id` varchar(36) NOT NULL,
	`run_id` varchar(36) NOT NULL,
	`reward_catalog_id` varchar(36) NOT NULL,
	`count` int NOT NULL,
	`points` int NOT NULL
);
--> statement-breakpoint
CREATE TABLE `run` (
	`id` varchar(36) PRIMARY KEY,
	`owner_id` varchar(36) NOT NULL,
	`game` varchar(191) NOT NULL DEFAULT 'UTOPIA MUST FALL',
	`played_at` datetime NOT NULL,
	`status` enum('draft','confirmed') NOT NULL DEFAULT 'draft',
	`source` enum('file_import','paste','mcp','api','screenshot_auto') NOT NULL,
	`schema_version` varchar(32) NOT NULL,
	`days_survived` int,
	`final_score` int,
	`aliens_defeated` int,
	`nukes_launched` int,
	`apocalypse_bonus` int,
	`reroll_count` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `run_id_owner_uidx` UNIQUE INDEX(`id`,`owner_id`)
);
--> statement-breakpoint
CREATE TABLE `run_image` (
	`id` varchar(36) PRIMARY KEY,
	`owner_id` varchar(36) NOT NULL,
	`run_id` varchar(36) NOT NULL,
	`section` enum('result','upgrade_history','reward_ledger','other') NOT NULL,
	`storage_key` varchar(255) NOT NULL,
	`content_type` varchar(64) NOT NULL,
	`byte_size` int NOT NULL,
	`width` int,
	`height` int,
	`created_at` timestamp NOT NULL DEFAULT (now())
);
--> statement-breakpoint
CREATE TABLE `run_payload` (
	`run_id` varchar(36) PRIMARY KEY,
	`owner_id` varchar(36) NOT NULL,
	`raw_payload` json NOT NULL,
	`llm_model` varchar(128),
	`source_note` text
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` varchar(36) PRIMARY KEY,
	`expires_at` timestamp(3) NOT NULL,
	`token` varchar(255) NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	`ip_address` text,
	`user_agent` text,
	`user_id` varchar(36) NOT NULL,
	CONSTRAINT `token_unique` UNIQUE INDEX(`token`)
);
--> statement-breakpoint
CREATE TABLE `upgrade_catalog` (
	`id` varchar(36) PRIMARY KEY,
	`canonical_key` varchar(191) NOT NULL,
	`display_name` varchar(191) NOT NULL,
	`kind` enum('contract','opportunity_upgrade') NOT NULL DEFAULT 'contract',
	`verified` boolean NOT NULL DEFAULT false,
	`first_seen_run_id` varchar(36),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `upgrade_catalog_canonical_key_uidx` UNIQUE INDEX(`canonical_key`)
);
--> statement-breakpoint
CREATE TABLE `upgrade_entry` (
	`id` varchar(36) PRIMARY KEY,
	`owner_id` varchar(36) NOT NULL,
	`run_id` varchar(36) NOT NULL,
	`week_index` int NOT NULL,
	`order_in_week` int NOT NULL,
	`entry_type` enum('upgrade','reroll') NOT NULL,
	`upgrade_catalog_id` varchar(36),
	`upgrade_order` int,
	`flavor_text` text,
	CONSTRAINT `upgrade_entry_type_target_chk` CHECK((`upgrade_entry`.`entry_type` = 'upgrade' and `upgrade_entry`.`upgrade_catalog_id` is not null and `upgrade_entry`.`upgrade_order` is not null)
        or (`upgrade_entry`.`entry_type` = 'reroll' and `upgrade_entry`.`upgrade_catalog_id` is null and `upgrade_entry`.`upgrade_order` is null))
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` varchar(36) PRIMARY KEY,
	`name` varchar(255) NOT NULL,
	`email` varchar(255) NOT NULL,
	`email_verified` boolean NOT NULL DEFAULT false,
	`image` text,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `email_unique` UNIQUE INDEX(`email`)
);
--> statement-breakpoint
CREATE TABLE `verification` (
	`id` varchar(36) PRIMARY KEY,
	`identifier` varchar(255) NOT NULL,
	`value` text NOT NULL,
	`expires_at` timestamp(3) NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now())
);
--> statement-breakpoint
CREATE INDEX `account_user_id_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE INDEX `catalog_alias_upgrade_target_idx` ON `catalog_alias` (`upgrade_catalog_id`);--> statement-breakpoint
CREATE INDEX `catalog_alias_reward_target_idx` ON `catalog_alias` (`reward_catalog_id`);--> statement-breakpoint
CREATE INDEX `reward_entry_run_idx` ON `reward_entry` (`run_id`);--> statement-breakpoint
CREATE INDEX `reward_entry_owner_catalog_idx` ON `reward_entry` (`owner_id`,`reward_catalog_id`);--> statement-breakpoint
CREATE INDEX `run_owner_played_at_idx` ON `run` (`owner_id`,`played_at`);--> statement-breakpoint
CREATE INDEX `run_owner_final_score_idx` ON `run` (`owner_id`,`final_score`);--> statement-breakpoint
CREATE INDEX `run_owner_status_idx` ON `run` (`owner_id`,`status`);--> statement-breakpoint
CREATE INDEX `run_image_run_idx` ON `run_image` (`run_id`);--> statement-breakpoint
CREATE INDEX `run_image_owner_run_idx` ON `run_image` (`owner_id`,`run_id`);--> statement-breakpoint
CREATE INDEX `session_user_id_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE INDEX `upgrade_entry_run_idx` ON `upgrade_entry` (`run_id`);--> statement-breakpoint
CREATE INDEX `upgrade_entry_catalog_week_idx` ON `upgrade_entry` (`upgrade_catalog_id`,`week_index`);--> statement-breakpoint
CREATE INDEX `upgrade_entry_owner_catalog_idx` ON `upgrade_entry` (`owner_id`,`upgrade_catalog_id`);--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
ALTER TABLE `account` ADD CONSTRAINT `account_user_id_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `catalog_alias` ADD CONSTRAINT `catalog_alias_upgrade_catalog_id_upgrade_catalog_id_fkey` FOREIGN KEY (`upgrade_catalog_id`) REFERENCES `upgrade_catalog`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `catalog_alias` ADD CONSTRAINT `catalog_alias_reward_catalog_id_reward_catalog_id_fkey` FOREIGN KEY (`reward_catalog_id`) REFERENCES `reward_catalog`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `reward_catalog` ADD CONSTRAINT `reward_catalog_first_seen_run_id_run_id_fkey` FOREIGN KEY (`first_seen_run_id`) REFERENCES `run`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `reward_entry` ADD CONSTRAINT `reward_entry_reward_catalog_id_reward_catalog_id_fkey` FOREIGN KEY (`reward_catalog_id`) REFERENCES `reward_catalog`(`id`) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE `reward_entry` ADD CONSTRAINT `reward_entry_run_owner_fkey` FOREIGN KEY (`run_id`,`owner_id`) REFERENCES `run`(`id`,`owner_id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `run` ADD CONSTRAINT `run_owner_id_user_id_fkey` FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `run_image` ADD CONSTRAINT `run_image_run_owner_fkey` FOREIGN KEY (`run_id`,`owner_id`) REFERENCES `run`(`id`,`owner_id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `run_payload` ADD CONSTRAINT `run_payload_run_owner_fkey` FOREIGN KEY (`run_id`,`owner_id`) REFERENCES `run`(`id`,`owner_id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `session` ADD CONSTRAINT `session_user_id_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `upgrade_catalog` ADD CONSTRAINT `upgrade_catalog_first_seen_run_id_run_id_fkey` FOREIGN KEY (`first_seen_run_id`) REFERENCES `run`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `upgrade_entry` ADD CONSTRAINT `upgrade_entry_upgrade_catalog_id_upgrade_catalog_id_fkey` FOREIGN KEY (`upgrade_catalog_id`) REFERENCES `upgrade_catalog`(`id`) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE `upgrade_entry` ADD CONSTRAINT `upgrade_entry_run_owner_fkey` FOREIGN KEY (`run_id`,`owner_id`) REFERENCES `run`(`id`,`owner_id`) ON DELETE CASCADE;