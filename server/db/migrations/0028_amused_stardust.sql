ALTER TABLE "letters"."letters" ALTER COLUMN "subject" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "letters"."letters" ALTER COLUMN "body_html" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "letters"."letters" ALTER COLUMN "body_plain" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "letters"."letters" ADD COLUMN "share_slug" text DEFAULT replace(gen_random_uuid()::text, '-', '') NOT NULL;--> statement-breakpoint
ALTER TABLE "letters"."letters" ADD CONSTRAINT "letters_share_slug_unique" UNIQUE("share_slug");