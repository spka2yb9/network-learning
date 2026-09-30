import { expect, test, type Page } from '@playwright/test';

async function selectDevice(page: Page, id: string) {
  await page.getByRole('combobox', { name: '送信元デバイス', exact: true }).selectOption(id);
}
async function route(page: Page, id: string, destination: string, nextHop: string) {
  await selectDevice(page, id);
  await page.getByRole('button', { name: '機器設定', exact: true }).click();
  await page.getByRole('textbox', { name: 'Destination CIDR', exact: true }).fill(destination);
  await page.getByRole('textbox', { name: 'Next Hop', exact: true }).fill(nextHop);
  await page.getByRole('button', { name: '静的ルートを追加', exact: true }).click();
}
/** Double-click at human speed: Playwright's instantaneous dblclick lands inside one React re-render. */
async function toggleLink(page: Page, id: string) {
  const box = (await page.locator(`.react-flow__edge[data-id="${id}"] .react-flow__edge-interaction`).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(80);
  await page.mouse.down({ clickCount: 2 }); await page.mouse.up({ clickCount: 2 });
}
test('GUI vertical slice: fail, configure, recover, debug, capture, persist, break', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('#/lab/routing-01');
  await page.getByRole('button', { name: 'ping', exact: true }).click();
  await expect(page.locator('.workspace-status')).toContainText('通信失敗');
  await route(page, 'R1', '192.168.2.0/24', '10.0.0.2');
  await route(page, 'R2', '192.168.1.0/24', '10.0.0.1');
  await selectDevice(page, 'PC1');
  await page.getByRole('button', { name: 'ping', exact: true }).click();
  await expect(page.locator('.workspace-status')).toContainText('Echo Reply received');
  await page.getByRole('button', { name: '次のイベント', exact: true }).click();
  await expect(page.locator('.event-focus')).toContainText('ROUTE_LOOKUP');
  await page.getByRole('button', { name: /Packet Capture/ }).click();
  await page.getByRole('textbox', { name: 'パケットフィルタ' }).fill('icmp and host 192.168.2.10');
  // One request from the initial failure, plus six frames from the successful round trip.
  await expect(page.locator('.capture-table tbody tr')).toHaveCount(7);
  await page.getByRole('button', { name: /到達度を確認/ }).click();
  await expect(page.locator('.assessment')).toContainText('すべての到達条件');
  await expect(page.locator('.local-save')).toContainText('このブラウザに保存');
  await page.reload();
  await page.getByRole('button', { name: 'ping', exact: true }).click();
  await expect(page.locator('.workspace-status')).toContainText('Echo Reply received');
  await selectDevice(page, 'R1');
  await page.getByRole('button', { name: '機器設定', exact: true }).click();
  await page.getByRole('button', { name: '192.168.2.0/24 を削除', exact: true }).click();
  await selectDevice(page, 'PC1');
  await page.getByRole('button', { name: 'ping', exact: true }).click();
  await expect(page.locator('.workspace-status')).toContainText('通信失敗');
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/simulator-desktop.png', fullPage: true });
});
test('xterm commands configure actual state and survive session remount', async ({ page }) => {
  await page.goto('#/lab/routing-01');
  for (const [id, command] of [['R1', 'ip route 192.168.2.0/24 10.0.0.2'], ['R2', 'ip route 192.168.1.0/24 10.0.0.1']]) {
    await selectDevice(page, id);
    await page.locator('.xterm-helper-textarea').focus();
    for (const line of ['enable', 'configure terminal', command, 'end', 'show ip route']) {
      await page.keyboard.type(line); await page.keyboard.press('Enter');
    }
  }
  await selectDevice(page, 'PC1');
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('ping 192.168.2.10'); await page.keyboard.press('Enter');
  await expect(page.locator('.workspace-status')).toContainText('Echo Reply received');
  await page.keyboard.type('traceroute 192.168.2.10'); await page.keyboard.press('Enter');
  await page.getByRole('button', { name: /Event Log/ }).click();
  await expect(page.locator('.event-list')).toContainText('TTL exceeded');
  await page.getByRole('button', { name: /到達度を確認/ }).click();
  await expect(page.locator('.assessment')).toContainText('すべての到達条件');
});
test('home, hash deep links and static assets work under a repository subpath', async ({ page }) => {
  const badResponses: string[] = []; page.on('response', r => { if (r.status() >= 400) badResponses.push(r.url()); });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: /「つながる」を/ })).toBeVisible();
  await expect(page.locator('.device-node')).toHaveCount(4);
  await page.screenshot({ path: 'test-results/home-desktop.png', fullPage: true });
  await page.getByRole('link', { name: /学習をはじめる/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('TCP / IP');
  await page.reload();
  await expect(page.locator('.markdown')).toContainText('カプセル化');
  expect(badResponses).toEqual([]);
});
test('switching pages or lesson steps starts at the top', async ({ page }) => {
  await page.goto('#/learn/routing');
  await expect(page.locator('.talk').first()).toBeVisible();
  // Scroll inside the retry: a scroll issued before the step switch has rendered is undone by the reset itself.
  const scrolledToBottom = () => expect.poll(() => page.evaluate(() => { scrollTo(0, document.body.scrollHeight); return scrollY; })).toBeGreaterThan(1000);
  await scrolledToBottom();
  await page.getByRole('button', { name: '次のステップ' }).click();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await page.getByRole('tab', { name: /Theory/ }).click();
  await expect(page.locator('.talk').first()).toBeVisible();
  await scrolledToBottom();
  await page.getByRole('navigation', { name: 'カリキュラム' }).getByRole('link', { name: /DNSと名前解決/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('DNS');
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
});

test('mobile reading, subnet calculation, quiz and mastery persistence', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('#/learn/subnet');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('IPアドレス');
  await page.getByRole('tab', { name: /Visual/ }).click();
  await page.getByRole('textbox', { name: '計算するCIDR' }).fill('192.168.10.70/27');
  await expect(page.locator('.subnet-results')).toContainText('192.168.10.64/27');
  await page.getByRole('textbox', { name: '計算するCIDR' }).fill('192.168.10.70/99');
  await expect(page.locator('.error-text')).toBeVisible();
  await page.getByRole('tab', { name: /Quiz/ }).click();
  await page.getByRole('radio', { name: /192.168.10.94/ }).check();
  await page.getByRole('button', { name: '回答を確認', exact: true }).click();
  await expect(page.locator('.quiz-feedback')).toContainText('正解です');
  await page.getByRole('tab', { name: /Mastery Check/ }).click();
  const inputs = page.locator('.mastery-form input');
  await inputs.nth(0).fill('192.168.20.64'); await inputs.nth(1).fill('192.168.20.126'); await inputs.nth(2).fill('62');
  await page.getByRole('button', { name: /実技回答を確認/ }).click();
  await expect(page.locator('.success-text')).toBeVisible();
  // Second half: an address plan graded on its final state (any valid layout passes).
  for (const [name, value] of [['営業部', '172.20.8.0/24'], ['開発部', '172.20.9.0/25'], ['総務部', '172.20.9.128/26'], ['会議室Wi-Fi', '172.20.9.192/27'], ['管理用', '172.20.9.224/28']]) {
    await page.getByRole('textbox', { name: `${name} のCIDR` }).fill(value);
  }
  await page.getByRole('button', { name: /判定する/ }).click();
  await expect(page.locator('.assessment .not-passed')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.page-heading .badge')).toContainText('実技完了');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path: 'test-results/lesson-mobile.png', fullPage: true });
});
test('topology: new lab, node addition, IP validation and JSON export', async ({ page }) => {
  await page.goto('#/simulator');
  await page.getByRole('button', { name: '新規作成', exact: true }).click();
  await page.getByRole('button', { name: '作成する', exact: true }).click();
  await expect(page.locator('.device-node')).toHaveCount(0);
  await page.getByTitle('PCを追加（ドラッグも可能）').click();
  await expect(page.locator('.device-node')).toHaveCount(1);
  await page.getByRole('textbox', { name: /eth0 IPv4/ }).fill('999.1.1.1/24');
  await page.getByRole('button', { name: 'eth0 IP設定を適用', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('不正');
  await page.getByRole('textbox', { name: /eth0 IPv4/ }).fill('192.168.5.10/24');
  await page.getByRole('button', { name: 'eth0 IP設定を適用', exact: true }).click();
  await expect(page.locator('.device-node')).toContainText('192.168.5.10/24');
  const download = page.waitForEvent('download');
  await page.getByTitle('ラボを書き出す').click();
  expect((await download).suggestedFilename()).toBe('path-routing-lab.json');
});

test('cables, device movement, link failure and recovery share the simulator state', async ({ page }) => {
  await page.goto('#/simulator');
  await page.getByRole('button', { name: '完成例を開く', exact: true }).click();
  await page.getByRole('button', { name: '切り替える', exact: true }).click();
  const router = page.locator('.react-flow__node[data-id="R1"]');
  await page.locator('.workspace-canvas').scrollIntoViewIfNeeded();
  const box = await router.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 25);
  await page.mouse.down(); await page.mouse.move(box!.x + box!.width / 2, box!.y - 40, { steps: 8 }); await page.mouse.up();
  await selectDevice(page, 'PC1');
  await page.getByRole('button', { name: 'ping', exact: true }).click();
  await expect(page.locator('.workspace-status')).toContainText('Echo Reply received');
  await toggleLink(page, 'link-2');
  await page.getByRole('button', { name: 'ping', exact: true }).click();
  await expect(page.locator('.workspace-status')).toContainText('通信失敗');
  await page.locator('.workspace-canvas').scrollIntoViewIfNeeded();
  await toggleLink(page, 'link-2');
  await page.getByRole('button', { name: 'ping', exact: true }).click();
  await expect(page.locator('.workspace-status')).toContainText('Echo Reply received');
  await selectDevice(page, 'R1');
  await page.getByRole('button', { name: '機器設定', exact: true }).click();
  await page.getByRole('button', { name: 'この機器を削除' }).click();
  await expect(page.locator('.device-node')).toHaveCount(3);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
});

test('JSON import validates before replacing configuration; unavailable IndexedDB stays usable', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'indexedDB', { get() { throw new Error('Storage disabled for test'); } }); });
  await page.goto('#/simulator');
  await expect(page.getByRole('alert')).toContainText('保存データを読み込めません');
  await page.locator('input[type=file]').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"version":99}') });
  await expect(page.locator('.workspace > .error-text')).toContainText('未対応');
  await expect(page.locator('.device-node')).toHaveCount(4);
  await page.getByRole('button', { name: '完成例を開く', exact: true }).click();
  await page.getByRole('button', { name: '切り替える', exact: true }).click();
  await page.getByRole('button', { name: 'ping', exact: true }).click();
  await expect(page.locator('.workspace-status')).toContainText('Echo Reply received');
});

