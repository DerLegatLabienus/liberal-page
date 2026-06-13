-- Seed the recentRanking feature flag so existing/production DBs get it
-- on boot without a re-seed. Value "newest" = current behaviour; "progress"
-- re-ranks the Recent tab by most recent committee session. Idempotent.
INSERT INTO "feature_flags" ("name", "enabled", "value", "description", "updated_at")
VALUES ('recentRanking', true, 'newest', 'Recent tab ordering: "newest" (BillID desc) or "progress" (max committee session)', now())
ON CONFLICT ("name") DO NOTHING;
