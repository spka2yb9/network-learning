import { expect, test, type Page } from '@playwright/test';
import { routingSimulation } from '../../src/labs/simulations/routing';

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
test('switching pages or Theory sections starts at the top', async ({ page }) => {
  await page.goto('#/learn/routing');
  await expect(page.locator('.talk').first()).toBeVisible();
  // Scroll inside the retry: a scroll issued before the section switch has rendered is undone by the reset itself.
  const scrolledToBottom = () => expect.poll(() => page.evaluate(() => { scrollTo(0, document.body.scrollHeight); return scrollY; })).toBeGreaterThan(1000);
  await scrolledToBottom();
  await page.getByRole('button', { name: /次のセクションへ/ }).click();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await expect(page.locator('.theory-progress')).toContainText('SECTION 02');
  await expect(page.locator('.theory-toc li.read')).toHaveCount(1);
  await page.getByRole('tab', { name: /Simulation/ }).click();
  await expect(page.locator('.sim-steps')).toBeVisible();
  await page.getByRole('tab', { name: /Theory/ }).click();
  await expect(page.locator('.theory-progress')).toContainText('SECTION 02');
  await expect(page.locator('.talk').first()).toBeVisible();
  await scrolledToBottom();
  await page.getByRole('navigation', { name: 'カリキュラム' }).getByRole('link', { name: /DNSと名前解決/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('DNS');
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
});

test('narrow PC window: Theory hints, a Simulation step checked live, and the chapter completed', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 }); // the narrowest supported PC window
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  await page.goto('#/learn/routing');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('ルーティング');
  const term = page.locator('.theory-page .term').first();
  await term.hover();
  await expect(term.locator('.term-tip')).toBeVisible();
  expect(await overflow()).toBe(false);
  await page.screenshot({ path: 'test-results/lesson-1024.png', fullPage: true });
  await page.getByRole('tab', { name: /Simulation/ }).click();
  const first = routingSimulation.sim![0];
  await expect(page.locator('.sim-step.current')).toContainText(first.title);
  // Step 1 by GUI: the step is checked from the workspace state, not from what was typed.
  await selectDevice(page, 'R1');
  await page.getByRole('button', { name: '機器設定', exact: true }).click();
  await page.getByRole('textbox', { name: /R1 g0\/0 IPv4/ }).fill('192.168.1.1/24');
  await page.getByRole('button', { name: 'g0/0 IP設定を適用', exact: true }).click();
  await expect(page.locator('.sim-step.done')).toHaveCount(1);
  // The reference build does the configuration; the observation questions are still the learner's.
  await page.getByRole('button', { name: /完成形/ }).click();
  await page.getByRole('button', { name: '切り替える', exact: true }).click();
  for (const step of routingSimulation.sim!.filter(s => s.quiz)) {
    // The current step is already open; a click on its heading would close it.
    const head = page.locator('.sim-step-head', { hasText: step.title });
    if (await head.getAttribute('aria-expanded') !== 'true') await head.click();
    await page.locator('.sim-quiz .quiz-option', { hasText: step.quiz!.options[step.quiz!.answer] }).click();
  }
  await expect(page.locator('.sim-complete')).toBeVisible();
  await expect(page.locator('.page-heading .badge')).toContainText('完了');
  await page.reload();
  await expect(page.locator('.page-heading .badge')).toContainText('完了');
  expect(await overflow()).toBe(false);
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
  // The design controls may also report that saved designs can't be listed, so pick the storage notice by its text.
  await expect(page.getByRole('alert').filter({ hasText: '保存データを読み込めません' })).toBeVisible();
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

test('every chapter has a Theory and a Simulation that render without runtime errors', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  for (const chapter of ['tcp-ip', 'subnet', 'routing', 'ethernet-vlan', 'dns', 'nat-firewall', 'linux', 'capture', 'topology', 'aws', 'vpn-bgp', 'terraform']) {
    await page.goto(`#/learn/${chapter}?section=2`);
    await expect(page.locator('.theory-page .talk').first()).toBeVisible();
    await expect(page.locator('.theory-page .callout-summary')).toBeVisible();
    await page.goto(`#/learn/${chapter}?tab=simulation`);
    await expect(page.locator('.sim-step.current')).toBeVisible();
    await expect(page.locator('.workspace, .aws-workspace, .tf-workspace').first()).toBeVisible();
  }
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
test('terminal: fits its panel without overflowing (a scrollbar there would toggle with each refit)', async ({ page }) => {
  await page.goto('#/lab/routing-01');
  await page.getByRole('button', { name: /Terminal/ }).click();
  await page.waitForSelector('.xterm-rows');
  const panel = await page.locator('.workspace-bottom').evaluate(b => [b.scrollHeight - b.clientHeight, b.scrollWidth - b.clientWidth]);
  expect(panel).toEqual([0, 0]);
});
test('terminal: deleting full-width characters and wrapped input keeps the screen equal to the command that runs', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 }); // the 210-character command below wraps onto several rows
  await page.goto('#/lab/routing-01');
  await page.locator('.xterm-helper-textarea').focus();
  /** The text after the last prompt as drawn on screen (wrapped rows joined). */
  const typed = () => page.evaluate(() => { const rows = [...document.querySelectorAll('.xterm-rows > div')].map(d => (d.textContent ?? '').replace(/\s+$/, ''));
    let i = rows.length - 1; while (i > 0 && !rows[i].includes('user@PC1:~$')) i--; return rows.slice(i).join('').split('user@PC1:~$').at(-1)!.replace(/\u00a0/g, ' ').trim(); });
  await page.keyboard.insertText('あい'); await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace'); await page.keyboard.type('help');
  await expect.poll(typed).toBe('help');
  await page.keyboard.press('Control+C');
  const long = `ping -c 1 ${'1'.repeat(200)}`;
  await page.keyboard.type(long); for (let i = 0; i < 150; i++) await page.keyboard.press('Backspace');
  await expect.poll(typed).toBe(long.slice(0, -150));
});
test('invalid or very long input never blanks a page or widens it', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await page.goto('#/aws');
  await page.locator('.resource-list').getByRole('button', { name: /^public-a/ }).click();
  await page.getByRole('textbox', { name: 'サブネットCIDR', exact: true }).fill('10.0.1.0/33');
  await page.getByRole('textbox', { name: 'サブネットCIDR', exact: true }).press('Enter');
  await expect(page.locator('.aws-form')).toContainText('CIDRの形式が正しくありません');
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto('#/terraform');
  await page.getByRole('textbox', { name: 'terraform コマンド' }).fill('x'.repeat(300));
  await page.getByRole('textbox', { name: 'terraform コマンド' }).press('Enter');
  await expect(page.locator('.tf-output')).toContainText('xxxxxxxxxx');
  expect(await overflow()).toBeLessThanOrEqual(1);
  await page.goto('#/lab/design-mastery');
  expect(await overflow()).toBeLessThanOrEqual(1);
  await expect(page.getByText('この画面を表示できませんでした')).toHaveCount(0);
  expect(errors).toEqual([]);
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
  const templates = ['routing', 'vlan', 'l3switch', 'stp', 'ospf', 'dns', 'nat', 'firewall', 'bgp', 'vpn', 'campus', 'lag', 'ecmp', 'design'];
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
test('link aggregation and ECMP: CLI and canvas share one state, the Debugger explains each path', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('#/lab/lag-01');
  for (const [id, mode] of [['SW1', 'active'], ['SW2', 'passive']]) {
    await selectDevice(page, id);
    await page.locator('.xterm-helper-textarea').focus();
    for (const line of ['enable', 'configure terminal', 'interface range g0/7-8', `channel-group 1 mode ${mode}`, 'end']) { await page.keyboard.type(line); await page.keyboard.press('Enter'); }
  }
  await expect(page.locator('.react-flow__edge-text', { hasText: 'po1 = 2×1G' })).toBeVisible();
  await selectDevice(page, 'PC1');
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('iperf3 -c 192.168.10.13 -P 4'); await page.keyboard.press('Enter');
  await page.locator('.inspector-tabs button').filter({ hasText: 'Debugger' }).click();
  await page.getByRole('button', { name: 'Path', exact: true }).click();
  await expect(page.locator('.hop-table')).toContainText('LAG');
  await page.getByRole('button', { name: /到達度を確認/ }).click();
  await expect(page.locator('.assessment')).toContainText('すべての到達条件');
  expect(errors).toEqual([]);
});

