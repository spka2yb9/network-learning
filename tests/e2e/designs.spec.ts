import { expect, test, type Page } from '@playwright/test';

async function create(page: Page, name: string) {
  await page.getByRole('button', { name: '新規作成', exact: true }).click();
  await page.getByRole('textbox', { name: '構成名', exact: true }).fill(name);
  await page.getByRole('button', { name: '作成する', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}
async function save(page: Page, name: string) {
  await page.getByRole('button', { name: '名前を付けて保存', exact: true }).click();
  await page.getByRole('textbox', { name: '構成名', exact: true }).fill('   ');
  await expect(page.getByRole('button', { name: '保存する', exact: true })).toBeDisabled();
  await page.getByRole('textbox', { name: '構成名', exact: true }).fill(name);
  await page.getByRole('button', { name: '保存する', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}
async function currentData(page: Page, kind: string) {
  return page.evaluate(async kind => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('path-network-learning'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
    try {
      return await new Promise<any>((resolve, reject) => {
        const req = database.transaction(kind === 'network' ? 'labs' : 'workspaces').objectStore(kind === 'network' ? 'labs' : 'workspaces').get(kind === 'network' ? 'current' : kind === 'aws' ? 'aws:aws-playground' : 'tf:tf-playground');
        req.onsuccess = () => resolve(kind === 'network' ? req.result?.snapshot : req.result?.data); req.onerror = () => reject(req.error);
      });
    } finally { database.close(); }
  }, kind);
}
/** Pick an item from a "menu" <select> that stays on its placeholder (テンプレート / 保存した構成).
 *  locator.selectOption() first sets .value and then dispatches input + change; against these
 *  React-controlled selects, React's change tracking can miss that change under load (the menu
 *  silently does nothing) or process it twice, so set the value and dispatch one change ourselves. */
async function choose(page: Page, name: string, choice: string | { label: string }) {
  await page.getByRole('combobox', { name, exact: true }).evaluate((node, choice) => {
    const select = node as HTMLSelectElement;
    const options = Array.from(select.options);
    const option = typeof choice === 'string' ? options.find(o => o.value === choice) : options.find(o => o.text === choice.label);
    if (!option) throw new Error(`選択肢が見つかりません: ${JSON.stringify(choice)}`);
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, option.value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, choice);
}

for (const kind of ['network', 'aws'] as const) {
  test(`${kind}: deleting saved designs preserves the draft and handles cancellation and failure`, async ({ page }) => {
    await page.goto(kind === 'network' ? '#/simulator' : '#/aws');
    await save(page, '残す構成');
    await save(page, '削除する構成');
    const before = await currentData(page, kind);
    const saved = page.getByRole('combobox', { name: '保存した構成', exact: true });
    const deletedId = await saved.locator('option').filter({ hasText: /^削除する構成$/ }).getAttribute('value');
    const manage = () => page.getByRole('button', { name: '保存した構成を管理', exact: true }).click();
    const remove = (name: string) => page.getByRole('button', { name: `「${name}」を削除`, exact: true }).click();
    await manage(); await remove('残す構成');
    await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
    await expect(page.getByRole('button', { name: '「残す構成」を削除', exact: true })).toBeVisible();
    await remove('削除する構成');
    await expect(page.getByRole('dialog')).toContainText('取り消せません');
    await page.getByRole('button', { name: '削除する', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('status')).toContainText('削除しました');
    await expect(page.getByRole('button', { name: '「削除する構成」を削除', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '閉じる', exact: true }).click();
    expect(await currentData(page, kind)).toEqual(before);
    await page.reload();
    await expect(page.locator('.design-heading')).toContainText('削除する構成');
    await expect(page.locator('.design-heading')).not.toContainText('保存した構成');
    await expect(saved.locator('option')).toHaveCount(2);
    expect(await currentData(page, kind)).toEqual(before);
    await save(page, '削除する構成');
    expect(await saved.locator('option').filter({ hasText: /^削除する構成$/ }).getAttribute('value')).not.toBe(deletedId);
    await page.evaluate(() => {
      const original = IDBObjectStore.prototype.delete;
      IDBObjectStore.prototype.delete = function (key) {
        if (this.name === 'designs') throw new DOMException('削除の保存エラー', 'UnknownError');
        return original.call(this, key);
      };
    });
    await manage(); await remove('残す構成');
    await page.getByRole('button', { name: '削除する', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('削除の保存エラー');
    await page.reload();
    await expect(saved.locator('option')).toHaveCount(3);
    await page.setViewportSize({ width: 390, height: 844 });
    await manage();
    for (const name of ['残す構成', '削除する構成']) {
      await remove(name);
      await page.getByRole('button', { name: '削除する', exact: true }).click();
      await expect(page.getByRole('dialog').getByRole('status')).toContainText(`「${name}」`);
    }
    await expect(page.getByRole('dialog')).toContainText('保存した構成はありません');
    await page.getByRole('button', { name: '閉じる', exact: true }).click();
    await expect(saved).toBeDisabled();
    expect(await currentData(page, kind)).toEqual(before);
  });

  test(`${kind}: blank creation, named snapshots, templates and reload`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(kind === 'network' ? '#/simulator' : '#/aws');
    const controls = page.getByRole('region', { name: '構成の管理' });
    await create(page, '検証ネットワーク');
    await expect(controls).toContainText('検証ネットワーク');
    await expect.poll(async () => {
      const data = await currentData(page, kind);
      return data && Object.values(data).filter(Array.isArray).every(items => items.length === 0);
    }).toBe(true);
    await page.reload();
    await expect(controls).toContainText('検証ネットワーク');
    if (kind === 'network') {
      await expect(page.locator('.device-node')).toHaveCount(0);
      await page.getByTitle('PCを追加（ドラッグも可能）', { exact: true }).click();
    } else {
      await expect(page.getByText('まだVPCがありません。', { exact: false })).toBeVisible();
      await expect(page.locator('.aws-diagram .react-flow__node')).toHaveCount(0);
      await page.locator('.aws-add').getByRole('button', { name: 'VPC', exact: true }).click();
    }
    await save(page, '保存した検証構成');
    await choose(page, 'テンプレート', kind === 'network' ? 'routing' : 'three-tier');
    await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
    await expect(controls).toContainText('保存した検証構成');
    await choose(page, 'テンプレート', kind === 'network' ? 'routing' : 'three-tier');
    await page.getByRole('button', { name: '切り替える', exact: true }).click();
    if (kind === 'network') {
      await expect(page.locator('.device-node')).toHaveCount(4);
      await page.getByTitle('PCを追加（ドラッグも可能）', { exact: true }).click();
      await expect(page.locator('.device-node')).toHaveCount(5);
    } else {
      await page.locator('.aws-add').getByRole('button', { name: 'VPC', exact: true }).click();
    }
    await expect(controls).toContainText('編集中');
    await save(page, 'テンプレートからの構成');
    await page.reload();
    await expect(controls).toContainText('テンプレートからの構成');
    await choose(page, '保存した構成', { label: '保存した検証構成' });
    await page.getByRole('button', { name: '切り替える', exact: true }).click();
    await expect(controls).toContainText('保存した検証構成');
    await expect.poll(async () => {
      const data = await currentData(page, kind); return kind === 'network' ? data?.devices.length : data?.vpcs.length;
    }).toBe(1);
    await choose(page, 'テンプレート', kind === 'network' ? 'routing' : 'three-tier');
    await page.getByRole('button', { name: '切り替える', exact: true }).click();
    await expect.poll(async () => {
      const data = await currentData(page, kind); return kind === 'network' ? data?.devices.length : data?.vpcs.length;
    }).toBe(kind === 'network' ? 4 : 1);
    await create(page, '');
    await expect(controls).toContainText('無題の構成');
    await page.goto(kind === 'network' ? '#/lab/routing-01' : '#/aws/aws-01');
    await expect(page.locator('.lab-brief')).toBeVisible();
    await expect(controls).toHaveCount(0);
    await page.goto(kind === 'network' ? '#/simulator' : '#/aws');
    await expect(controls).toContainText('無題の構成');
    await expect.poll(async () => {
      const data = await currentData(page, kind);
      return data && Object.values(data).filter(Array.isArray).every(items => items.length === 0);
    }).toBe(true);
    await page.screenshot({ path: `test-results/${kind}-new-design.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '新規作成', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '構成名' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
    expect(await controls.evaluate(el => el.getBoundingClientRect().right <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

// Opening any template and pressing 分析 with the default selection must not end in an error.
async function switchTemplate(page: Page, id: string) {
  await choose(page, 'テンプレート', id);
  await page.getByRole('button', { name: '切り替える', exact: true }).click();
}
async function expectDefaultAnalysisOk(page: Page, hasTarget: boolean) {
  const analyze = page.getByRole('button', { name: '分析', exact: true });
  if (!hasTarget) {
    await expect(analyze).toBeDisabled();
    await expect(page.locator('.aws-analyzer')).toContainText('追加すると分析できます');
    return;
  }
  await analyze.click();
  await expect(page.locator('.aws-analyzer .success-text')).toBeVisible();
}
test('aws: every template analyzes with the default selection, whatever was open before', async ({ page }) => {
  await page.goto('#/aws');
  await create(page, '空の構成');
  await expectDefaultAnalysisOk(page, false);
  for (const [id, hasTarget] of [['three-tier', true], ['web', true], ['base', false], ['three-tier', true]] as const) {
    await switchTemplate(page, id);
    await expectDefaultAnalysisOk(page, hasTarget);
  }
});
test('terraform: every template analyzes with the default selection after apply', async ({ page }) => {
  await page.goto('#/terraform');
  await page.getByRole('button', { name: '到達性', exact: true }).click();
  for (const [id, hasTarget] of [['starter', false], ['three-tier', true]] as const) {
    await switchTemplate(page, id);
    for (const c of ['init', 'apply']) await page.getByRole('button', { name: `terraform ${c}`, exact: true }).click();
    await page.getByRole('button', { name: 'yes: 実行する' }).click();
    await expectDefaultAnalysisOk(page, hasTarget);
  }
});

test('network: a ?template= link asks before replacing an edited draft', async ({ page }) => {
  await page.goto('#/simulator');
  const controls = page.getByRole('region', { name: '構成の管理' });
  await create(page, '編集中の構成');
  await page.getByTitle('PCを追加（ドラッグも可能）', { exact: true }).click();
  await page.goto('#/labs'); await page.goto('#/simulator?template=ospf');
  await expect(page.getByRole('dialog')).toContainText('OSPF');
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
  await expect(page.locator('.device-node')).toHaveCount(1);
  expect(page.url()).not.toContain('template=');
  await page.goto('#/simulator?template=ospf');
  await page.getByRole('button', { name: '切り替える', exact: true }).click();
  await expect(controls).toContainText('OSPF');
  // Nothing to lose: an unedited template is replaced directly.
  await page.goto('#/simulator?template=vlan');
  await expect(controls).toContainText('VLAN');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  // Following the same link again asks again.
  await page.getByTitle('PCを追加（ドラッグも可能）', { exact: true }).click();
  await page.goto('#/simulator?template=ospf');
  await expect(page.getByRole('dialog')).toContainText('OSPF');
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
  await page.goto('#/simulator?template=ospf');
  await expect(page.getByRole('dialog')).toContainText('OSPF');
});
test('network: saving under a name already in use updates that saved design', async ({ page }) => {
  await page.goto('#/simulator');
  await save(page, '同じ名前');
  await switchTemplate(page, 'routing');
  await save(page, '同じ名前');
  await expect(page.getByRole('combobox', { name: '保存した構成', exact: true }).locator('option').filter({ hasText: /^同じ名前$/ })).toHaveCount(1);
});

test('terraform: blank creation, templates, named snapshots and reload', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('#/terraform');
  const controls = page.getByRole('region', { name: '構成の管理' });
  const files = page.locator('.file-tab');
  const savedFiles = async () => Object.keys((await currentData(page, 'terraform'))?.files ?? {}).sort();
  await expect(controls).toContainText('3層構成');
  await create(page, '空のコード');
  await expect(files).toHaveCount(1);
  await expect.poll(async () => (await currentData(page, 'terraform'))?.files).toEqual({ 'main.tf': '' });
  await page.getByRole('textbox', { name: '新しいファイル名' }).fill('network.tf');
  await page.getByRole('button', { name: 'ファイルを追加' }).click();
  const tag = controls.locator('.tag-mini');
  await expect(tag).toHaveText('新規構成・編集中');
  await save(page, '保存したコード');
  await expect(tag).toHaveText('保存した構成');
  await choose(page, 'テンプレート', 'starter');
  await page.getByRole('button', { name: '切り替える', exact: true }).click();
  await expect(controls).toContainText('VPCだけの最小構成');
  await expect(tag).toHaveText('テンプレート');
  await expect(files).toHaveCount(3);
  await expect.poll(savedFiles).toEqual(['main.tf', 'outputs.tf', 'variables.tf']);
  await page.reload();
  await expect(controls).toContainText('VPCだけの最小構成');
  await expect(files).toHaveCount(3);
  await choose(page, '保存した構成', { label: '保存したコード' });
  await page.getByRole('button', { name: '切り替える', exact: true }).click();
  await expect(controls).toContainText('保存したコード');
  await expect.poll(savedFiles).toEqual(['main.tf', 'network.tf']);
  await page.goto('#/terraform/tf-01');
  await expect(page.locator('.lab-brief')).toBeVisible();
  await expect(controls).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('AWS official SVG icons render in the palette and diagram under a repository subpath', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const failedRequests: string[] = []; page.on('response', r => { if (r.status() >= 400) failedRequests.push(r.url()); });
  await page.goto('#/aws');
  await expect(page.locator('.aws-add .aws-official-icon')).toHaveCount(9);
  await expect(page.locator('.aws-group-label.tone-vpc .aws-official-icon')).toHaveCount(1);
  await expect(page.locator('.aws-group-label.tone-public .aws-official-icon')).toHaveCount(2);
  await expect(page.locator('.aws-res.tone-db .aws-official-icon')).toHaveCount(1);
  await expect.poll(() => page.locator('.aws-official-icon').evaluateAll(images => images.every(img => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await page.screenshot({ path: 'test-results/aws-official-icons.png', fullPage: true });
  expect(errors).toEqual([]); expect(failedRequests).toEqual([]);
});
