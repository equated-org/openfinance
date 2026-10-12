-- The Mastercard catalog snapshot is no longer searched. Rows a Quiltt
-- connection still points at stay, so it keeps its name until its next sync
-- moves it onto the institution Quiltt reports.
DELETE FROM "institution_registry" AS "r"
WHERE starts_with("r"."provider_composite_key", 'mastercard_')
  AND NOT EXISTS (
    SELECT 1 FROM "account_connections" AS "c"
    WHERE "c"."institution_registry_id" = "r"."id"
  );--> statement-breakpoint
ALTER TABLE "institution_registry" DROP COLUMN "mastercard_data";
