CREATE TABLE `reviews` (
	`id` text PRIMARY KEY,
	`prd_id` text NOT NULL,
	`prd_revision` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`mode` text NOT NULL,
	`user_feedback` text,
	`findings` text DEFAULT '[]' NOT NULL,
	`questions` text DEFAULT '[]' NOT NULL,
	`followup_tasks` text DEFAULT '[]' NOT NULL,
	`decision` text,
	`decision_note` text,
	`created_at` text NOT NULL,
	`completed_at` text,
	CONSTRAINT `fk_reviews_prd_id_prds_id_fk` FOREIGN KEY (`prd_id`) REFERENCES `prds`(`id`)
);
--> statement-breakpoint
ALTER TABLE `activity_log` ADD `review_id` text REFERENCES reviews(id);