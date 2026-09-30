import { expect, test, type Page } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

/** The popover sits next to the highlighted element (the centred welcome step has none). Waits out the step animation (400ms)
 *  first: clicking 次へ mid-animation leaves driver.js's active-element class on the previous element as well. */
const besideTarget = async (page: Page) => { await page.waitForTimeout(500); return page.evaluate(() => {
  const target = document.querySelector('.driver-active-element'); const p = document.querySelector('.driver-popover')!.getBoundingClientRect();
  if (!target || target.id === 'driver-dummy-element') return true;
  const r = target.getBoundingClientRect();
  return p.left < r.right + 40 && r.left - 40 < p.right && p.top < r.bottom + 40 && r.top - 40 < p.bottom;
}); };

test('playground tour: opens on the first visit only, walks every step, replays from the toolbar', async ({ page }) => {
  await page.goto('#/simulator');
  const popover = page.locator('.driver-popover');
  await expect(popover).toContainText('プレイグラウンドへようこそ');
  await expect(popover).toContainText('1 / 8');
  for (let i = 1; i < 8; i++) {
    await expect(popover).toContainText(`${i} / 8`);
    await expect.poll(() => besideTarget(page)).toBe(true);
    await popover.getByRole('button', { name: '次へ' }).click();
  }
  await expect(popover).toContainText('8 / 8');
  await expect.poll(() => besideTarget(page)).toBe(true);
  await popover.getByRole('button', { name: 'はじめる' }).click();
  await expect(popover).toHaveCount(0);

  await page.reload();
  await expect(page.locator('.workspace')).toBeVisible();
  await page.waitForTimeout(800);
  await expect(popover).toHaveCount(0);

  await page.getByRole('button', { name: '操作ガイド' }).click();
  await expect(popover).toContainText('プレイグラウンドへようこそ');
  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);
  await page.getByRole('button', { name: 'ping', exact: true }).click();  // the workspace is usable again

  // Lab pages have no design controls: that step is skipped.
  await page.goto('#/lab/routing-01');
  await page.getByRole('button', { name: '操作ガイド' }).click();
  await expect(popover).toContainText('1 / 7');
});

for (const [url, title, steps] of [['#/aws', 'VPC Designerへようこそ', 7], ['#/terraform', 'Terraform Labへようこそ', 9]] as const) {
  test(`${url} tour: opens on the first visit, walks every step, replays from the breadcrumb`, async ({ page }) => {
    await page.goto(url);
    const popover = page.locator('.driver-popover');
    await expect(popover).toContainText(title);
    for (let i = 1; i < steps; i++) {
      await expect(popover).toContainText(`${i} / ${steps}`);
      await expect.poll(() => besideTarget(page)).toBe(true);
      await popover.getByRole('button', { name: '次へ' }).click();
    }
    await expect.poll(() => besideTarget(page)).toBe(true);  // last step: the page scrolls back up to the 操作ガイド button
    await popover.getByRole('button', { name: 'はじめる' }).click();
    await expect(popover).toHaveCount(0);
    await page.reload();
    await page.waitForTimeout(800);
    await expect(popover).toHaveCount(0);
    await page.getByRole('button', { name: '操作ガイド' }).click();
    await expect(popover).toContainText(title);
  });
}
