import { expect, it } from 'vitest';
import { diagnose } from '../../application/diagnose';
import { analyzePath } from '../../aws/analyzer';
import { threeTier } from '../../aws/scenarios';
import { TerraformWorkspace } from '../../terraform/engine';
import { starterFiles } from '../../terraform/examples';
import { bgpScenario, dnsScenario, vpnScenario } from '../../simulator/scenarios/chapters';
import { faults } from './LinuxVisual';
import { breaks, edits } from './CloudVisuals';
import { analyzeDesign, ecmpRun, lagRun, redundancyDesigns } from './RedundancyVisuals';

// The chapter visuals make specific claims ("breaking X stops at layer Y"); keep them true.
it('Linux ladder demo: each fault stops at its layer', () => {
  const stop: Record<string, string | undefined> = { none: undefined, nic: 'Link', gw: 'ARP', dns: 'DNS', svc: 'TCP', tls: 'TLS' };
  for (const f of faults) {
    const n = dnsScenario(); f.apply?.(n);
    expect(diagnose(n.snapshot(), 'PC1', 'https://www.example.com/').find(c => c.ok === false)?.layer, f.id).toBe(stop[f.id]);
  }
});
it('AWS demo: every break blocks Internet → ALB:443', () => {
  const run = (m = threeTier()) => analyzePath(m, { kind: 'internet', ip: '198.51.100.77' }, { kind: 'lb', id: 'alb-web' }, 'tcp', 443);
  expect(run().reachable).toBe(true);
  for (const b of breaks) { const m = threeTier(); b.apply(m); expect(run(m).reachable, b.id).toBe(false); }
  const m = threeTier(); breaks.find(b => b.id === 'nacl')!.apply(m);
  expect(run(m).blocked?.direction).toBe('response');
});
it('Terraform demo: tag → update, cidr → replace, subnet → create', () => {
  const expected: Record<string, string> = { none: 'noop', tag: 'update', cidr: 'replace', subnet: 'create' };
  for (const e of edits) {
    const ws = new TerraformWorkspace({ files: starterFiles() }); ws.run('init'); ws.run('apply -auto-approve');
    const files = { ...ws.files }; e.apply(files); ws.files = files;
    const actions = ws.buildPlan('plan').changes.map(c => c.action);
    expect(actions, e.id).toContain(expected[e.id]);
  }
});
it('VPN demo: ESP hides the inner packet, GRE shows it', () => {
  for (const mode of ['ipsec', 'gre'] as const) {
    const n = vpnScenario('static');
    for (const id of ['CGW', 'VGW1']) n.update(id, d => { d.interfaces.find(i => i.kind === 'tunnel')!.tunnel!.mode = mode; });
    const r = n.ping('PC1', '10.0.1.10');
    expect(r.success).toBe(true);
    const wire = r.captures.find(c => c.linkId === 'link-2' && (c.protocol === 'ESP' || c.info.startsWith('GRE')))!;
    expect(wire.hosts.includes('10.0.1.10')).toBe(mode === 'gre');
  }
});
it('BGP demo: LOCAL_PREF and link failure move the best path to R3', () => {
  const best = (lp: boolean, up: boolean) => {
    const n = bgpScenario();
    if (lp) n.update('R1', d => { d.bgp!.neighbors.find(x => x.ip === '10.0.13.2')!.localPreference = 200; });
    n.setLinkState('link-2', up);
    return n.bgp()!.tables.get('R1')!.find(p => p.prefix === '172.16.2.0/24' && p.best)?.nextHop;
  };
  expect(best(false, true)).toBe('10.0.12.2');
  expect(best(true, true)).toBe('10.0.13.2');
  expect(best(false, false)).toBe('10.0.13.2');
});
it('ECMP demo: flows spread over R2 and R3; a remote failure loses some flows with static routes but none with OSPF', () => {
  const ok = ecmpRun('static', 'none');
  expect(new Set(ok.t.streams.map(ok.path))).toEqual(new Set(['R2', 'R3']));
  expect(ok.routes).toHaveLength(2);
  expect(new Set(ecmpRun('single', 'none').t.streams.map(s => ecmpRun('single', 'none').path(s)))).toEqual(new Set(['R2']));
  const remote = ecmpRun('static', 'R2-R4');
  expect(remote.t.streams.some(s => !s.ok) && remote.t.streams.some(s => s.ok)).toBe(true);
  expect(remote.t.streams.filter(s => !s.ok).every(s => remote.path(s) === 'R2')).toBe(true);
  expect(ecmpRun('ospf', 'R2-R4').t.success).toBe(true);
  expect(ecmpRun('static', 'R1-R2').routes.map(r => r.nextHop)).toEqual(['10.0.13.3']);
});
it('LAG demo: two members double the aggregate, not a single flow; a failed member halves it; static vs LACP never bundles', () => {
  const both = lagRun([true, true], 'passive', 'src-dst-mixed-ip-port');
  expect(both.status.capacity).toBe(2000);
  expect(new Set(both.t.streams.map(both.member))).toEqual(new Set(['g0/7', 'g0/8']));
  expect(both.t.total).toBe(2000);
  expect(Math.max(...both.t.streams.map(s => s.rate))).toBeLessThanOrEqual(1000);
  const one = lagRun([false, true], 'passive', 'src-dst-mixed-ip-port');
  expect(one.status).toMatchObject({ up: true, capacity: 1000 });
  expect(one.t.success).toBe(true);
  expect(lagRun([true, true], 'on', 'src-dst-mixed-ip-port').status.up).toBe(false);
  expect(lagRun([true, true], 'none', 'src-dst-mixed-ip-port').t.success).toBe(false);
  const mac = lagRun([true, true], 'passive', 'src-dst-mac');
  expect(new Set(mac.t.streams.filter(s => s.from === 'PC1').map(mac.member)).size).toBe(1);
});
it('Redundancy demo: SPOFs and capacity per design', () => {
  const by = Object.fromEntries(redundancyDesigns.map(d => [d.id, analyzeDesign(d.options)]));
  expect(by.single.spof).toEqual(expect.arrayContaining(['SW1–SW2（1本目）', 'R1–R2', 'R2–R4', 'R2']));
  expect(by.loop.storm).toBe(true);
  expect(by.stp.spof).not.toContain('SW1–SW2（1本目）');
  expect(by.stp.capacity).toBe(1000);
  expect(by.lag.capacity).toBe(2000);
  expect(by.static.spof).toContain('R2–R4');
  expect(by.ospf.spof.sort()).toEqual(['R1', 'R4', 'SW1', 'SW2', 'SW2–R1'].sort());
}, 20_000);
