-- Bootstrap the first admin (chicken-and-egg: can't be invited by an admin). Idempotent.
-- This admin then invites/promotes the rest of the closed group.
INSERT INTO "allowed_emails" ("email", "role", "created_at")
VALUES ('avivavitan63@gmail.com', 'admin', now())
ON CONFLICT ("email") DO NOTHING;
