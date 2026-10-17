import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, type Page } from 'playwright'

const baseUrl = process.env.OPENDESIGN_SCREENSHOT_BASE_URL ?? 'http://localhost:5173'
const outputDirectory = resolve(process.env.OPENDESIGN_SCREENSHOT_OUT ?? 'screenshots')
const presentationId = process.env.OPENDESIGN_SCREENSHOT_PRESENTATION_ID
const designSystemId = process.env.OPENDESIGN_SCREENSHOT_DESIGN_SYSTEM_ID

if (!presentationId || !designSystemId) throw new Error('Set OPENDESIGN_SCREENSHOT_PRESENTATION_ID and OPENDESIGN_SCREENSHOT_DESIGN_SYSTEM_ID using the ids printed by screenshots:seed.')

await mkdir(outputDirectory, { recursive: true })
const browser = await chromium.launch({ headless: true })

async function capture(page: Page, name: string, url: string, readySelector: string) {
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.locator(readySelector).waitFor({ state: 'visible', timeout: 30_000 })
  await page.screenshot({ path: resolve(outputDirectory, `${name}.png`), fullPage: false, animations: 'disabled' })
}

try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })
  await capture(page, '01-project-gallery', baseUrl, '.project-grid, .empty-projects')
  await capture(page, '02-presentation-editor', `${baseUrl}/?project=${presentationId}&slide=1`, '.editor-shell .stage-wrap iframe')
  await page.getByRole('tab', { name: 'Activity' }).click()
  await page.locator('.agent-activity-view').waitFor({ state: 'visible', timeout: 15_000 })
  await page.screenshot({ path: resolve(outputDirectory, '03-agent-activity.png'), fullPage: false, animations: 'disabled' })
  await capture(page, '04-design-system-editor', `${baseUrl}/?project=${designSystemId}&slide=1`, '.editor-shell .stage-wrap iframe')
  await browser.close()
  console.log(`Saved four OpenDesign screenshots to ${outputDirectory}`)
} catch (error) {
  await browser.close()
  throw error
}
