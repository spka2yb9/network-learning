import { expect, it } from 'vitest';
import { gradeAllocation, planVlsm, practice, prefixFor } from './vlsm';

const needs = [{ name: '営業', hosts: 61 }, { name: '開発', hosts: 29 }, { name: '経理', hosts: 13 }, { name: '管理', hosts: 7 }];
it('chooses the smallest prefix that fits', () => {
  expect(prefixFor(61)).toBe(26); expect(prefixFor(62)).toBe(26); expect(prefixFor(63)).toBe(25); expect(prefixFor(2)).toBe(30);
});
it('plans largest first with aligned blocks', () => {
  const r = planVlsm('192.168.10.0/24', needs);
  expect(r.allocations.map(a => a.network)).toEqual(['192.168.10.0/26', '192.168.10.64/27', '192.168.10.96/28', '192.168.10.112/28']);
  expect(r.free).toContain('192.168.10.128');
  expect(planVlsm('192.168.10.0/26', needs).error).toBeDefined();
});
it('grades any valid layout and rejects waste, overlap and misalignment', () => {
  const ok = gradeAllocation('192.168.10.0/24', needs, { 営業: '192.168.10.128/26', 開発: '192.168.10.0/27', 経理: '192.168.10.32/28', 管理: '192.168.10.48/28' });
  expect(ok.every(c => c.pass)).toBe(true);
  const waste = gradeAllocation('192.168.10.0/24', needs, { 営業: '192.168.10.0/25', 開発: '192.168.10.128/27', 経理: '192.168.10.160/28', 管理: '192.168.10.176/28' });
  expect(waste.find(c => c.label.includes('無駄'))?.pass).toBe(false);
  const overlap = gradeAllocation('192.168.10.0/24', needs, { 営業: '192.168.10.0/26', 開発: '192.168.10.32/27', 経理: '192.168.10.96/28', 管理: '192.168.10.112/28' });
  expect(overlap.find(c => c.label.includes('重ならない'))?.pass).toBe(false);
  const host = gradeAllocation('192.168.10.0/24', needs, { 営業: '192.168.10.5/26', 開発: '192.168.10.64/27', 経理: '192.168.10.96/28', 管理: '192.168.10.112/28' });
  expect(host.find(c => c.label.includes('ホスト部が0'))?.pass).toBe(false);
});
it('practice questions are deterministic and self-consistent', () => {
  expect(practice(7)).toEqual(practice(7));
  const q = practice(42);
  expect(q.question).toMatch(/\/\d+$/);
});
