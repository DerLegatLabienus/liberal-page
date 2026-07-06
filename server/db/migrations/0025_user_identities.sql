CREATE TABLE IF NOT EXISTS "auth"."user_identities" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL REFERENCES "auth"."users"("id") ON DELETE CASCADE,
  "provider" text NOT NULL,
  "provider_sub" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "user_identities_provider_sub_unique" UNIQUE ("provider", "provider_sub")
);
--> statement-breakpoint
-- Backfill existing Google identities so linked accounts survive.
INSERT INTO "auth"."user_identities" ("user_id", "provider", "provider_sub", "created_at")
SELECT "id", 'google', "google_sub", now() FROM "auth"."users" WHERE "google_sub" IS NOT NULL
ON CONFLICT ("provider", "provider_sub") DO NOTHING;
--> statement-breakpoint
UPDATE "auth"."users" SET "email" = lower("email") WHERE "email" IS NOT NULL AND "email" <> lower("email");
--> statement-breakpoint
UPDATE "auth"."allowed_emails" SET "email" = lower("email") WHERE "email" <> lower("email");
