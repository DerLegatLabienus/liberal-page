CREATE TABLE "mk_activity" (
	"id" serial PRIMARY KEY NOT NULL,
	"mk_id" integer NOT NULL,
	"type" text NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"source_url" text
);
--> statement-breakpoint
CREATE TABLE "mk_knesset_terms" (
	"id" serial PRIMARY KEY NOT NULL,
	"mk_id" integer NOT NULL,
	"knesset_number" integer NOT NULL,
	"faction" text NOT NULL,
	CONSTRAINT "uniq_mk_knesset" UNIQUE("mk_id","knesset_number")
);
--> statement-breakpoint
CREATE TABLE "mk_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"mk_id" integer NOT NULL,
	"position_id" integer NOT NULL,
	"description" text NOT NULL,
	"committee_name" text,
	"is_current" boolean NOT NULL,
	"start_date" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mk_votes" (
	"id" serial PRIMARY KEY NOT NULL,
	"mk_id" integer NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"bill_title" text NOT NULL,
	"vote" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mks" (
	"id" serial PRIMARY KEY NOT NULL,
	"oknesset_id" text DEFAULT '' NOT NULL,
	"knesset_site_id" text,
	"name" text NOT NULL,
	"email" text,
	"photo_url" text,
	"voting_summary" text,
	"source_url" text NOT NULL,
	"has_new_data" boolean DEFAULT false NOT NULL,
	"last_polled_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "mk_activity" ADD CONSTRAINT "mk_activity_mk_id_mks_id_fk" FOREIGN KEY ("mk_id") REFERENCES "public"."mks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mk_knesset_terms" ADD CONSTRAINT "mk_knesset_terms_mk_id_mks_id_fk" FOREIGN KEY ("mk_id") REFERENCES "public"."mks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mk_roles" ADD CONSTRAINT "mk_roles_mk_id_mks_id_fk" FOREIGN KEY ("mk_id") REFERENCES "public"."mks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mk_votes" ADD CONSTRAINT "mk_votes_mk_id_mks_id_fk" FOREIGN KEY ("mk_id") REFERENCES "public"."mks"("id") ON DELETE restrict ON UPDATE no action;