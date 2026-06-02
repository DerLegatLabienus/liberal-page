CREATE TABLE "join_analytics" (
	"bucket" text PRIMARY KEY NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"breakdown" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
