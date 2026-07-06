CREATE TABLE `analysis_job` (
	`run_id` varchar(36) PRIMARY KEY,
	`owner_id` varchar(36) NOT NULL,
	`status` enum('queued','running','succeeded','failed') NOT NULL DEFAULT 'queued',
	`attempt_count` int NOT NULL DEFAULT 0,
	`last_error` text,
	`leased_until` datetime,
	`llm_model` varchar(128),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `analysis_job_run_owner_fkey` FOREIGN KEY (`run_id`,`owner_id`) REFERENCES `run`(`id`,`owner_id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `user` ADD `role` enum('user','admin') DEFAULT 'user' NOT NULL;--> statement-breakpoint
CREATE INDEX `analysis_job_status_created_idx` ON `analysis_job` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `analysis_job_owner_status_idx` ON `analysis_job` (`owner_id`,`status`);