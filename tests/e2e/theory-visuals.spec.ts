import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { curriculum } from '../../src/lessons/curriculum';
import { sections } from '../../src/lessons/theory';

for (const chapter of curriculum) {
  test(`${chapter.id}: diagrams are discoverable and every step renders`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`#/learn/${chapter.id}`);
    const index = page.getByRole('navigation', { name: 'この章の図解' });
    const text = readFileSync(new URL(`../../src/content/${chapter.dir}/theory.md`, import.meta.url), 'utf8');
    const ids = [...text.matchAll(/```theory-visual\n([^\n]+)\n/g)].map(m => m[1]);
    expect(ids.length).toBeGreaterThanOrEqual(4);
    await expect(index.getByRole('link')).toHaveCount(ids.length);
    const targets = await index.getByRole('link').evaluateAll(links => links.map(link => link.getAttribute('href')!));
    for (const [i, target] of targets.entries()) {
      await page.goto(target);
      const visual = page.locator(`[data-visual="${ids[i]}"]`);
      await expect(visual).toBeInViewport();
      const steps = visual.getByRole('group', { name: '図のステップ' }).getByRole('button');
      for (let i = 0; i < await steps.count(); i++) {
        await steps.nth(i).click();
        await expect(steps.nth(i)).toHaveAttribute('aria-pressed', 'true');
        await expect(visual.locator('.tv-explanation>strong')).toHaveText((await steps.nth(i).innerText()).replace(/^\d+\s*/, ''));
      }
      await expect(visual.getByRole('button', { name: '図の次のステップ' })).toBeDisabled();
      await visual.screenshot({ path: `test-results/visual-${ids[i]}.png` });
      await visual.getByRole('button', { name: '図を最初に戻す' }).click();
      await expect(steps.first()).toHaveAttribute('aria-pressed', 'true');
      await expect(visual.getByRole('button', { name: '図の前のステップ' })).toBeDisabled();
      await visual.getByText('図の説明をまとめて読む').click();
      await expect(visual.locator('.tv-transcript li')).toHaveCount(await steps.count());
    }
    expect(errors).toEqual([]);
  });
}

test('subnet boundaries, longest-prefix match, and first-match firewall decisions', async ({ page }) => {
  await page.goto('#/learn/subnet?section=3');
  let visual = page.locator('[data-visual="subnet-bits"]');
  await visual.getByRole('button', { name: /03\s*\/27/ }).click();
  await expect(visual.locator('.tv-facts')).toContainText('192.168.10.64/27');
  await expect(visual.locator('.tv-facts')).toContainText('.65 〜 .94（30台）');
  await expect(visual.locator('.tv-network-bit')).toHaveCount(27);
  await expect(visual.locator('.tv-host-bit')).toHaveCount(5);
  await page.goto('#/learn/routing?section=10');
  visual = page.locator('[data-visual="longest-prefix"]');
  await visual.getByRole('button', { name: /192\.168\.2\.200/ }).click();
  await expect(visual.locator('tr.is-selected')).toContainText('192.168.2.128/25');
  await page.goto('#/learn/nat-firewall?section=8');
  visual = page.locator('[data-visual="firewall"]');
  await visual.getByRole('button', { name: /拒否対象のWeb/ }).click();
  await expect(visual.locator('tr.is-selected')).toContainText('192.168.1.20から');
  await expect(visual.locator('tr.is-selected')).toContainText('DENY');
  await expect(visual.locator('tbody tr').nth(1)).toContainText('評価しない');
});

test('playback pauses, finishes, and resets after changing Theory sections', async ({ page }) => {
  await page.goto('#/learn/tcp-ip?section=11');
  const visual = page.locator('[data-visual="handshake"]');
  await visual.scrollIntoViewIfNeeded();
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await visual.getByRole('button', { name: '▶ 再生', exact: true }).click();
  await page.clock.fastForward(3300);
  await expect(visual.getByRole('button', { name: /応答する/ })).toHaveAttribute('aria-pressed', 'true');
  await visual.getByRole('button', { name: '一時停止', exact: true }).click();
  await page.clock.fastForward(4000);
  await expect(visual.getByRole('button', { name: /応答する/ })).toHaveAttribute('aria-pressed', 'true');
  await visual.getByRole('button', { name: '図の次のステップ' }).click();
  await visual.getByRole('button', { name: '▶ 再生', exact: true }).click();
  await expect(visual.getByRole('button', { name: /接続を頼む/ })).toHaveAttribute('aria-pressed', 'true');
  for (let i = 0; i < 3; i++) {
    await page.clock.fastForward(3300);
    await expect(visual.locator('.tv-controls>span')).toHaveText(`${Math.min(i + 2, 3)} / 3`);
  }
  await expect(visual.getByRole('button', { name: '▶ 再生', exact: true })).toBeVisible();
  await expect(visual.getByRole('button', { name: /確認する/ })).toHaveAttribute('aria-pressed', 'true');
  await page.goto('#/learn/tcp-ip?section=7');
  await expect(page.locator('[data-visual="encapsulation"]').getByRole('button', { name: /01\s*データ/ })).toHaveAttribute('aria-pressed', 'true');
});

test('all diagrams fit a narrow PC window; reduced motion suppresses packet animation', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const chapter of curriculum) {
    const text = readFileSync(new URL(`../../src/content/${chapter.dir}/theory.md`, import.meta.url), 'utf8');
    const targets = sections(text).flatMap((s, i) => s.body.includes('```theory-visual') ? [i + 1] : []);
    for (const section of targets) {
      await page.goto(`#/learn/${chapter.id}?section=${section}`);
      await expect(page.locator('.theory-visual').first()).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const visual of await page.locator('.theory-visual').all()) {
        await visual.getByRole('button', { name: '▶ 再生', exact: true }).click();
        await expect(visual.locator('animateMotion, animate')).toHaveCount(0);
        await visual.getByRole('button', { name: '一時停止', exact: true }).click();
        if (['dns', 'subnet', 'vpn-bgp', 'terraform'].includes(chapter.id)) await visual.screenshot({ path: `test-results/narrow-${await visual.getAttribute('data-visual')}.png` });
      }
    }
  }
});