test('GUI cables bind the selected source and target interfaces', async ({ page }) => {
  await page.goto('#/simulator');
  await page.getByRole('button', { name: '完成例を開く', exact: true }).click();
  await page.getByRole('button', { name: '切り替える', exact: true }).click();
  await selectDevice(page, 'R1');
  await page.getByRole('button', { name: 'R1 g0/1 のケーブルを外す', exact: true }).click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  await page.locator('.workspace-canvas').scrollIntoViewIfNeeded();
  const source = await page.locator('.react-flow__node[data-id="R1"] .react-flow__handle[data-handleid="g0/1"]').boundingBox();
  const target = await page.locator('.react-flow__node[data-id="R2"] .react-flow__handle[data-handleid="g0/0"]').boundingBox();
  await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
  await page.mouse.down();
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('.react-flow__edge')).toHaveCount(3);
  await selectDevice(page, 'PC1');
  await page.getByRole('button', { name: 'ping', exact: true }).click();
  await expect(page.locator('.workspace-status')).toContainText('Echo Reply received');
});

test('every chapter visual renders from the simulator without runtime errors', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  for (const chapter of ['tcp-ip', 'subnet', 'routing', 'ethernet-vlan', 'dns', 'nat-firewall', 'linux', 'capture', 'topology', 'aws', 'vpn-bgp', 'terraform']) {
    await page.goto(`#/learn/${chapter}?stage=1`);
    await expect(page.locator('.visual-card, .journey, .subnet-tool').first()).toBeVisible();
  }
  await page.goto('#/learn/dns?stage=1');
  await page.getByRole('button', { name: '問い合わせ', exact: true }).click();
  await expect(page.locator('.dns-steps')).toContainText('ルートサーバー');
  await page.getByRole('button', { name: '問い合わせ', exact: true }).click();
  await expect(page.locator('.dns-steps')).toContainText('キャッシュ');
  await page.goto('#/learn/vpn-bgp?stage=1');
  await expect(page.locator('.visual-card .nested').first()).toContainText('Encapsulating Security Payload');
  await page.getByRole('button', { name: 'GRE', exact: true }).click();
  await expect(page.locator('.visual-card .nested').first()).toContainText('Protocol: GRE (47)');
  expect(errors).toEqual([]);
});
test('AWS, Terraform and Packet Analyzer workspaces run in the browser', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('#/aws');
  await expect(page.locator('.aws-diagram')).toBeVisible();
  await page.getByRole('button', { name: /分析/ }).click();
  await expect(page.locator('.hop-list li').first()).toBeVisible();
  await page.goto('#/terraform');
  for (const c of ['init', 'plan']) await page.getByRole('button', { name: `terraform ${c}`, exact: true }).click();
  await expect(page.locator('.tf-output')).toContainText('Plan:');
  await page.goto('#/labs');
  await expect(page.locator('.lab-card').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: /総合課題/ })).toBeVisible();
  await page.goto('#/analyzer');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(errors).toEqual([]);
});
test('terminal: Ctrl+C copies a selection, Ctrl+V pastes, Ctrl+C without selection interrupts', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('#/lab/routing-01');
  await page.getByRole('button', { name: /Terminal/ }).click();
  const rows = page.locator('.xterm-rows');
  const box = (await rows.locator('div').first().boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + box.height / 2, { steps: 5 }); await page.mouse.up();
  await page.keyboard.press('Control+C');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('PATH Virtual Terminal');
  await expect(rows).not.toContainText('^C');
  await page.evaluate(() => navigator.clipboard.writeText('show ip route'));
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.press('Control+V');
  await expect(rows).toContainText('show ip route');
  await page.keyboard.press('Control+C');
  await expect(rows).toContainText('^C');
});
/** Text inside diagram nodes must be the topmost element at its centre, and devices must not overlap. */
async function diagramProblems(page: Page) {
  return page.evaluate(() => {
    const problems: string[] = [];
    const extent = (el: Element) => { const r = el.getBoundingClientRect(); let [l, t, rr, b] = [r.left, r.top, r.right, r.bottom]; el.querySelectorAll('*').forEach(c => { const x = c.getBoundingClientRect(); if (x.width || x.height) { l = Math.min(l, x.left); t = Math.min(t, x.top); rr = Math.max(rr, x.right); b = Math.max(b, x.bottom); } }); return { l, t, r: rr, b }; };
    const devices = [...document.querySelectorAll('.react-flow__node')].filter(n => n.querySelector('.device-node')).map(n => ({ id: (n as HTMLElement).dataset.id, ...extent(n) }));
    devices.forEach((a, i) => devices.slice(i + 1).forEach(c => { if (a.l < c.r && c.l < a.r && a.t < c.b && c.t < a.b) problems.push(`${a.id} overlaps ${c.id}`); }));
    for (const el of document.querySelectorAll('.react-flow__node strong, .react-flow__node small, .react-flow__node .node-addresses span')) {
      const r = el.getBoundingClientRect(); if (!r.width || !r.height || r.bottom > innerHeight || r.top < 0) continue;
      const hit = document.elementFromPoint(r.left + Math.min(r.width / 2, 10), r.top + r.height / 2);
      if (hit && !(el === hit || el.contains(hit) || hit.contains(el))) problems.push(`"${el.textContent?.slice(0, 20)}" is covered`);
    }
    // Inside each device, port labels must not overlap each other or the device's own text / icon.
    for (const node of document.querySelectorAll('.react-flow__node .device-node')) {
      const parts = [...node.querySelectorAll('.port-label, .device-symbol, :scope > strong, .device-type, .node-addresses span')].map(el => ({ el, r: el.getBoundingClientRect() })).filter(p => p.r.width && p.r.height);
      parts.forEach((a, i) => parts.slice(i + 1).forEach(c => {
        if (a.r.left < c.r.right - 1 && c.r.left < a.r.right - 1 && a.r.top < c.r.bottom - 1 && c.r.top < a.r.bottom - 1) problems.push(`"${a.el.textContent}" overlaps "${c.el.textContent}"`);
      }));
    }
    return problems;
  });
}
test('diagrams: devices never overlap and no text is covered by nodes or lines', async ({ page }) => {
  test.slow(); // 14 diagrams in one test: ~25s alone, more with parallel workers
  const templates = ['routing', 'vlan', 'l3switch', 'stp', 'ospf', 'dns', 'nat', 'firewall', 'bgp', 'vpn', 'campus'];
  for (const url of [...templates.map(t => `#/simulator?template=${t}`), '#/lab/dns-01', '#/lab/nat-01']) {
    await page.goto('about:blank'); await page.goto(url);
    await expect(page.locator('.device-node').first()).toBeVisible();
    await page.locator('.workspace-canvas').scrollIntoViewIfNeeded();
    await expect.poll(() => diagramProblems(page), { timeout: 5000 }).toEqual([]);
  }
  await page.goto('#/aws/capstone-4');
  await expect(page.locator('.aws-res').first()).toBeVisible();
  await page.locator('.aws-diagram').scrollIntoViewIfNeeded();
  await expect.poll(() => diagramProblems(page), { timeout: 5000 }).toEqual([]);
});
test('Delete removes only what was clicked on the canvas, and only while the canvas has focus', async ({ page }) => {
  await page.goto('#/lab/routing-01');
  const devices = page.locator('.device-node'); const cables = page.locator('.react-flow__edge');
  await expect(devices).toHaveCount(4);
  await page.getByRole('button', { name: /Event Log/ }).click();
  for (const key of ['Backspace', 'Delete']) await page.keyboard.press(key);
  // The reset dialog takes focus, ignores the delete keys and closes with Escape, returning focus to its button.
  const reset = page.getByTitle('最初の構成に戻す', { exact: true });
  await reset.click();
  await expect(page.getByRole('dialog', { name: '最初の構成に戻しますか？' })).toBeVisible();
  expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true);
  for (const key of ['Backspace', 'Delete', 'Escape']) await page.keyboard.press(key);
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(reset).toBeFocused();
  await expect(devices).toHaveCount(4); await expect(cables).toHaveCount(3);
  // A clicked cable goes alone (not the SEND source device); a clicked device goes with its cables.
  await page.locator('.workspace-canvas').scrollIntoViewIfNeeded();
  const box = (await page.locator('.react-flow__edge[data-id="link-2"] .react-flow__edge-interaction').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.press('Delete');
  await expect(cables).toHaveCount(2); await expect(devices).toHaveCount(4);
  await page.locator('.react-flow__node[data-id="PC2"]').click();
  await page.keyboard.press('Delete');
  await expect(devices).toHaveCount(3); await expect(cables).toHaveCount(1);
});
test('Packet Analyzer: each lab and case starts fresh', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const filter = page.getByRole('textbox', { name: 'パケットフィルタ' }); const evidence = page.getByRole('textbox', { name: '根拠のパケット番号' });
  await page.goto('#/analyzer/capstone-3');
  await page.getByRole('button', { name: /ケースE/ }).click();
  await filter.fill('icmp'); await evidence.fill('2');
  await page.getByRole('button', { name: /ケースA/ }).click();
  await expect(filter).toHaveValue(''); await expect(evidence).toHaveValue('');
  await page.getByRole('button', { name: /ケースE/ }).click();
  await evidence.fill('2');
  await page.goto('#/analyzer/capture-01');
  await expect(page.locator('.case-tabs button').first()).toHaveClass(/active/);
  await expect(page.locator('.case-question')).toContainText('SYN');
  await expect(evidence).toHaveValue('');
  expect(errors).toEqual([]);
});
test('switching labs quickly keeps each lab\'s own topology', async ({ page }) => {
  const ids = () => page.locator('.react-flow__node').evaluateAll(nodes => nodes.map(n => (n as HTMLElement).dataset.id).sort());
  await page.goto('#/lab/vlan-01');
  await expect(page.locator('.workspace-name')).toContainText('vlan-01');
  await expect(page.locator('.device-node').first()).toBeVisible();
  const vlan = await ids();
  await page.goto('#/lab/routing-01');
  await expect(page.locator('.workspace-name')).toContainText('routing-01');
  await page.evaluate(() => { location.hash = '#/lab/vlan-01'; setTimeout(() => { location.hash = '#/lab/ospf-01'; }, 10); });
  await expect(page.locator('.workspace-name')).toContainText('ospf-01');
  await page.goto('#/lab/vlan-01');
  await expect(page.locator('.workspace-name')).toContainText('vlan-01');
  await expect.poll(ids).toEqual(vlan);
  await page.reload();
  await expect.poll(ids).toEqual(vlan);
});
