import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:4173/network-test/';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
await context.addInitScript(() => { localStorage.setItem('path:playground-tour', '1'); });
const page = await context.newPage();
await page.goto(BASE + '#/simulator');
await page.getByRole('region', { name: '構成の管理' }).waitFor();

// resolve normally
console.log('before dialog, combobox count =', await page.getByRole('combobox', { name: 'テンプレート', exact: true }).count());

// open the modal "new" dialog
await page.getByRole('button', { name: '新規作成', exact: true }).click();
await page.getByRole('dialog').waitFor();
console.log('with modal open, combobox count =', await page.getByRole('combobox', { name: 'テンプレート', exact: true }).count());
console.log('with modal open, controls region count =', await page.getByRole('region', { name: '構成の管理' }).count());
console.log('with modal open, design-controls DOM count =', await page.locator('.design-controls').count());
await browser.close();
