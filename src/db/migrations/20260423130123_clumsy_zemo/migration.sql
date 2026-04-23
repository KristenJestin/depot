CREATE TABLE `reviews` (
	`id` text PRIMARY KEY,
	`prd_id` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`user_feedback` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`done_at` integer,
	CONSTRAINT `fk_reviews_prd_id_prds_id_fk` FOREIGN KEY (`prd_id`) REFERENCES `prds`(`id`)
);
--> statement-breakpoint
ALTER TABLE `prds` ADD `root_id` text REFERENCES prds(id);--> statement-breakpoint
ALTER TABLE `tasks` ADD `review_id` text REFERENCES reviews(id);--> statement-breakpoint
ALTER TABLE `tasks` ADD `severity` text;--> statement-breakpoint
CREATE INDEX `prds_root_id_idx` ON `prds` (`root_id`);--> statement-breakpoint
CREATE INDEX `reviews_prd_id_idx` ON `reviews` (`prd_id`);--> statement-breakpoint
CREATE INDEX `tasks_review_id_idx` ON `tasks` (`review_id`);