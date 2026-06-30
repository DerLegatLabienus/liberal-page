CREATE TABLE "letters"."letter_media_assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"uploaded_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "letter_media_assets_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "letters"."letter_media_assets" ADD CONSTRAINT "letter_media_assets_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;