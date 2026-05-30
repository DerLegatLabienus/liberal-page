CREATE TABLE "committee_sessions" (
	"session_id" integer PRIMARY KEY NOT NULL,
	"committee_id" integer NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"knesset_num" integer NOT NULL,
	"title" text NOT NULL,
	"session_url" text NOT NULL,
	"attending_site_ids" text[] DEFAULT '{}' NOT NULL,
	"ai_summary" text
);
--> statement-breakpoint
CREATE TABLE "committees" (
	"id" serial PRIMARY KEY NOT NULL,
	"oknesset_id" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"chair" text DEFAULT '' NOT NULL,
	"last_session_date" timestamp with time zone,
	"last_session_summary" text,
	"last_session_document_url" text,
	"source_url" text NOT NULL,
	"has_new_data" boolean DEFAULT false NOT NULL,
	"last_polled_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "committee_sessions" ADD CONSTRAINT "committee_sessions_committee_id_committees_id_fk" FOREIGN KEY ("committee_id") REFERENCES "public"."committees"("id") ON DELETE restrict ON UPDATE no action;