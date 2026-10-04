import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { curriculum } from '../../src/lessons/curriculum';
import { sections } from '../../src/lessons/theory';

for (const chapter of curriculum) {
  test(`${chapter.id}: static diagrams render without clipping their text`, async ({ page }) => {
    test.setTimeout(60_000);
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    const source = readFileSync(new URL(`../../src/content/${chapter.dir}/theory.md`, import.meta.url), 'utf8');
    for (const [index, section] of sections(source).entries()) {
      const ids = [...section.body.matchAll(/```theory-diagram\n([^\n]+)\n```/g)].map(m => m[1]);
      if (!ids.length) continue;
      await page.goto(`#/learn/${chapter.id}?section=${index + 1}`);
      await expect(page.locator('.theory-diagram')).toHaveCount(ids.length);
      for (const width of [1440, 1024]) {
        await page.setViewportSize({ width, height: 1080 });
        for (const id of ids) {
          const diagram = page.locator(`[data-diagram="${id}"]`);
          await expect(diagram).toBeVisible();
          await expect(diagram.locator('figcaption')).not.toBeEmpty();
          const clipped = await diagram.locator('.td-card').evaluateAll(cards => cards.filter(card => card.scrollHeight > card.clientHeight + 2 || card.scrollWidth > card.clientWidth + 2).map(card => card.textContent));
          expect(clipped, `${id} at ${width}px`).toEqual([]);
          if (width === 1440 && ['tcp-ip-network', 'prefix-26-bits', 'dns-name-tree', 'vlan-tag-fields', 'tcp-handshake-messages', 'terraform-resource-dependencies'].includes(id)) {
            await diagram.screenshot({ path: `test-results/diagram-${id}.png` });
          }
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${chapter.id} section ${index + 1}`).toBe(true);
      }
    }
    expect(errors).toEqual([]);
  });
}

test('Ethernet fields, VLAN insertion and subnet boundaries remain explicit', async ({ page }) => {
  await page.goto('#/learn/tcp-ip?section=4');
  const frame = page.locator('[data-diagram="ethernet-frame"]');
  await expect(frame.locator('.td-fields > .td-card > strong')).toHaveText(['宛先MAC', '送信元MAC', 'タイプ', '中身', 'FCS']);
  await expect(frame).toContainText('02:00:00:02:00:01');
  await expect(frame).toContainText('02:00:00:01:00:01');
  await expect(frame).toContainText('0x0800');
  expect(await frame.locator('.td-field-scroll').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await frame.screenshot({ path: 'test-results/ethernet-frame-diagram.png' });
  const ethernet = curriculum.find(c => c.id === 'ethernet-vlan')!;
  const source = readFileSync(new URL(`../../src/content/${ethernet.dir}/theory.md`, import.meta.url), 'utf8');
  const index = sections(source).findIndex(s => s.body.includes('vlan-tag-fields'));
  await page.goto(`#/learn/ethernet-vlan?section=${index + 1}`);
  const tagged = page.locator('[data-diagram="vlan-tag-fields"] .td-packet-row').nth(1);
  await expect(tagged.locator('.td-fields > .td-card > strong')).toHaveText(['宛先MAC', '送信元MAC', '802.1Qタグ', 'EtherType', 'データ', 'FCS']);
  await expect(tagged).toContainText('VID（12ビット）');
  const subnet = curriculum.find(c => c.id === 'subnet')!;
  const subnetText = readFileSync(new URL(`../../src/content/${subnet.dir}/theory.md`, import.meta.url), 'utf8');
  await page.goto(`#/learn/subnet?section=${sections(subnetText).findIndex(s => s.body.includes('prefix-26-bits')) + 1}`);
  const bits = page.locator('[data-diagram="prefix-26-bits"] .td-bit-rows > div').first();
  await expect(bits.locator('.td-bit-network')).toHaveCount(26);
  await expect(bits.locator('.td-bit-host')).toHaveCount(6);
});
