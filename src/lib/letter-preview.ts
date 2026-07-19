/**
 * Wrap a letter's rendered HTML in a minimal RTL preview document.
 *
 * The stored letter HTML is a *fragment*: templated letters arrive wrapped in the
 * template's own styled `<div dir="rtl" …>`, but a letter with no template is the raw
 * body — no direction, no font, no width. Dropped straight into an `<iframe srcDoc>`
 * that renders as left-aligned default-serif full-width text.
 *
 * Wrapping both cases in the same shell makes every preview surface (the composer's
 * live preview, the member detail page, "open in new tab") render identically. The
 * template's inner styles still win for templated letters — these are only defaults.
 */
export function buildLetterPreviewDoc(html: string): string {
  return `<!doctype html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body {
    margin: 0;
    padding: 16px;
    font-family: Heebo, Arial, "Segoe UI", sans-serif;
    line-height: 1.7;
    color: #1a1a1a;
    text-align: right;
    word-wrap: break-word;
  }
  img { max-width: 100%; height: auto; }
  a { color: #2563eb; }
</style>
</head>
<body>${html}</body>
</html>`
}
