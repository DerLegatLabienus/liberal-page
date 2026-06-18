-- §23: group the 28 tables into 6 cohesive domain schemas.
-- Non-destructive: CREATE SCHEMA + ALTER TABLE ... SET SCHEMA. Sequences, FKs, indexes,
-- and primary keys ride along with each table automatically. Cross-schema FKs are preserved.
-- Fresh-DB safe: migrations 0000-0020 build every table in `public`, then 0021 moves them.
CREATE SCHEMA IF NOT EXISTS "parliament";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "auth";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "email";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "letters";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "analytics";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "config";
--> statement-breakpoint
ALTER TABLE "public"."bills" SET SCHEMA "parliament";
--> statement-breakpoint
ALTER TABLE "public"."committees" SET SCHEMA "parliament";
--> statement-breakpoint
ALTER TABLE "public"."committee_sessions" SET SCHEMA "parliament";
--> statement-breakpoint
ALTER TABLE "public"."mks" SET SCHEMA "parliament";
--> statement-breakpoint
ALTER TABLE "public"."mk_knesset_terms" SET SCHEMA "parliament";
--> statement-breakpoint
ALTER TABLE "public"."mk_roles" SET SCHEMA "parliament";
--> statement-breakpoint
ALTER TABLE "public"."mk_activity" SET SCHEMA "parliament";
--> statement-breakpoint
ALTER TABLE "public"."mk_votes" SET SCHEMA "parliament";
--> statement-breakpoint
ALTER TABLE "public"."mk_annotations" SET SCHEMA "parliament";
--> statement-breakpoint
ALTER TABLE "public"."tracked_bills" SET SCHEMA "parliament";
--> statement-breakpoint
ALTER TABLE "public"."tracked_committees" SET SCHEMA "parliament";
--> statement-breakpoint
ALTER TABLE "public"."tracked_mks" SET SCHEMA "parliament";
--> statement-breakpoint
ALTER TABLE "public"."knesset_members_cache" SET SCHEMA "parliament";
--> statement-breakpoint
ALTER TABLE "public"."knesset_committees_cache" SET SCHEMA "parliament";
--> statement-breakpoint
ALTER TABLE "public"."summaries_cache" SET SCHEMA "parliament";
--> statement-breakpoint
ALTER TABLE "public"."knesset_config" SET SCHEMA "parliament";
--> statement-breakpoint
ALTER TABLE "public"."users" SET SCHEMA "auth";
--> statement-breakpoint
ALTER TABLE "public"."refresh_tokens" SET SCHEMA "auth";
--> statement-breakpoint
ALTER TABLE "public"."allowed_emails" SET SCHEMA "auth";
--> statement-breakpoint
ALTER TABLE "public"."email_templates" SET SCHEMA "email";
--> statement-breakpoint
ALTER TABLE "public"."sent_emails" SET SCHEMA "email";
--> statement-breakpoint
ALTER TABLE "public"."letters" SET SCHEMA "letters";
--> statement-breakpoint
ALTER TABLE "public"."letter_contacts" SET SCHEMA "letters";
--> statement-breakpoint
ALTER TABLE "public"."letter_issue_tags" SET SCHEMA "letters";
--> statement-breakpoint
ALTER TABLE "public"."letter_templates" SET SCHEMA "letters";
--> statement-breakpoint
ALTER TABLE "public"."join_analytics" SET SCHEMA "analytics";
--> statement-breakpoint
ALTER TABLE "public"."letter_analytics" SET SCHEMA "analytics";
--> statement-breakpoint
ALTER TABLE "public"."feature_flags" SET SCHEMA "config";
