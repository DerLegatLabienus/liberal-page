-- Seed the AI-beautify feature flag (off by default — capability stays dark until enabled).
INSERT INTO "feature_flags" ("name", "enabled", "value", "description", "updated_at")
VALUES ('lettersBeautifyEnabled', false, '', 'Enables the AI "beautify" button in the letter composer', now())
ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint
-- Seed three default letter templates. Each must contain {{CONTENT}} (where the letter body
-- is injected) and use dir="rtl". Each INSERT is split by a statement-breakpoint for pglite.
INSERT INTO "letter_templates" ("name", "html", "updated_at")
VALUES ('רגיל', '<div dir="rtl" style="text-align:right;font-family:Heebo,Arial,sans-serif;line-height:1.7;color:#1a1a1a">{{CONTENT}}</div>', now())
ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint
INSERT INTO "letter_templates" ("name", "html", "updated_at")
VALUES ('מכתב רשמי', '<div dir="rtl" style="text-align:right;font-family:Heebo,Arial,sans-serif;line-height:1.7;color:#1a1a1a;max-width:640px;margin:0 auto"><header style="border-bottom:2px solid #0a4595;padding-bottom:8px;margin-bottom:20px"><h2 style="margin:0;color:#0a4595">הליברלים בליכוד</h2><p style="margin:2px 0 0;font-size:13px;color:#555">תנועה ליברלית בתוך הליכוד</p></header>{{CONTENT}}<p style="margin-top:28px">בכבוד רב,</p><p style="margin-top:4px;color:#555">______________________</p></div>', now())
ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint
INSERT INTO "letter_templates" ("name", "html", "updated_at")
VALUES ('ממותג', '<div dir="rtl" style="text-align:right;font-family:Heebo,Arial,sans-serif;line-height:1.7;color:#1a1a1a;max-width:640px;margin:0 auto"><header style="display:flex;align-items:center;gap:12px;border-bottom:3px solid #0a4595;padding-bottom:12px;margin-bottom:20px"><img src="https://likudliberal.org/wp-content/uploads/2020/05/dz7h5hxt.png" alt="הליברלים בליכוד" width="48" height="48" /><div><h2 style="margin:0;color:#0a4595">הליברלים בליכוד</h2><p style="margin:2px 0 0;font-size:13px;color:#555">פועלים לחירות הפרט ולשוק חופשי</p></div></header>{{CONTENT}}<p style="margin-top:28px">בכבוד רב,</p><p style="margin-top:4px;color:#555">______________________</p></div>', now())
ON CONFLICT ("name") DO NOTHING;
