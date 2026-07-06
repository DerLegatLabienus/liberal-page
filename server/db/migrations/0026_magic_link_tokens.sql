CREATE TABLE IF NOT EXISTS "auth"."magic_link_tokens" (
  "id" serial PRIMARY KEY,
  "email" text NOT NULL,
  "token_hash" text NOT NULL UNIQUE,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
INSERT INTO "email"."email_templates" (name, subject, html) VALUES (
  'magic_link', 'קישור התחברות למעקב הפרלמנטרי',
  '<p>קיבלת בקשה להתחברות למעקב הפרלמנטרי של התא הליברלי.</p><p><a href="{{link}}">היכנס/י כאן</a> (הקישור בתוקף ל-15 דקות ומיועד לשימוש חד-פעמי).</p><p>אם לא ביקשת זאת, אפשר להתעלם מהודעה זו.</p>'
) ON CONFLICT (name) DO NOTHING;
