ALTER TABLE "reconnect_links" DROP CONSTRAINT "reconnect_links_sync_job_id_sync_jobs_id_fk";
--> statement-breakpoint
ALTER TABLE "reconnect_links" DROP COLUMN "used_at";--> statement-breakpoint
ALTER TABLE "reconnect_links" DROP COLUMN "sync_job_id";