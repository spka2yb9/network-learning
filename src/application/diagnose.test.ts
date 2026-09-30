import { expect, it } from 'vitest';
import { diagnose } from './diagnose';
import { labById } from '../labs';
import type { NetworkLab } from '../labs/types';

it.each([
  ['linux-ts-01', 'Link'], ['linux-ts-02', 'Subnet'], ['linux-ts-03', 'ARP'], ['linux-ts-04', 'ARP'], ['linux-ts-05', 'DNS'],
  ['linux-ts-06', 'Route'], ['linux-ts-07', 'TCP'], ['linux-ts-08', 'TLS'], ['linux-ts-09', 'Application'], ['linux-ts-10', 'TCP'],
])('%s fails first at %s', (id, layer) => {
  const lab = labById(id) as NetworkLab;
  const checks = diagnose(lab.build().snapshot(), 'PC1', 'https://www.example.com/');
  expect(checks.find(c => c.ok === false)?.layer).toBe(layer);
  const n = lab.build(); lab.solve(n);
  expect(diagnose(n.snapshot(), 'PC1', 'https://www.example.com/').every(c => c.ok)).toBe(true);
});
