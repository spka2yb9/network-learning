import { describe, expect, it } from 'vitest';
import { labs } from './index';
import { TerraformWorkspace } from '../terraform/engine';
import { decodeFrame } from '../simulator/capture/decode';
import { parseRule } from '../simulator/services/FirewallEngine';
import type { NetworkSimulator } from '../simulator/core/NetworkSimulator';
import type { AwsModel } from '../aws/model';
import type { DeviceState } from '../simulator/core/types';
import { ecmpScenario } from '../simulator/scenarios/chapters';

// Every lab must start unsolved and become solvable by at least one correct solution.
describe.each(labs.map(l => [l.id, l] as const))('lab %s', (_, lab) => {
  it('has content', () => {
    expect(lab.title.length).toBeGreaterThan(4);
    expect(lab.mission.length).toBeGreaterThan(8);
    expect(lab.hints.length).toBeGreaterThan(0);
    if (lab.diagnosis) expect(lab.diagnosis.answer).toBeLessThan(lab.diagnosis.options.length);
  });
  if (lab.workspace === 'network') {
    it('starts unsolved (unless it is observational) and the reference solution passes', () => {
      const n = lab.build();
      const before = lab.grade(n.snapshot());
      if (!lab.questions) expect(before.every(c => c.pass)).toBe(false);
      lab.solve(n);
      const after = lab.grade(n.snapshot());
      expect(after.filter(c => !c.pass).map(c => c.label)).toEqual([]);
    });
    it('round-trips through JSON (persistence) without changing the grade', () => {
      const n = lab.build(); lab.solve(n);
      const snap = JSON.parse(JSON.stringify(n.snapshot()));
      expect(lab.grade(snap).every(c => c.pass)).toBe(true);
    });
  }
  if (lab.workspace === 'aws') {
    it('starts unsolved and the reference solution passes', () => {
      const m = lab.build();
      expect(lab.grade(m).every(c => c.pass)).toBe(false);
      lab.solve(m);
      expect(lab.grade(m).filter(c => !c.pass).map(c => c.label)).toEqual([]);
    });
  }
  if (lab.workspace === 'terraform') {
    it('starts unsolved and the reference solution passes', () => {
      const ws = new TerraformWorkspace(lab.build());
      expect(lab.grade(ws).every(c => c.pass)).toBe(false);
      lab.solve(ws);
      expect(lab.grade(ws).filter(c => !c.pass).map(c => c.label)).toEqual([]);
    });
  }
  if (lab.workspace === 'capture') {
    it.each(lab.cases.map(c => [c.id, c] as const))('case %s has exactly-matchable evidence', (_, c) => {
      const { captures } = c.build();
      expect(captures.length).toBeGreaterThan(0);
      expect(captures.some(c.evidence)).toBe(true);
      expect(captures.every(x => !decodeFrame(x.bytes).error)).toBe(true);
    });
  }
});
it('lab ids are unique', () => expect(new Set(labs.map(l => l.id)).size).toBe(labs.length));

