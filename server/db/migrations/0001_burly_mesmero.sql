CREATE TABLE "bills" (
	"id" serial PRIMARY KEY NOT NULL,
	"oknesset_id" text DEFAULT '' NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"status" text NOT NULL,
	"committee" text DEFAULT '' NOT NULL,
	"source_url" text NOT NULL,
	"document_url" text,
	"knesset_url" text,
	"knesset_number" integer NOT NULL,
	"has_new_data" boolean DEFAULT false NOT NULL,
	"last_polled_at" timestamp with time zone
);
