-- Seed the publicSendTurnstile feature flag (default off): gates server-side
-- Cloudflare Turnstile verification of public letter sends. Idempotent.
INSERT INTO "config"."feature_flags" ("name", "enabled", "value", "description", "updated_at")
VALUES ('publicSendTurnstile', false, NULL, 'Verify Cloudflare Turnstile before counting public letter sends', now())
ON CONFLICT ("name") DO NOTHING;
