CREATE TABLE "feature_flags" (
	"name" text PRIMARY KEY NOT NULL,
	"enabled" boolean NOT NULL,
	"value" text,
	"description" text,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knesset_config" (
	"id" integer PRIMARY KEY NOT NULL,
	"current_knesset" integer NOT NULL,
	"detected_at" timestamp with time zone NOT NULL
);
