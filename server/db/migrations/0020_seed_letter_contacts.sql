-- Seed default letter address-book contacts so the address book is populated when the
-- service starts from scratch (migrations run automatically on boot via runMigrations()).
-- Idempotent via ON CONFLICT ("email") DO NOTHING: the migration applies once per DB, and
-- even re-applied it never duplicates rows nor clobbers admin-curated contacts.
--
-- Ministry spokesperson / public-relations ROLE mailboxes (dover@/dovrut@<ministry>.gov.il),
-- verified from the official gov.il spokesperson directory:
--   https://www.gov.il/BlobFolder/generalpage/spokesmen_lists/he/file_דוברי-ממשלה.pdf
-- The directory is ~2019-2020 vintage; generic ROLE mailboxes were chosen deliberately
-- because they survive minister turnover (dover@mod.gov.il re-confirmed live on mod.gov.il
-- in 2026). Personal addresses and non-ministry bodies were excluded so that
-- category='ministry' stays truthful. Refresh against the latest directory periodically.
INSERT INTO "letter_contacts" ("display_name", "email", "category") VALUES
  ('משרד הביטחון', 'dover@mod.gov.il', 'ministry'),
  ('משרד הבריאות', 'dover@moh.gov.il', 'ministry'),
  ('משרד החינוך', 'dovrut@education.gov.il', 'ministry'),
  ('משרד המשפטים', 'dover@justice.gov.il', 'ministry'),
  ('משרד האוצר', 'dover@mof.gov.il', 'ministry'),
  ('משרד הכלכלה והתעשייה', 'dover@economy.gov.il', 'ministry'),
  ('משרד האנרגיה', 'dover@energy.gov.il', 'ministry'),
  ('משרד החקלאות ופיתוח הכפר', 'dover@moag.gov.il', 'ministry'),
  ('משרד העבודה והרווחה', 'dover@molsa.gov.il', 'ministry'),
  ('משרד התחבורה', 'dover@mot.gov.il', 'ministry'),
  ('משרד התקשורת', 'dovrut@moc.gov.il', 'ministry'),
  ('משרד הפנים', 'dovrut@moin.gov.il', 'ministry')
ON CONFLICT ("email") DO NOTHING;
--> statement-breakpoint
-- Baseline MK mailboxes (@knesset.gov.il) from the curated seed roster.
INSERT INTO "letter_contacts" ("display_name", "email", "category") VALUES
  ('אבי דיכטר', 'davraham@knesset.gov.il', 'mk'),
  ('דן אילוז', 'hak_diluz@knesset.gov.il', 'mk'),
  ('אופיר כץ', 'okatz@knesset.gov.il', 'mk'),
  ('אבי מעוז', 'amaaoz@knesset.gov.il', 'mk')
ON CONFLICT ("email") DO NOTHING;
