import { chromium } from 'playwright'

// Browser-level golden-path smoke check. Deliberately narrow — one spec, one path —
// this is a sanity check for whole-page wiring (RTL/i18n, section gating), not an
// e2e suite. Requires the local dev stack already running: `npm run dev`.
const FRONTEND_URL = 'http://localhost:5173/liberal-page/'
const KNESSET_HEADING = 'מה קורה בכנסת' // hardcoded in KnessetBillsOverview.tsx

async function main() {
  const failures: string[] = []
  const check = (label: string, ok: boolean) => {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`)
    if (!ok) failures.push(label)
  }

  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()

    try {
      await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: 10_000 })
    } catch (e) {
      console.error(`\nCould not reach ${FRONTEND_URL} — is \`npm run dev\` running?`)
      console.error(e instanceof Error ? e.message : e)
      process.exitCode = 1
      return
    }

    check('page title is the site title', (await page.title()) === 'הליברלים בליכוד')

    const htmlEl = page.locator('html')
    check('default direction is rtl', (await htmlEl.getAttribute('dir')) === 'rtl')
    check('default language is he', (await htmlEl.getAttribute('lang')) === 'he')

    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
    check('Knesset tracker section renders in Hebrew', await page.getByText(KNESSET_HEADING).isVisible().catch(() => false))

    const toggle = page.getByRole('button', { name: 'EN' })
    check('language toggle is present', await toggle.isVisible().catch(() => false))
    await toggle.click()

    check('direction flips to ltr after toggle', await htmlEl.getAttribute('dir').then((d) => d === 'ltr'))
    check('language flips to en after toggle', await htmlEl.getAttribute('lang').then((l) => l === 'en'))
    check('Knesset tracker section is hidden in English', !(await page.getByText(KNESSET_HEADING).isVisible().catch(() => false)))

    if (failures.length > 0) {
      console.error(`\nBrowser smoke test FAILED (${failures.length}):`)
      for (const f of failures) console.error(`  - ${f}`)
      process.exitCode = 1
    } else {
      console.log('\nBrowser smoke test passed.')
    }
  } finally {
    await browser.close()
  }
}

main()
