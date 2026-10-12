-- Mastercard rows that syncs have since moved their connections off. A row a
-- connection still points at keeps naming it until it syncs or reconnects.
DELETE FROM "institution_registry" AS "r"
WHERE starts_with("r"."provider_composite_key", 'mastercard_')
  AND NOT EXISTS (
    SELECT 1 FROM "account_connections" AS "c"
    WHERE "c"."institution_registry_id" = "r"."id"
  );--> statement-breakpoint
ALTER TABLE "institution_registry" DROP COLUMN "supported_account_types";--> statement-breakpoint
ALTER TABLE "institution_registry" DROP COLUMN "is_top_institution";--> statement-breakpoint
ALTER TABLE "institution_registry" DROP COLUMN "country_rank";