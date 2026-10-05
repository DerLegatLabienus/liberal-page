-- Read-only, allowlisted window onto the database for the unattended loop.
--
-- The role `loop_reader` can read ONLY the views in the `loop_read` schema. It has no access
-- to any real table, so a new table or column is invisible to it until someone adds it to a
-- view here on purpose. Views list their columns by name: never `SELECT *`.
--
-- Left out deliberately: everything in `auth` and `email`; every email address and phone
-- number; user ids; the cell's private notes on tracked bills; feature-flag values; draft
-- letters (only published ones are visible); the legacy content columns on `letters.letters`.
--
-- RISKY TIER (production data). Only the developer changes this file, and only the developer
-- runs it. The loop must never edit it: if the loop needs a table or column that is not here,
-- it asks (see "Data access" in scripts/loop/PROMPT.md).
--
-- Running it: idempotent. It drops and rebuilds the whole `loop_read` schema in one transaction.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/loop-read-views.sql
-- The role itself is created once, separately (it carries a password, which does not belong in
-- the repo). Create it with plain SQL, NOT in the Neon console or API: roles made there join
-- `neon_superuser` and could read everything.
--   CREATE ROLE loop_reader LOGIN PASSWORD '<long random>' CONNECTION LIMIT 3;
--   ALTER ROLE loop_reader SET default_transaction_read_only = on;
--   ALTER ROLE loop_reader SET statement_timeout = '15s';
--
-- MIGRATION HAZARD: Postgres refuses to drop or retype a column, or drop a table, that a view
-- depends on. A migration that does so must first run `DROP SCHEMA loop_read CASCADE;` and this
-- file must be re-run (and updated) after it. Migrations apply on boot, so forgetting this
-- fails the deploy; the health check then keeps the previous version running.

BEGIN;

DROP SCHEMA IF EXISTS loop_read CASCADE;
CREATE SCHEMA loop_read;

-- ── parliament ──────────────────────────────────────────────────────────────────────────────
CREATE VIEW loop_read.bills AS
  SELECT id, oknesset_id, number, title, status, committee, knesset_number, has_new_data, last_polled_at
  FROM parliament.bills;

CREATE VIEW loop_read.committees AS
  SELECT id, oknesset_id, name, chair, last_session_date, has_new_data, last_polled_at, inactive
  FROM parliament.committees;

CREATE VIEW loop_read.committee_sessions AS
  SELECT session_id, committee_id, date, knesset_num, title, attending_site_ids,
         (ai_summary IS NOT NULL) AS has_ai_summary, length(ai_summary) AS ai_summary_chars
  FROM parliament.committee_sessions;

CREATE VIEW loop_read.mks AS
  SELECT id, oknesset_id, knesset_site_id, name, (photo_url IS NOT NULL) AS has_photo,
         has_new_data, last_polled_at
  FROM parliament.mks;

CREATE VIEW loop_read.mk_knesset_terms AS
  SELECT id, mk_id, knesset_number, faction FROM parliament.mk_knesset_terms;

CREATE VIEW loop_read.mk_roles AS
  SELECT id, mk_id, position_id, description, committee_name, is_current, start_date
  FROM parliament.mk_roles;

CREATE VIEW loop_read.mk_activity AS
  SELECT id, mk_id, type, date, title FROM parliament.mk_activity;

CREATE VIEW loop_read.mk_votes AS
  SELECT id, mk_id, date, bill_title, vote FROM parliament.mk_votes;

CREATE VIEW loop_read.mk_annotations AS
  SELECT knesset_site_id, is_liberal, is_supporter FROM parliament.mk_annotations;

CREATE VIEW loop_read.knesset_members_cache AS
  SELECT site_id, name, party, is_liberal, is_supporter, cached_at
  FROM parliament.knesset_members_cache;

CREATE VIEW loop_read.knesset_committees_cache AS
  SELECT committee_id, name, cached_at FROM parliament.knesset_committees_cache;

CREATE VIEW loop_read.knesset_config AS
  SELECT id, current_knesset, detected_at FROM parliament.knesset_config;

CREATE VIEW loop_read.summaries_cache AS
  SELECT md5, created_at, source_url, derived_title, length(summary) AS summary_chars
  FROM parliament.summaries_cache;

-- Tracking rows without the user id or the cell's notes.
CREATE VIEW loop_read.tracked_bills AS
  SELECT id, bill_id, position, created_at FROM parliament.tracked_bills;

CREATE VIEW loop_read.tracked_committees AS
  SELECT id, committee_id, created_at FROM parliament.tracked_committees;

CREATE VIEW loop_read.tracked_mks AS
  SELECT id, mk_id, created_at FROM parliament.tracked_mks;

-- ── letters (published only; no addresses) ──────────────────────────────────────────────────
CREATE VIEW loop_read.letters WITH (security_barrier) AS
  SELECT id, title, template_id, issue_tag_ids, status, priority, pinned_at, activity_score,
         published_at, created_at, updated_at
  FROM letters.letters
  WHERE status = 'published';

CREATE VIEW loop_read.letter_channels WITH (security_barrier) AS
  SELECT c.id, c.letter_id, c.kind, c.enabled,
         jsonb_array_length(c.recipient_ids) AS recipient_count,
         jsonb_array_length(c.cc_ids) AS cc_count,
         jsonb_array_length(c.bcc_ids) AS bcc_count,
         length(c.body_text) AS body_text_chars,
         length(c.body_html) AS body_html_chars,
         (c.subject IS NOT NULL) AS has_subject,
         c.template_id, c.created_at, c.updated_at
  FROM letters.letter_channels c
  JOIN letters.letters l ON l.id = c.letter_id
  WHERE l.status = 'published';

-- Contacts: who and what kind, and whether each channel can reach them. No email, no phone.
CREATE VIEW loop_read.letter_contacts AS
  SELECT id, display_name, category, mk_site_id, created_at,
         (email IS NOT NULL AND email <> '') AS has_email,
         (phone IS NOT NULL AND phone <> '') AS has_phone,
         has_whatsapp
  FROM letters.letter_contacts;

CREATE VIEW loop_read.letter_issue_tags AS
  SELECT id, name, slug, created_at FROM letters.letter_issue_tags;

CREATE VIEW loop_read.letter_templates AS
  SELECT id, name, length(html) AS html_chars, updated_at FROM letters.letter_templates;

CREATE VIEW loop_read.letter_media_assets AS
  SELECT id, content_type, size_bytes, created_at FROM letters.letter_media_assets;

-- ── analytics (counts only) ─────────────────────────────────────────────────────────────────
CREATE VIEW loop_read.letter_analytics AS
  SELECT letter_id, bucket, total, created_at FROM analytics.letter_analytics;

CREATE VIEW loop_read.join_analytics AS
  SELECT bucket, total, created_at FROM analytics.join_analytics;

-- ── config (names and on/off only) ──────────────────────────────────────────────────────────
CREATE VIEW loop_read.feature_flags AS
  SELECT name, enabled, description, updated_at FROM config.feature_flags;

-- ── grants: the views and nothing else ──────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'loop_reader') THEN
    GRANT USAGE ON SCHEMA loop_read TO loop_reader;
    GRANT SELECT ON ALL TABLES IN SCHEMA loop_read TO loop_reader;
  ELSE
    RAISE NOTICE 'role loop_reader does not exist yet: views created, nothing granted';
  END IF;
END $$;

COMMIT;
