import { describe, expect, it } from 'vitest';
import { l3SwitchScenario, stpScenario, vlanScenario } from '../scenarios/chapters';
import { access, trunk } from '../scenarios/build';
import { formatVlanList, ingressVlan, parseVlanList } from '../l2/Vlan';

describe('Switch: MAC learning, flooding, forwarding', () => {
  it('learns source MACs, floods unknown destinations, then forwards to one port', () => {
    const n = vlanScenario();
    const first = n.ping('PC1', '192.168.10.13');
    expect(first.success).toBe(true);
    const lookups = first.events.filter(e => e.type === 'MAC_LOOKUP' && e.deviceId === 'SW1');
    expect(lookups[0].message).toContain('フラッディング'); // ARP broadcast
    expect(first.events.some(e => e.type === 'MAC_LEARNED' && e.deviceId === 'SW1' && e.message.includes('VLAN 10'))).toBe(true);
    const sw1 = n.device('SW1').macTable!;
    expect(sw1.find(e => e.mac === n.device('PC1').interfaces[0].mac)).toMatchObject({ vlan: 10, port: 'g0/1' });
    expect(sw1.find(e => e.mac === n.device('PC3').interfaces[0].mac)).toMatchObject({ vlan: 10, port: 'g0/3' });
    const second = n.ping('PC1', '192.168.10.13');
    expect(second.events.filter(e => e.type === 'ARP_REQUEST')).toHaveLength(0);
    expect(second.events.filter(e => e.type === 'MAC_LOOKUP').every(e => e.message.includes('だけに転送'))).toBe(true);
  });
  it('does not deliver frames to hosts whose NIC MAC does not match (flooded unicast is discarded)', () => {
    const n = vlanScenario();
    n.ping('PC1', '192.168.10.13');
    n.clearMacTable('SW2');
    const r = n.ping('PC1', '192.168.10.13');
    expect(r.success).toBe(true);
    expect(r.events.some(e => e.type === 'MAC_LOOKUP' && e.deviceId === 'SW2' && e.message.includes('未学習'))).toBe(true);
  });
  it('captures each wire hop; trunk frames carry 802.1Q tags, access frames do not', () => {
    const r = vlanScenario().ping('PC1', '192.168.10.13');
    const request = r.captures.filter(c => c.protocol === 'ICMP' && c.info.includes('request'));
    expect(request.map(c => c.vlan)).toEqual([undefined, 10, undefined]);
    expect(request[1].bytes.slice(12, 14)).toEqual([0x81, 0x00]);
  });
});