test('inspector: a cable selected in one lab is not carried over, and port edits keep focus', async ({ page }) => {
  await page.goto('#/lab/routing-01');
  await page.locator('.workspace-canvas').scrollIntoViewIfNeeded();
  const edge = (await page.locator('.react-flow__edge[data-id="link-1"] .react-flow__edge-interaction').boundingBox())!;
  await page.mouse.click(edge.x + edge.width / 2, edge.y + edge.height / 2);
  await expect(page.getByRole('heading', { name: 'リンク', exact: true })).toBeVisible();
  await page.goto('#/lab/vlan-01');
  await expect(page.locator('.device-node[data-id], .react-flow__node[data-id="SW1"]').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'リンク', exact: true })).toHaveCount(0);
  await selectDevice(page, 'SW1');
  await page.getByRole('button', { name: '機器設定', exact: true }).click();
  const vlan = page.getByRole('spinbutton', { name: 'g0/1 access VLAN', exact: true });
  await vlan.click(); await vlan.press('ControlOrMeta+a'); await vlan.pressSequentially('20');
  await expect(vlan).toHaveValue('20');
  await expect(vlan).toBeFocused();
});

test('PC layout: a lab shows its brief beside a workspace that fits the window; navigation opens from the menu', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('#/lab/routing-01');
  const brief = (await page.locator('.lab-brief').boundingBox())!, workspace = (await page.locator('.workspace').boundingBox())!;
  expect(brief.x + brief.width).toBeLessThanOrEqual(workspace.x);
  const terminal = (await page.locator('.workspace-bottom').boundingBox())!;
  expect(terminal.y + terminal.height).toBeLessThanOrEqual(900);
  expect((await page.locator('.workspace-canvas .topology').boundingBox())!.height).toBeGreaterThan(250);
  await expect(page.getByRole('navigation', { name: 'メインナビゲーション' })).toBeHidden();
  await page.getByRole('button', { name: 'メニュー', exact: true }).click();
  await page.getByRole('navigation', { name: 'メインナビゲーション' }).getByRole('link', { name: 'ラボ一覧' }).click();
  await expect(page).toHaveURL(/#\/labs$/);
  await expect(page.getByRole('navigation', { name: 'メインナビゲーション' })).toBeVisible();  // reading pages keep the sidebar
});

