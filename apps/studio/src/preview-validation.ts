import { chromium } from 'playwright'

export type PreviewInspection = {
  errors: string[]
  empty: boolean
  overflow: boolean
  metrics: {
    width: number
    height: number
    viewportWidth: number
    viewportHeight: number
    visibleTextLength: number
    visibleMediaCount: number
    mainHeight: number
  }
}

export async function inspectPreviewHtml(html: string): Promise<PreviewInspection> {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await page.setContent(html, { waitUntil: 'networkidle' })
    const metrics = await page.evaluate(() => {
      const main = document.querySelector('main')
      const mainHeight = main?.getBoundingClientRect().height ?? document.body.getBoundingClientRect().height
      const visibleTextLength = document.body.innerText.trim().length
      let visibleMediaCount = 0
      for (const element of document.querySelectorAll('img,svg,canvas,video,iframe')) {
        const style = getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        if (style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && rect.width > 1 && rect.height > 1) visibleMediaCount++
      }
      return {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        visibleTextLength,
        visibleMediaCount,
        mainHeight,
      }
    })
    const empty = metrics.visibleTextLength === 0 && metrics.visibleMediaCount === 0 && metrics.mainHeight < 2
    return { errors, empty, overflow: metrics.width > metrics.viewportWidth || metrics.height > metrics.viewportHeight, metrics }
  } finally {
    await browser.close()
  }
}
