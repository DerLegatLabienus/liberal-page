CREATE TABLE "letters"."letter_channels" (
	"id" serial PRIMARY KEY NOT NULL,
	"letter_id" integer NOT NULL,
	"kind" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"recipient_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cc_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bcc_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"body_text" text DEFAULT '' NOT NULL,
	"subject" text,
	"body_html" text,
	"template_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "letter_channels_letter_id_kind_unique" UNIQUE("letter_id","kind")
);
--> statement-breakpoint
ALTER TABLE "letters"."letter_contacts" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "letters"."letter_contacts" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "letters"."letter_contacts" ADD COLUMN "has_whatsapp" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "letters"."letter_contacts" ADD COLUMN "photo_url" text;--> statement-breakpoint
ALTER TABLE "letters"."letter_contacts" ADD COLUMN "mk_site_id" integer;--> statement-breakpoint
ALTER TABLE "letters"."letter_channels" ADD CONSTRAINT "letter_channels_letter_id_letters_id_fk" FOREIGN KEY ("letter_id") REFERENCES "letters"."letters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letters"."letter_channels" ADD CONSTRAINT "letter_channels_template_id_letter_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "letters"."letter_templates"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- Relax the legacy letters content columns so new inserts (which write channels
-- instead) don't trip NOT NULL during the transition window.
ALTER TABLE "letters"."letters" ALTER COLUMN "subject" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "letters"."letters" ALTER COLUMN "body_html" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "letters"."letters" ALTER COLUMN "body_plain" DROP NOT NULL;
--> statement-breakpoint
-- A contact must be reachable by at least one channel.
ALTER TABLE "letters"."letter_contacts"
  ADD CONSTRAINT "letter_contacts_email_or_phone"
  CHECK ("email" IS NOT NULL OR "phone" IS NOT NULL);
--> statement-breakpoint
-- Email channels must carry a subject + HTML body.
ALTER TABLE "letters"."letter_channels"
  ADD CONSTRAINT "letter_channels_email_content"
  CHECK ("kind" <> 'email' OR ("subject" IS NOT NULL AND "body_html" IS NOT NULL));