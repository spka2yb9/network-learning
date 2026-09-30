import { expect, it } from 'vitest';
import { gradeRouting } from './routing';
import { routingScenario } from '../simulator/scenarios/routing';
it('grades final state without changing the source and accepts host routes', () => {
  const n = routingScenario();
  n.addRoute('R1', { destination: '192.168.2.10/32', nextHop: '10.0.0.2', preference: 1, metric: 0 });
  n.addRoute('R2', { destination: '192.168.1.10/32', nextHop: '10.0.0.1', preference: 1, metric: 0 });
  const before = n.snapshot();
  expect(gradeRouting(before).every(c => c.pass)).toBe(true);
  expect(n.snapshot()).toEqual(before);
});
it('does not award mastery for an incomplete or overbroad configuration', () => {
  expect(gradeRouting(routingScenario().snapshot()).every(c => c.pass)).toBe(false);
  const n = routingScenario(true);
  n.addRoute('R1', { destination: '0.0.0.0/0', nextHop: '10.0.0.2', preference: 1, metric: 0 });
  expect(gradeRouting(n.snapshot()).at(-1)?.pass).toBe(false);
});
it('checks all configured destinations, not just a few negative probes', () => {
  for (const destination of ['8.8.8.0/24', '192.168.0.0/16', '10.44.0.0/16']) {
    const n = routingScenario(true);
    n.addRoute('R1', { destination, nextHop: '10.0.0.2', preference: 1, metric: 0 });
    expect(gradeRouting(n.snapshot()).at(-1)?.pass).toBe(false);
  }
});
