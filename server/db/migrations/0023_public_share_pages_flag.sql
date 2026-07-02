-- Seed the publicSharePages feature flag so existing/production DBs get it on boot
-- without a re-seed. Default off: gates backend generation of public R2 share pages.
-- Idempotent.
INSERT INTO "config"."feature_flags" ("name", "enabled", "value", "description", "updated_at")
VALUES ('publicSharePages', false, NULL, 'Generate public R2-served share pages for published letters', now())
ON CONFLICT ("name") DO NOTHING;