test('resetting progress forgets read sections and lab work, after a confirmation', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('#/learn/tcp-ip');
  await page.getByRole('button', { name: /読んだ。次のセクションへ/ }).click();
  await expect(page.getByRole('tab', { name: /Theory/ })).toContainText('1読了');
  await page.goto('#/lab/routing-01');
  await route(page, 'R1', '192.168.2.0/24', '10.0.0.2');
  await route(page, 'R2', '192.168.1.0/24', '10.0.0.1');
  await selectDevice(page, 'PC1');
  await page.getByRole('button', { name: 'ping', exact: true }).click();
  await expect(page.locator('.workspace-status')).toContainText('Echo Reply received');
  await page.goto('#/roadmap');
  await page.getByRole('button', { name: '進捗をリセット' }).click();
  const dialog = page.getByRole('dialog', { name: '学習の進捗をリセットしますか？' });
  await dialog.getByRole('button', { name: 'キャンセル' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: '進捗をリセット' }).click();
  await Promise.all([page.waitForEvent('load'), dialog.getByRole('button', { name: 'リセットする' }).click()]);
  await page.goto('#/learn/tcp-ip');
  await expect(page.getByRole('tab', { name: /Theory/ })).toContainText('0読了');
  await page.goto('#/lab/routing-01');
  await selectDevice(page, 'PC1');
  await page.getByRole('button', { name: 'ping', exact: true }).click();
  await expect(page.locator('.workspace-status')).toContainText('通信失敗');
  expect(errors).toEqual([]);
});