// Shortcuts that satisfy the probes but break the brief (allow-all, switching the firewall off, …) must not pass.
describe('graders reject shortcuts', () => {
  const failsAfter = (id: string, shortcut: (x: never) => void) => {
    const lab = labs.find(l => l.id === id) as any;
    const target = lab.workspace === 'terraform' ? new TerraformWorkspace(lab.build()) : lab.build();
    lab.solve(target); shortcut(target as never);
    return (lab.grade(lab.workspace === 'network' ? target.snapshot() : target) as { pass: boolean }[]).some(c => !c.pass);
  };
  it('network', () => {
    expect(failsAfter('fw-01', (n: NetworkSimulator) => n.update('FW', d => { d.firewall!.rules = ['deny icmp 10.0.2.0/24 10.0.1.0/24', 'deny tcp any host 10.0.2.80 eq 22', 'permit ip any any'].map((r, i) => parseRule((i + 1) * 10, r.split(' '))); }))).toBe(true);
    expect(failsAfter('fw-ts-01', (n: NetworkSimulator) => n.update('FW', d => { d.firewall!.stateful = false; d.firewall!.defaultAction = 'permit'; }))).toBe(true);
    expect(failsAfter('fw-ts-02', (n: NetworkSimulator) => n.update('FW', d => { d.firewall!.rules = []; d.firewall!.defaultAction = 'permit'; }))).toBe(true);
    expect(failsAfter('nat-02', (n: NetworkSimulator) => n.update('R1', d => { d.nat!.push({ id: 'ssh', type: 'port-forward', protocol: 'tcp', inside: '192.168.1.20', insidePort: 22, outside: '203.0.113.2', outsidePort: 22 }); }))).toBe(true);
    expect(failsAfter('linux-ts-10', (n: NetworkSimulator) => n.update('WEB', d => { d.firewall!.rules.push(parseRule(4, 'permit tcp any any'.split(' '))); }))).toBe(true);
    expect(failsAfter('capstone-5', (n: NetworkSimulator) => n.update('VGW2', d => { for (const x of d.bgp!.neighbors) delete x.prepend; }))).toBe(true);
  });
  it('link aggregation / ECMP / design', () => {
    const unbundle = (d: DeviceState) => { d.interfaces = d.interfaces.filter(i => i.kind !== 'port-channel').map(({ channelGroup: _, ...i }) => i); };
    // Leaving the parallel cables to STP restores pings, but not the design (no bundle, one cable idle).
    expect(failsAfter('lag-ts-01', (n: NetworkSimulator) => { n.update('SW1', unbundle); n.update('SW2', unbundle); })).toBe(true);
    expect(failsAfter('design-mastery', (n: NetworkSimulator) => { n.update('SW1', unbundle); n.update('SW2', unbundle); })).toBe(true);
    expect(failsAfter('capstone-1', (n: NetworkSimulator) => { n.update('SW1', unbundle); n.update('CORE', unbundle); })).toBe(true);
    // The broken cable must stay broken; the budget allows one faster link, not all of them.
    expect(failsAfter('ecmp-ts-01', (n: NetworkSimulator) => { for (const l of n.snapshot().links) n.setLinkState(l.id, true); })).toBe(true);
    expect(failsAfter('bottleneck-01', (n: NetworkSimulator) => { for (const l of n.snapshot().links) n.setLinkProperties(l.id, { bandwidth: 100_000, latency: 1 }); })).toBe(true);
    // Static ECMP cannot see a failure two hops away; switching STP off is not redundancy.
    expect(failsAfter('ecmp-mastery', (n: NetworkSimulator) => { const ref = ecmpScenario('static'); for (const id of ['R1', 'R2', 'R3', 'R4']) n.update(id, d => { delete d.ospf; d.routes = ref.device(id).routes; }); })).toBe(true);
    expect(failsAfter('redundancy-01', (n: NetworkSimulator) => n.update('SW1', d => { d.stp!.enabled = false; }))).toBe(true);
  });
  it('fw-ts-*: an allow-all TCP rule is not a fix (the rest of the policy must stay)', () => {
    const allowAll = (n: NetworkSimulator) => n.update('FW', d => { d.firewall!.rules.unshift(...['permit tcp any any', 'permit icmp 10.0.1.0/24 any'].map((r, i) => parseRule(i + 1, r.split(' ')))); });
    expect(failsAfter('fw-ts-01', allowAll)).toBe(true);
    expect(failsAfter('fw-ts-02', allowAll)).toBe(true);
  });
  it('topology-01: one flat subnet with the switches cabled together bypasses RTR', () => {
    expect(failsAfter('topology-01', (n: NetworkSimulator) => {
      n.removeLink('c1'); n.removeLink('c2'); n.connect({ id: 'flat', sourceDevice: 'SWA', sourceInterface: 'g0/8', targetDevice: 'SWB', targetInterface: 'g0/8', up: true, bandwidth: 1000, latency: 1 });
      n.configureInterface('PCA', 'eth0', '172.16.1.10/16', true); n.configureInterface('PCB', 'eth0', '172.16.2.10/16', true);
    })).toBe(true);
  });
  it('labs with design questions still start unsolved', () => {
    for (const id of ['bottleneck-01', 'ecmp-mastery', 'design-mastery', 'capstone-1']) {
      const lab = labs.find(l => l.id === id)!;
      if (lab.workspace === 'network') expect(lab.grade(lab.build().snapshot()).every(c => c.pass), id).toBe(false);
      expect(lab.questions?.every(q => !q.options || q.options.includes(q.answer)), id).toBe(true);
    }
  });
  it('aws / terraform', () => {
    expect(failsAfter('aws-01', (m: AwsModel) => { m.securityGroups.find(s => s.id === 'sg-web')!.ingress.push({ protocol: '-1', fromPort: 0, toPort: 65535, cidr: '0.0.0.0/0' }); })).toBe(true);
    expect(failsAfter('aws-ts-03', (m: AwsModel) => { m.networkAcls.find(a => a.id === 'acl-app')!.entries.push(...[false, true].map(egress => ({ ruleNumber: 50, egress, protocol: '-1' as const, fromPort: 0, toPort: 65535, cidr: '0.0.0.0/0', action: 'allow' as const }))); })).toBe(true);
    expect(failsAfter('aws-ts-05', (m: AwsModel) => { m.natGateways[0].subnetId = 'subnet-app-a'; m.instances.find(i => i.id === 'i-app-a')!.publicIp = '198.51.100.99'; m.routeTables.find(r => r.id === 'rtb-private')!.routes = [{ destination: '0.0.0.0/0', target: 'igw-main' }]; })).toBe(true);
    expect(failsAfter('tf-04', (w: TerraformWorkspace) => { w.files['main.tf'] = w.files['main.tf'].replace('module.network.vpc_id', 'aws_vpc.main.id') + '\n# module.network.vpc_id\n'; })).toBe(true);
  });
});
