import { test, expect, goTo, runAndCommitScrape } from './fixtures/app'

test.describe('Analytics Module', () => {
  test('Analytics view renders with all metric sections', async ({ page }) => {
    await goTo(page, 'Analytics')
    await expect(page.getByText(/Funnel|Response rate|Conversion/i).first()).toBeVisible()
    await expect(page.getByText(/By source/i)).toBeVisible()
    await expect(page.getByText(/By seniority/i)).toBeVisible()
    await expect(page.getByText(/LLM cost|AI cost/i)).toBeVisible()
  })

  test('funnel counts update after postings are moved through statuses', async ({ page }) => {
    await runAndCommitScrape(page)

    // Favorite and advance one posting to applied
    await goTo(page, 'Jobs')
    await page.locator('select').first().selectOption('favorited')
    await goTo(page, 'Tracker')
    await page.locator('table tbody tr').first().locator('select').selectOption('applied')

    await goTo(page, 'Analytics')
    // Applied count should be at least 1
    await expect(page.getByText(/^1$/).first().or(page.getByText(/applied.*1|1.*applied/i))).toBeVisible({ timeout: 5_000 })
  })

  test('by-source table shows the mock adapter as a row', async ({ page }) => {
    await runAndCommitScrape(page)

    // Advance one mock posting to applied so it appears in the By Source table,
    // which now filters to applied+ statuses.
    await goTo(page, 'Jobs')
    await page.locator('select').first().selectOption('favorited')
    await goTo(page, 'Tracker')
    await page.locator('table tbody tr').first().locator('select').selectOption('applied')

    await goTo(page, 'Analytics')
    await expect(page.getByText(/mock/i)).toBeVisible({ timeout: 5_000 })
  })

  test('weekly time series chart is visible', async ({ page }) => {
    await goTo(page, 'Analytics')
    // Recharts renders an SVG; verify the chart container is present
    await expect(page.locator('svg, canvas, [class*="chart"], [class*="recharts"]').first()).toBeVisible({ timeout: 5_000 })
  })

  test('LLM cost summary shows zero when no real Claude calls are made', async ({ page }) => {
    await goTo(page, 'Analytics')
    // Stubs do not write llm_usage records, so cost should be $0.00
    await expect(page.getByText(/\$0\.00|0\.00/)).toBeVisible({ timeout: 5_000 })
  })

  test('response rate and conversion rate are present in the funnel section', async ({ page }) => {
    await goTo(page, 'Analytics')
    await expect(page.getByText(/Response rate/i)).toBeVisible()
    await expect(page.getByText(/Conversion rate/i)).toBeVisible()
  })
})
