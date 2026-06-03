-- Seed the storagePressure feature flag (on by default) so existing/production DBs get it
-- on boot without a re-seed. Value is "limitMb:slackMb"; "-1" disables. Idempotent.
INSERT INTO "feature_flags" ("name", "enabled", "value", "description", "updated_at")
VALUES ('storagePressure', true, '450:2', 'Orphan-purge config "limitMb:slackMb"; "-1" disables', now())
ON CONFLICT ("name") DO NOTHING;
