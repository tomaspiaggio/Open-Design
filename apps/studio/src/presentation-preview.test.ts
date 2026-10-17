import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { chromium } from 'playwright'
import { presentationHostStyles, presentationNavigationScript, presentationThumbnailTarget } from './presentation-preview.js'

const stackedDeck = `<!doctype html><html><head><style>
  *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;padding:28px 16px 56px}
  main.deck{display:flex;flex-direction:column;align-items:center;gap:30px}
  section.slide{width:1280px;height:720px;overflow:hidden;display:grid;place-items:center;font:64px sans-serif}
  section.slide:nth-child(1){background:#d14f26;color:white}section.slide:nth-child(2){background:#275db8;color:white}
</style></head><body><main class="deck"><section class="slide"><h1>First</h1></section><section class="slide"><h1>Second</h1></section></main></body></html>`

async function pageWithHost(index: number) {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const hostStyles = presentationHostStyles(stackedDeck, 'slides')
  const hostScript = presentationNavigationScript(index)
  await page.setContent(stackedDeck.replace('</head>', `<style>${hostStyles}</style></head>`).replace('</body>', `${hostScript}</body>`))
  return { browser, page }
}

test('stacked presentation preview responds to the editor slide selector', async () => {
  const { browser, page } = await pageWithHost(1)
  try {
    await page.evaluate(`dispatchEvent(new MessageEvent('message', { source: window, data: { type: 'opendesign-select-slide', index: 2 } }))`)
    await page.waitForFunction(() => document.body.scrollTop > 0)
    assert.equal(await page.locator('.slide').nth(1).getAttribute('aria-hidden'), 'false')
  } finally { await browser.close() }
})

test('stacked presentation preview scrolls the requested slide into view', async () => {
  const { browser, page } = await pageWithHost(1)
  try {
    const selectedSlide = await page.evaluate(`new Promise(resolve => {
      const receive = event => {
        if (event.data?.type !== 'opendesign-slide-changed') return
        window.removeEventListener('message', receive)
        resolve(event.data.slide)
      }
      window.addEventListener('message', receive)
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
    })`)
    assert.equal(selectedSlide, 2)
    await page.waitForFunction(() => document.body.scrollTop > 0)
    assert.equal(await page.locator('.slide').nth(1).getAttribute('aria-hidden'), 'false')
    assert.ok(await page.locator('body').evaluate(element => element.scrollTop > 0), 'the iframe document should scroll to slide 2')
  } finally { await browser.close() }
})

test('stacked presentation thumbnails capture the requested slide, not always the cover', async () => {
  const { browser, page } = await pageWithHost(1)
  try {
    const first = await (await presentationThumbnailTarget(page, 1)).screenshot({ animations: 'disabled' })
    const second = await (await presentationThumbnailTarget(page, 2)).screenshot({ animations: 'disabled' })
    assert.notEqual(createHash('sha256').update(first).digest('hex'), createHash('sha256').update(second).digest('hex'))
  } finally { await browser.close() }
})

test('fixed-stage presentations keep overflow clipped', () => {
  assert.match(presentationHostStyles('<main class="stage"></main>', 'slides'), /overflow:hidden/)
})
