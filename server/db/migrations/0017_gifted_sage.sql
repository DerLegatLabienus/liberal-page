CREATE TABLE "letter_analytics" (
	"letter_id" integer NOT NULL,
	"bucket" text NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"breakdown" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "letter_analytics_letter_id_bucket_pk" PRIMARY KEY("letter_id","bucket")
);
--> statement-breakpoint
CREATE TABLE "letter_contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"email" text NOT NULL,
	"category" text DEFAULT 'custom' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "letter_contacts_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "letter_issue_tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "letter_issue_tags_name_unique" UNIQUE("name"),
	CONSTRAINT "letter_issue_tags_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "letter_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"html" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "letter_templates_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "letters" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"subject" text NOT NULL,
	"body_html" text NOT NULL,
	"body_plain" text NOT NULL,
	"template_id" integer,
	"to_addresses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cc_addresses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bcc_addresses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"issue_tag_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"pinned_at" timestamp with time zone,
	"pin_notified_at" timestamp with time zone,
	"activity_score" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "letter_analytics" ADD CONSTRAINT "letter_analytics_letter_id_letters_id_fk" FOREIGN KEY ("letter_id") REFERENCES "public"."letters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letters" ADD CONSTRAINT "letters_template_id_letter_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."letter_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letters" ADD CONSTRAINT "letters_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "feature_flags" ("name", "enabled", "value", "description", "updated_at")
VALUES ('lettersEnabled', false, '', 'Enables the member-facing /letters page', now())
ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint
INSERT INTO "email_templates" ("name", "subject", "html", "updated_at")
VALUES ('letter_pin', 'מכתב חדש ממוקד ממתין לשליחה שלך', '<p>שלום {{name}},</p><p>המכתבים הבאים ממוקדים ודורשים תשומת לבך:</p>{{lettersList}}', now())
ON CONFLICT ("name") DO NOTHING;