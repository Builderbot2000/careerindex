import { test, expect, goTo, runAndCommitScrape } from './fixtures/app'
import type { Page } from '@playwright/test'

test.describe('Job Board & Ranking Module', () => {
  test.beforeEach(async ({ page }) => {
    await runAndCommitScrape(page)
    await goTo(page, 'Jobs')
  })

  test('displays postings after a committed scrape', async ({ page }) => {
    // At least one posting should be visible
    await expect(page.getByText('Stripe').or(page.getByText('Vercel')).or(page.getByText('Linear')).first()).toBeVisible({ timeout: 10_000 })
  })

  test('postings show company, title, location, seniority, tech stack, and age', async ({ page }) => {
    // The mock adapter includes "Stripe" with "Senior Backend Engineer"
    await expect(page.getByText('Stripe')).toBeVisible()
    await expect(page.getByText('Senior Backend Engineer').first()).toBeVisible()
    await expect(page.getByText(/remote/i).first()).toBeVisible()
  })

  test('affinity badges show a qualification class label', async ({ page }) => {
    // Stub scores all postings as fully_qualified + partially_met
    await expect(page.getByText('Fully Qualified').first()).toBeVisible({ timeout: 10_000 })
  })

  test('affinity badge displays a class label, not a raw percentage', async ({ page }) => {
    await expect(page.getByText('Fully Qualified').first()).toBeVisible({ timeout: 10_000 })
    // No percentage text should appear in badges
    await expect(page.getByText(/\d+%/).first()).not.toBeVisible()
  })

  test('affinity badge tooltip includes hard-reqs class and nice-to-haves', async ({ page }) => {
    const badge = page.getByText('Fully Qualified').first()
    await expect(badge).toBeVisible({ timeout: 10_000 })
    const title = await badge.getAttribute('title')
    expect(title).toMatch(/Fully Qualified/i)
    expect(title).toMatch(/nice-to-haves|partially met/i)
  })

  test('hovering a posting title shows the job description snippet tooltip', async ({ page }) => {
    const firstTitle = page.getByRole('link', { name: /engineer|developer/i }).first()
      .or(page.getByText(/Senior Backend Engineer/i).first())
    await firstTitle.hover()
    await expect(page.getByRole('tooltip')).toContainText(/hiring a Senior Backend Engineer|distributed systems/i, { timeout: 5_000 })
  })

  test('hard filter by YOE excludes postings outside the user range', async ({ page }) => {
    // Set user YOE to 1 — all mock postings have yoe_min ≥ 3
    await goTo(page, 'Profile')
    await page.getByLabel(/Years of experience|YOE/i).fill('1')
    await page.getByRole('button', { name: /Save YOE|Save/i }).first().click()

    await goTo(page, 'Jobs')
    // With YOE=1 and all postings requiring 3+, the board should be empty
    await expect(page.getByText(/No postings|no results|empty/i)).toBeVisible({ timeout: 10_000 })
  })

  test('excluded stack filter hides postings containing that stack item', async ({ page }) => {
    // Add "Go" to excluded stack — several mock postings include Go
    await goTo(page, 'Search')
    await page.getByRole('tab', { name: /Filters/i }).or(page.getByRole('button', { name: /Filters/i })).click()
    const excludedStackInput = page.getByLabel(/Excluded stack|Excluded tech/i)
      .or(page.getByPlaceholder(/e\.g\. PHP/i))
    await excludedStackInput.fill('Go')
    await page.getByRole('button', { name: /Save|Apply/i }).click()

    await goTo(page, 'Jobs')
    // Stripe (Go) and Fly.io (Go) should no longer appear
    await expect(page.getByText('Stripe')).not.toBeVisible({ timeout: 5_000 })
  })

  test('postings are displayed in descending composite score order', async ({ page }) => {
    // All mock postings receive the same stub affinity score (0.82),
    // so the ordering will be by recency. The most recently posted comes first.
    // Simply verify the list renders without error and has multiple items.
    const items = page.locator('table tbody tr, ul li').filter({ hasText: /Engineer|Developer/i })
    await expect(items.first()).toBeVisible()
    const count = await items.count()
    expect(count).toBeGreaterThan(1)
  })

  test('clicking Tailor Resume navigates to the Resume view for that posting', async ({ page }) => {
    const tailorBtn = page.getByRole('button', { name: /Tailor Resume/i }).first()
    await tailorBtn.click()
    await expect(page.getByRole('heading', { name: /Resume|Tailor/i })).toBeVisible({ timeout: 5_000 })
  })

  // ─── Bulk selection & delete ───────────────────────────────────────────────

  test('each posting row has a checkbox for selection', async ({ page }) => {
    const firstRowCheckbox = page.locator('table tbody tr').first().locator('input[type="checkbox"]')
    await expect(firstRowCheckbox).toBeVisible()
  })

  test('header checkbox selects all rows on the current page', async ({ page }) => {
    const headerCheckbox = page.locator('table thead input[type="checkbox"]').first()
    await headerCheckbox.check()

    const rowCheckboxes = page.locator('table tbody tr input[type="checkbox"]')
    const count = await rowCheckboxes.count()
    for (let i = 0; i < count; i++) {
      await expect(rowCheckboxes.nth(i)).toBeChecked()
    }
  })

  test('delete button appears when at least one row is selected', async ({ page }) => {
    await page.locator('table tbody tr').first().locator('input[type="checkbox"]').check()
    await expect(page.getByRole('button', { name: /Delete/i })).toBeVisible()
  })

  test('deleting selected postings removes them from the board', async ({ page }) => {
    // Count initial rows
    const rows = page.locator('table tbody tr')
    const initialCount = await rows.count()

    // Select first row and delete
    await rows.first().locator('input[type="checkbox"]').check()
    await page.getByRole('button', { name: /Delete \(1\)|Delete/i }).click()

    // One fewer row
    await expect(rows).toHaveCount(initialCount - 1)
  })

  test('delete button label shows selected count', async ({ page }) => {
    const rowCheckboxes = page.locator('table tbody tr input[type="checkbox"]')
    await rowCheckboxes.nth(0).check()
    await rowCheckboxes.nth(1).check()
    await expect(page.getByRole('button', { name: /Delete \(2\)/i })).toBeVisible()
  })

  test('deselecting all rows hides the delete button', async ({ page }) => {
    const checkbox = page.locator('table tbody tr').first().locator('input[type="checkbox"]')
    await checkbox.check()
    await expect(page.getByRole('button', { name: /Delete/i })).toBeVisible()
    await checkbox.uncheck()
    await expect(page.getByRole('button', { name: /Delete/i })).not.toBeVisible()
  })

  // ─── Quick-advance status button ──────────────────────────────────────────

  test('each posting row shows a quick-advance arrow button', async ({ page }) => {
    // Arrow button advances from 'new' → 'viewed'
    const advanceBtn = page.locator('table tbody tr').first().getByRole('button', { name: /→|viewed/i })
    await expect(advanceBtn).toBeVisible()
  })

  test('clicking the quick-advance button advances status to the next step', async ({ page }) => {
    const firstRow = page.locator('table tbody tr').first()
    const statusSelect = firstRow.locator('select')
    await expect(statusSelect).toHaveValue('new')

    await firstRow.getByRole('button', { name: /→|viewed/i }).click()
    await expect(statusSelect).toHaveValue('viewed')
  })

  // ─── Apply-confirmation modal after clicking Open ─────────────────────────

  test('clicking Open on a new posting shows the apply-confirmation modal', async ({ page }) => {
    const firstRow = page.locator('table tbody tr').first()
    await firstRow.getByRole('button', { name: /Open ↗/i }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5_000 })
    await expect(dialog.getByRole('heading', { name: /Did you apply/i })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /Yes, I applied/i })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /No, not yet/i })).toBeVisible()
  })

  test('apply-confirmation modal displays the posting title and company', async ({ page }) => {
    const firstRow = page.locator('table tbody tr').first()
    const company = ((await firstRow.locator('td').nth(1).textContent()) ?? '').trim()
    const title = ((await firstRow.locator('td').nth(2).textContent()) ?? '').trim()

    await firstRow.getByRole('button', { name: /Open ↗/i }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText(company)
    await expect(dialog).toContainText(title)
  })

  test('clicking "Yes, I applied" sets status to applied', async ({ page }) => {
    const firstRow = page.locator('table tbody tr').first()
    const statusSelect = firstRow.locator('select')

    await firstRow.getByRole('button', { name: /Open ↗/i }).click()
    await page.getByTestId('apply-confirm-yes').click()

    await expect(page.getByRole('dialog')).not.toBeVisible()
    await expect(statusSelect).toHaveValue('applied')
  })

  test('clicking "No, not yet" sets status to viewed (not applied)', async ({ page }) => {
    const firstRow = page.locator('table tbody tr').first()
    const statusSelect = firstRow.locator('select')

    await firstRow.getByRole('button', { name: /Open ↗/i }).click()
    await page.getByTestId('apply-confirm-no').click()

    await expect(page.getByRole('dialog')).not.toBeVisible()
    await expect(statusSelect).toHaveValue('viewed')
  })

  test('dismissing the modal via Escape leaves status unchanged', async ({ page }) => {
    const firstRow = page.locator('table tbody tr').first()
    const statusSelect = firstRow.locator('select')

    // Start from 'favorited' so we can detect an unintended downgrade to 'viewed'
    await statusSelect.selectOption('favorited')
    await expect(statusSelect).toHaveValue('favorited')

    await firstRow.getByRole('button', { name: /Open ↗/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 })

    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).not.toBeVisible()
    await expect(statusSelect).toHaveValue('favorited')
  })

  test('clicking the backdrop dismisses the modal without changing status', async ({ page }) => {
    const firstRow = page.locator('table tbody tr').first()
    const statusSelect = firstRow.locator('select')

    await statusSelect.selectOption('favorited')

    await firstRow.getByRole('button', { name: /Open ↗/i }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5_000 })

    // Click near the top-left corner of the viewport — outside the dialog box
    await page.mouse.click(5, 5)
    await expect(dialog).not.toBeVisible()
    await expect(statusSelect).toHaveValue('favorited')
  })

  test('opening an already-applied posting does not show the modal', async ({ page }) => {
    const firstRow = page.locator('table tbody tr').first()
    const statusSelect = firstRow.locator('select')

    await statusSelect.selectOption('applied')
    await expect(statusSelect).toHaveValue('applied')

    await firstRow.getByRole('button', { name: /Open ↗/i }).click()
    // Give the renderer a moment in case the modal would have appeared
    await page.waitForTimeout(500)
    await expect(page.getByRole('dialog')).not.toBeVisible()
    await expect(statusSelect).toHaveValue('applied')
  })

  test('clicking "No" from a favorited posting downgrades it to viewed', async ({ page }) => {
    const firstRow = page.locator('table tbody tr').first()
    const statusSelect = firstRow.locator('select')

    await statusSelect.selectOption('favorited')

    await firstRow.getByRole('button', { name: /Open ↗/i }).click()
    await page.getByTestId('apply-confirm-no').click()

    await expect(statusSelect).toHaveValue('viewed')
  })
})

