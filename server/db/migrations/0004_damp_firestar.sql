CREATE TABLE "knesset_committees_cache" (
	"committee_id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"knesset_url" text NOT NULL,
	"cached_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knesset_members_cache" (
	"site_id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"party" text NOT NULL,
	"photo_url" text,
	"is_liberal" boolean NOT NULL,
	"is_supporter" boolean NOT NULL,
	"cached_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "summaries_cache" (
	"md5" text PRIMARY KEY NOT NULL,
	"summary" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"source_url" text NOT NULL,
	"attendees" text[],
	"derived_title" text
);
--> statement-breakpoint
CREATE TABLE "mk_annotations" (
	"knesset_site_id" text PRIMARY KEY NOT NULL,
	"is_liberal" boolean NOT NULL,
	"is_supporter" boolean NOT NULL
);
