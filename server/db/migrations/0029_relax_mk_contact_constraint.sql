-- Relax the "reachable by a channel" invariant so an MK contact (identified by mk_site_id) may be
-- channel-less — a directory entry whose phone/email can be filled in later (e.g. Norwegian-Law
-- ministers, who have no public Knesset email/phone). Non-MK contacts still require email or phone.
ALTER TABLE "letters"."letter_contacts" DROP CONSTRAINT IF EXISTS "letter_contacts_email_or_phone";--> statement-breakpoint
ALTER TABLE "letters"."letter_contacts"
  ADD CONSTRAINT "letter_contacts_email_or_phone"
  CHECK ("email" IS NOT NULL OR "phone" IS NOT NULL OR "mk_site_id" IS NOT NULL);