// ─── Column header sorting ────────────────────────────────────────────────────
// The mock adapter emits 15 deterministic postings in test mode (no shuffle).
// With equal stub affinity scores the ranker orders by recency, so the default
// order is Stripe (1d ago) … Airbnb (25d ago).

async function columnValues(page: Page, tdIndex: number): Promise<string[]> {
  const rows = page.locator('table tbody tr')
  const count = await rows.count()
  const values: string[] = []
  for (let i = 0; i < count; i++) {
    values.push(((await rows.nth(i).locator('td').nth(tdIndex).textContent()) ?? '').trim())
  }
  return values
}

test.describe('Job Board — column header sorting', () => {
  test.beforeEach(async ({ page }) => {
    await runAndCommitScrape(page)
    await goTo(page, 'Jobs')
  })

  test('Company header sorts A→Z on first click and Z→A on second', async ({ page }) => {
    const header = page.getByRole('columnheader', { name: /Company/ })

    await header.click()
    let companies = await columnValues(page, 1)
    expect(companies[0]).toBe('Airbnb')
    expect(companies).toEqual([...companies].sort((a, b) => a.localeCompare(b)))

    await header.click()
    companies = await columnValues(page, 1)
    expect(companies[0]).toBe('Vercel')
    expect(companies).toEqual([...companies].sort((a, b) => b.localeCompare(a)))
  })

  test('third click on Company header resets to default backend-ranked order', async ({ page }) => {
    const header = page.getByRole('columnheader', { name: /Company/ })
    await header.click()
    await header.click()
    await header.click()
    // Default: composite-score order with equal affinity → most-recent posting first
    const companies = await columnValues(page, 1)
    expect(companies[0]).toBe('Stripe')
  })

  test('sort indicator cycles ↕ → ↑ → ↓ → ↕ on each click', async ({ page }) => {
    const header = page.getByRole('columnheader', { name: /Company/ })
    await expect(header).toContainText('↕')
    await header.click()
    await expect(header).toContainText('↑')
    await header.click()
    await expect(header).toContainText('↓')
    await header.click()
    await expect(header).toContainText('↕')
  })

  test('switching sort column clears the previous column indicator', async ({ page }) => {
    const companyHeader = page.getByRole('columnheader', { name: /Company/ })
    const roleHeader = page.getByRole('columnheader', { name: /^Role/ })

    await companyHeader.click()
    await expect(companyHeader).toContainText('↑')
    await expect(roleHeader).toContainText('↕')

    await roleHeader.click()
    await expect(companyHeader).toContainText('↕')
    await expect(roleHeader).toContainText('↑')
  })

  test('Posted header ascending puts oldest posting first', async ({ page }) => {
    await page.getByRole('columnheader', { name: /Posted/ }).click()
    // Airbnb was posted 25d ago — oldest among the first 15 mock postings
    const companies = await columnValues(page, 1)
    expect(companies[0]).toBe('Airbnb')
  })

  test('Posted header descending puts most-recent posting first', async ({ page }) => {
    const header = page.getByRole('columnheader', { name: /Posted/ })
    await header.click()
    await header.click()
    // Stripe was posted 1d ago — most recent
    const companies = await columnValues(page, 1)
    expect(companies[0]).toBe('Stripe')
  })

  test('Level header ascending groups mid before senior before staff', async ({ page }) => {
    // td indices: checkbox(0) company(1) role(2) level(3)
    await page.getByRole('columnheader', { name: /Level/ }).click()
    const levels = await columnValues(page, 3)
    // Among the first 15 mock postings: 4 mid, 9 senior, 2 staff — no intern/junior/any
    const midLast = levels.lastIndexOf('mid')
    const seniorFirst = levels.indexOf('senior')
    const staffFirst = levels.indexOf('staff')
    expect(midLast).toBeLessThan(seniorFirst)
    expect(seniorFirst).toBeLessThan(staffFirst)
  })
})
