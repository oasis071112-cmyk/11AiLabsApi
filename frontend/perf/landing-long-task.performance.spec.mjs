import { expect, test } from '@playwright/test'
import { json } from './mock-api.mjs'

async function installLandingMock(page) {
  await page.route(/\/api\/public\/info(?:\?.*)?$/, route => json(route, {
    platform_name: 'IonAiLabs landing performance test', announcement: '', customer_service_text: '', customer_service_url: '',
  }))
}

test('landing startup avoids long main-thread tasks', async ({ page }) => {
  await page.addInitScript(() => {
    window.__longTasks = []
    new PerformanceObserver(list => {
      window.__longTasks.push(...list.getEntries().map(entry => entry.duration))
    }).observe({ type: 'longtask', buffered: true })
  })
  await installLandingMock(page)

  await page.goto('/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1_000)
  const longTasks = await page.evaluate(() => window.__longTasks)
  const maxLongTaskMs = Math.max(0, ...longTasks)

  expect(maxLongTaskMs, `landing max long task was ${maxLongTaskMs.toFixed(0)}ms`).toBeLessThan(50)
})

for (const width of [390, 768, 900, 1280]) {
  test(`landing deferred placeholders match final section heights at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await installLandingMock(page)
    await page.goto('/', { waitUntil: 'networkidle' })
    const sections = await page.evaluate(() => [...document.querySelectorAll('.landing-deferred-section')].map(section => {
      const style = getComputedStyle(section)
      const actualContentHeight = section.getBoundingClientRect().height
        - Number.parseFloat(style.paddingTop) - Number.parseFloat(style.paddingBottom)
        - Number.parseFloat(style.borderTopWidth) - Number.parseFloat(style.borderBottomWidth)
      return {
        key: section.dataset.deferredKey,
        expectedContentHeight: Number.parseFloat(style.getPropertyValue('--landing-deferred-size')),
        actualContentHeight,
      }
    }))

    const mismatches = sections.map(section => ({
      ...section,
      difference: Math.abs(section.actualContentHeight - section.expectedContentHeight),
    }))
    expect(Math.max(...mismatches.map(section => section.difference)), `placeholder mismatches: ${JSON.stringify(mismatches)}`).toBeLessThan(4)
  })
}