test('MTU excess, failover, and Terraform replacement show the actual state change', async ({ page }) => {
  await page.goto('#/learn/vpn-bgp?section=8');
  let visual = page.locator('[data-visual="vpn-mtu"]');
  await visual.getByRole('button', { name: /80 B追加/ }).click();
  await expect(visual.locator('.tv-bar-heading')).toContainText('1580 B');
  await expect(visual.locator('.is-overflow')).toContainText('MTU超過：80 B');
  await visual.getByRole('button', { name: /内側を小さく/ }).click();
  await expect(visual.locator('.tv-bar-heading')).toContainText('1500 B');
  await expect(visual.locator('.is-overflow')).toHaveCount(0);
  await page.goto('#/learn/vpn-bgp?section=15');
  visual = page.locator('[data-visual="vpn-failover"]');
  await visual.getByRole('button', { name: /障害直後/ }).click();
  await expect(visual.locator('.tv-edge.is-active')).toHaveCount(0);
  await expect(visual.locator('.tv-node.is-blocked')).toContainText('トンネルA');
  await visual.getByRole('button', { name: /Bへ切り替え/ }).click();
  await expect(visual.locator('.tv-edge.is-active')).toHaveCount(2);
  await expect(visual.locator('.tv-explanation')).toContainText('トンネルB');
  await page.goto('#/learn/terraform?section=8');
  visual = page.locator('[data-visual="terraform-plan-symbols"]');
  await visual.getByRole('button', { name: /置換/ }).click();
  await expect(visual.locator('.tv-facts')).toContainText('1 to add, 0 to change, 1 to destroy');
  await expect(visual.locator('tr.is-selected')).toContainText('新しいID B');
});
