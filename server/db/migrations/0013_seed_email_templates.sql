-- Custom SQL migration file, put your code below! --
INSERT INTO email_templates (name, subject, html) VALUES (
  '_layout', '',
  '<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;background:#f6f6f6;padding:24px"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;padding:24px;color:#222"><h2 style="margin:0 0 16px">{{subject}}</h2>{{content}}<hr style="border:none;border-top:1px solid #eee;margin:24px 0"><p style="font-size:12px;color:#999">התא הליברלי</p></div></div>'
) ON CONFLICT (name) DO NOTHING;
--> statement-breakpoint
INSERT INTO email_templates (name, subject, html) VALUES (
  'invite', 'הוזמנת למעקב הפרלמנטרי',
  '<p>הוזמנת להצטרף למעקב הפרלמנטרי של התא הליברלי{{roleLine}}.</p><p><a href="{{siteUrl}}">היכנס/י כאן</a> והתחבר/י באמצעות חשבון Google שלך.</p>'
) ON CONFLICT (name) DO NOTHING;
--> statement-breakpoint
INSERT INTO email_templates (name, subject, html) VALUES (
  'bill_digest', 'עדכון בהצעות חוק שאתה עוקב אחריהן ({{count}})',
  '<p>שלום {{name}},</p><p>חל שינוי בסטטוס של הצעות החוק הבאות שאתה עוקב אחריהן:</p>{{bills}}'
) ON CONFLICT (name) DO NOTHING;
--> statement-breakpoint
INSERT INTO email_templates (name, subject, html) VALUES (
  'bill_digest_item', '',
  '<div style="margin:0 0 12px;padding:12px;border:1px solid #eee;border-radius:6px"><a href="{{knessetUrl}}" style="font-weight:bold">{{title}}</a><div style="font-size:13px;color:#555">{{oldStatus}} ← {{newStatus}}</div></div>'
) ON CONFLICT (name) DO NOTHING;