describe('VLAN', () => {
  it('isolates broadcast domains even when hosts share an IP subnet', () => {
    const n = vlanScenario();
    expect(n.broadcastDomain('PC1', 'eth0').map(r => r.device).sort()).toEqual(['PC3', 'R1']);
    n.update('PC4', d => { d.interfaces[0].address = '192.168.10.14/24'; });
    const r = n.ping('PC1', '192.168.10.14');
    expect(r.success).toBe(false);
    expect(r.reason).toContain('ARP応答なし');
  });
  it('wrong access VLAN breaks same-VLAN communication', () => {
    const n = vlanScenario();
    n.update('SW2', d => access(d, 20, 'g0/1'));
    expect(n.ping('PC1', '192.168.10.13').success).toBe(false);
    n.update('SW2', d => access(d, 10, 'g0/1'));
    expect(n.ping('PC1', '192.168.10.13').success).toBe(true);
  });
  it('trunk allowed list controls which VLANs cross', () => {
    const n = vlanScenario();
    n.update('SW1', d => trunk(d, 'g0/3', [20]));
    const r = n.ping('PC1', '192.168.10.13');
    expect(r.success).toBe(false);
    expect(r.events.some(e => e.type === 'MAC_LOOKUP' && e.message.includes('トランクでVLAN 10 不許可'))).toBe(true);
    expect(n.ping('PC2', '192.168.20.14').success).toBe(true);
  });
  it('native VLAN mismatch leaks frames between VLANs', () => {
    const n = vlanScenario();
    n.update('SW1', d => trunk(d, 'g0/3', 'all', 10));
    n.update('SW2', d => trunk(d, 'g0/3', 'all', 20));
    expect(n.broadcastDomain('PC1', 'eth0').map(r => r.device)).toContain('PC4');
  });
  it('a missing VLAN in the database drops frames', () => {
    const n = vlanScenario();
    n.update('SW2', d => { d.vlans = d.vlans!.filter(v => v.id !== 10); });
    expect(n.ping('PC1', '192.168.10.13').success).toBe(false);
  });
  it('router-on-a-stick routes between VLANs and TTL drops by one', () => {
    const n = vlanScenario();
    const r = n.ping('PC1', '192.168.20.14');
    expect(r.success).toBe(true);
    expect(r.reply?.ttl).toBe(63);
    expect(r.captures.some(c => c.vlan === 20)).toBe(true);
    expect(vlanScenario(false).ping('PC1', '192.168.20.14').success).toBe(false);
  });
  it('L3 switch routes between SVIs', () => {
    const r = l3SwitchScenario().ping('PC1', '10.10.20.12');
    expect(r.success).toBe(true);
    expect(r.events.some(e => e.type === 'MAC_LOOKUP' && e.message.includes('SVI'))).toBe(true);
  });
  it('an SVI is line-down (no connected route) while no up, forwarding port carries its VLAN', () => {
    const n = l3SwitchScenario();
    n.setLinkState('link-1', false);
    expect(n.device('L3SW').lineDown).toContain('vlan10');
    expect(n.installed('L3SW').map(r => r.destination)).toEqual(['10.10.20.0/24']);
    expect(n.ping('PC2', '10.10.10.1').success).toBe(false);
    n.setLinkState('link-1', true);
    expect(n.ping('PC2', '10.10.10.11').success).toBe(true);
  });
  it('parses and formats VLAN lists', () => {
    expect(parseVlanList('10,20,30-32')).toEqual([10, 20, 30, 31, 32]);
    expect(formatVlanList([10, 11, 12, 20])).toBe('10-12,20');
    expect(() => parseVlanList('0-5')).toThrow();
    expect(ingressVlan({ mode: 'access', accessVlan: 10, allowedVlans: 'all', nativeVlan: 1 }, 10)).toHaveProperty('drop');
  });
});

describe('STP', () => {
  it('blocks exactly one port of a triangle and keeps connectivity', () => {
    const n = stpScenario();
    const stp = n.stpState();
    const blocked = [...stp.ports.entries()].filter(([, p]) => p.role === 'alternate');
    expect(blocked).toHaveLength(1);
    const roots = [...stp.bridges.values()].filter(b => b.isRoot);
    expect(roots).toHaveLength(1);
    const r = n.ping('PC1', '192.168.1.12');
    expect(r.success).toBe(true);
    expect(r.events.some(e => e.type === 'BROADCAST_STORM')).toBe(false);
  });
  it('lowest bridge priority becomes root', () => {
    const n = stpScenario();
    n.update('SW3', d => { d.stp = { enabled: true, priority: 4096 }; });
    expect(n.stpState().bridges.get('SW3')?.isRoot).toBe(true);
    // Root bridge ports are all designated
    expect([...n.stpState().ports.entries()].filter(([k]) => k.startsWith('SW3|')).every(([, p]) => p.role === 'designated')).toBe(true);
  });
  it('without STP a loop causes a broadcast storm', () => {
    const r = stpScenario(false).ping('PC1', '192.168.1.12');
    expect(r.events.some(e => e.type === 'BROADCAST_STORM')).toBe(true);
    expect(r.events.some(e => e.type === 'MAC_LEARNED' && e.message.includes('移動'))).toBe(true);
  });
  it('re-converges when a forwarding link fails', () => {
    const n = stpScenario();
    const link = n.snapshot().links.find(l => l.sourceDevice === 'SW1' && l.targetDevice === 'SW2')!;
    n.setLinkState(link.id, false);
    expect([...n.stpState().ports.values()].filter(p => p.role === 'alternate')).toHaveLength(0);
    expect(n.ping('PC1', '192.168.1.12').success).toBe(true);
  });
});
