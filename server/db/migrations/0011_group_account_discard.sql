-- Repurpose the legacy shared account as the public 'group' account, and DISCARD its
-- tracked rows so the group list starts empty (per design). Idempotent.
UPDATE "users" SET "role" = 'group' WHERE "label" = 'shared' AND "role" <> 'group';
--> statement-breakpoint
DELETE FROM "tracked_bills" WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "role" = 'group');
--> statement-breakpoint
DELETE FROM "tracked_committees" WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "role" = 'group');
--> statement-breakpoint
DELETE FROM "tracked_mks" WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "role" = 'group');
