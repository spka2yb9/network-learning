import { describe, expect, it } from 'vitest';
import { dnsScenario, firewallScenario, natScenario } from '../scenarios/chapters';
import { routingScenario } from '../scenarios/routing';
import { authoritativeAnswer, normalizeName, reverseName, validateRecord } from '../services/Dns';
import { evaluateRules, parseRule } from '../services/FirewallEngine';
import type { IcmpPacket, Packet } from './types';

const peers = (events: { type: string; peer?: string }[]) => events.filter(e => e.type === 'DNS_QUERY').map(e => e.peer);

describe('DNS', () => {
  it('recursive resolver walks root → TLD → authoritative, then answers', () => {
    const r = dnsScenario().dnsLookup('PC1', 'www.example.com');
    expect(r.success).toBe(true);
    expect(r.message?.answer.map(a => a.value)).toEqual(['203.0.113.80']);
    expect(r.message?.ra).toBe(true);
    expect(peers(r.events)).toEqual(['192.168.1.53', '198.51.100.10', '198.51.100.20', '198.51.100.30']);
    expect(r.captures.some(c => c.protocol === 'DNS' && c.info.includes('Standard query response'))).toBe(true);
  });
  it('the second query is answered from cache with a lower TTL; expiry re-queries only the auth server', () => {
    const n = dnsScenario();
    n.dnsLookup('PC1', 'www.example.com');
    n.advanceTime(10_000);
    const second = n.dnsLookup('PC1', 'www.example.com');
    expect(peers(second.events)).toEqual(['192.168.1.53']);
    expect(second.events.some(e => e.type === 'DNS_CACHE')).toBe(true);
    expect(second.message?.answer[0].ttl).toBeLessThanOrEqual(290);
    n.advanceTime(300_000);
    const third = n.dnsLookup('PC1', 'www.example.com');
    expect(peers(third.events)).toEqual(['192.168.1.53', '198.51.100.30']);
  });
  it('follows CNAME, returns MX/TXT/AAAA, and caches NXDOMAIN negatively', () => {
    const n = dnsScenario();
    const cname = n.dnsLookup('PC1', 'shop.example.com');
    expect(cname.message?.answer.map(a => a.type)).toEqual(['CNAME', 'A']);
    expect(n.dnsLookup('PC1', 'example.com', 'MX').message?.answer[0].value).toBe('10 mail.example.com.');
    expect(n.dnsLookup('PC1', 'example.com', 'TXT').message?.answer[0].value).toContain('spf1');
    expect(n.dnsLookup('PC1', 'www.example.com', 'AAAA').message?.answer[0].value).toBe('2001:db8::80');
    const missing = n.dnsLookup('PC1', 'nope.example.com');
    expect(missing.message?.rcode).toBe('NXDOMAIN');
    const again = n.dnsLookup('PC1', 'nope.example.com');
    expect(again.message?.rcode).toBe('NXDOMAIN');
    expect(peers(again.events)).toEqual(['192.168.1.53']);
  });
  it('in-zone CNAME to a missing name: the CNAME is cached positively, NXDOMAIN under the target (RFC 2308 §2.1)', () => {
    const n = dnsScenario();
    n.update('AUTH', d => { d.dnsServer!.zones[0].records.push({ name: 'old.example.com.', type: 'CNAME', ttl: 300, value: 'gone.example.com.' }); });
    for (let i = 0; i < 2; i++) expect(n.dnsLookup('PC1', 'old.example.com').message).toMatchObject({ rcode: 'NXDOMAIN', answer: [{ type: 'CNAME', value: 'gone.example.com.' }] });
    expect(n.dnsLookup('PC1', 'old.example.com', 'CNAME').message).toMatchObject({ rcode: 'NOERROR', answer: [{ value: 'gone.example.com.' }] });
    expect(n.device('RESOLVER').dnsCache!.filter(e => e.negative).map(e => e.name)).toEqual(['gone.example.com.']);
  });
  it('a CNAME into a delegated child returns the CNAME plus a referral, not NXDOMAIN', () => {
    const records = [{ name: 'www.example.com.', type: 'CNAME' as const, ttl: 300, value: 'web.sub.example.com.' }, { name: 'sub.example.com.', type: 'NS' as const, ttl: 300, value: 'ns.sub.example.com.' },
      { name: 'ns.sub.example.com.', type: 'A' as const, ttl: 300, value: '198.51.100.40' }];
    expect(authoritativeAnswer([{ origin: 'example.com.', records }], { name: 'www.example.com.', type: 'A' })).toMatchObject({ rcode: 'NOERROR', answer: [records[0]], authority: [records[1]], additional: [records[2]] });
  });
  it('a server that answers with ICMP Port Unreachable is reported as connection refused', () => {
    const r = dnsScenario().dnsLookup('PC1', 'www.example.com', 'A', { server: '203.0.113.80' });
    expect(r.success).toBe(false);
    expect(r.reason).toContain('connection refused');
  });
  it('authoritative-only servers answer their zone and refuse recursion', () => {
    const n = dnsScenario();
    const direct = n.dnsLookup('PC1', 'www.example.com', 'A', { server: '198.51.100.30' });
    expect(direct.message?.aa).toBe(true);
    expect(n.dnsLookup('PC1', 'www.google.com', 'A', { server: '198.51.100.30' }).message?.rcode).toBe('REFUSED');
    const referral = n.dnsLookup('PC1', 'www.example.com', 'A', { server: '198.51.100.10', recurse: false });
    expect(referral.message?.authority[0]).toMatchObject({ type: 'NS', name: 'com.' });
  });
  it('dig +trace iterates from the root without using the resolver cache', () => {
    const r = dnsScenario().dnsLookup('PC1', 'www.example.com', 'A', { trace: true });
    expect(r.success).toBe(true);
    expect(r.steps.map(s => s.result)).toEqual(['referral', 'referral', 'answer']);
  });
  it('reverse lookup (PTR) and resolver configuration failures', () => {
    const n = dnsScenario();
    expect(n.dnsLookup('PC1', reverseName('192.168.1.10'), 'PTR').message?.answer[0].value).toBe('pc1.corp.example.');
    n.update('PC1', d => { d.dnsServers = ['192.168.1.99']; });
    const r = n.dnsLookup('PC1', 'www.example.com');
    expect(r.success).toBe(false);
    expect(r.reason).toContain('timed out');
  });
  it('validates records and names strictly', () => {
    expect(normalizeName('WWW.Example.COM')).toBe('www.example.com.');
    expect(() => normalizeName('bad..name')).toThrow();
    expect(() => validateRecord({ name: 'a.example.com', type: 'A', ttl: 60, value: '999.1.1.1' })).toThrow();
    expect(validateRecord({ name: 'a.example.com', type: 'MX', ttl: 60, value: '10 mail.example.com' }).value).toBe('10 mail.example.com.');
    expect(authoritativeAnswer([{ origin: 'example.com.', records: [] }], { name: 'x.example.com.', type: 'A' })?.rcode).toBe('NXDOMAIN');
  });
  it('TXT length is checked in UTF-8 bytes (what goes on the wire)', () => {
    expect(() => validateRecord({ name: 'example.com', type: 'TXT', ttl: 60, value: 'あ'.repeat(100) })).toThrow();
  });
});

describe('HTTP / TLS over simulated TCP', () => {
  it('curl resolves, handshakes, and fetches over HTTP and HTTPS', () => {
    const n = dnsScenario();
    const http = n.http('PC1', 'http://www.example.com/');
    expect(http.status).toBe(200);
    expect(http.stages.map(s => s.layer)).toEqual(['DNS', 'TCP', 'HTTP']);
    const syn = http.captures.filter(c => c.protocol === 'TCP' && c.info.includes('[SYN]'));
    expect(syn.length).toBeGreaterThan(0);
    const secure = n.http('PC1', 'https://www.example.com/');
    expect(secure.status).toBe(200);
    expect(secure.stages.map(s => s.layer)).toEqual(['DNS', 'TCP', 'TLS', 'HTTP']);
    expect(secure.captures.some(c => c.protocol === 'TLS' && c.info.includes('SNI=www.example.com'))).toBe(true);
    // HTTP payload is not visible on the wire for HTTPS.
    expect(secure.captures.some(c => c.protocol === 'HTTP')).toBe(false);
  });
  it('certificate problems fail at the TLS layer unless -k', () => {
    const n = dnsScenario();
    const byIp = n.http('PC1', 'https://203.0.113.80/');
    expect(byIp.stages.at(-1)).toMatchObject({ layer: 'TLS', ok: false });
    expect(byIp.reason).toContain('certificate');
    expect(n.http('PC1', 'https://203.0.113.80/', { insecure: true }).status).toBe(200);
    expect(n.http('PC1', 'https://WWW.Example.com/').status).toBe(200); // names compare case-insensitively
    n.update('WEB', d => { d.services![1].tls!.expired = true; });
    expect(n.http('PC1', 'https://www.example.com/').reason).toContain('有効期限');
  });
  it('distinguishes refused (RST), stopped service, localhost bind and HTTP errors', () => {
    const n = dnsScenario();
    expect(n.tcpConnect('PC1', '203.0.113.80', 8080).reason).toContain('refused');
    n.update('WEB', d => { d.services![0].running = false; });
    expect(n.http('PC1', 'http://www.example.com/').reason).toContain('refused');
    n.update('WEB', d => { d.services![0] = { ...d.services![0], running: true, bind: '127.0.0.1' }; });
    const bound = n.http('PC1', 'http://www.example.com/');
    expect(bound.events.some(e => e.type === 'SOCKET_LOOKUP' && e.message.includes('127.0.0.1'))).toBe(true);
    n.update('WEB', d => { d.services![0] = { ...d.services![0], bind: '0.0.0.0', http: { status: 503, body: 'maintenance' } }; });
    const busy = n.http('PC1', 'http://www.example.com/');
    expect(busy.status).toBe(503);
    expect(busy.success).toBe(false);
    expect(busy.stages.at(-1)).toMatchObject({ layer: 'HTTP', ok: false });
    const plain = n.http('PC1', 'http://www.example.com:443/'); // plain HTTP to the TLS port
    expect(plain).toMatchObject({ status: 400, success: false });
    expect(plain.body).toContain('plain HTTP request was sent to HTTPS port');
  });
  it('TCP handshake sequence numbers are consistent', () => {
    const r = dnsScenario().http('PC1', 'http://203.0.113.80/');
    const tcp = r.events.filter(e => e.type === 'PACKET_CREATED' && e.packet?.protocol === 'TCP').map(e => e.packet as Extract<Packet, { protocol: 'TCP' }>);
    const [syn, synack, ack] = tcp;
    expect(syn.flags).toEqual(['SYN']);
    expect(synack.flags).toEqual(['SYN', 'ACK']);
    expect(synack.ack).toBe((syn.seq + 1) >>> 0);
    expect(ack.seq).toBe((syn.seq + 1) >>> 0);
    expect(ack.ack).toBe((synack.seq + 1) >>> 0);
    expect(tcp.some(p => p.flags.includes('FIN'))).toBe(true);
  });
  it('timeouts retransmit SYN on the virtual clock', () => {
    const n = dnsScenario();
    n.update('R1', d => { d.routes = []; });
    const r = n.tcpConnect('PC1', '203.0.113.80', 80);
    expect(r.success).toBe(false);
    const n2 = firewallScenario();
    const t = n2.tcpConnect('PC1', '10.0.2.80', 443);
    expect(t.reason).toContain('timed out');
    expect(t.events.filter(e => e.type === 'TCP_RETRANSMIT')).toHaveLength(2);
    expect(t.elapsed).toBeGreaterThanOrEqual(3000);
  });
});

describe('NAT', () => {
  it('without NAT, private sources cannot get replies; PAT fixes it and is reversed on return', () => {
    expect(natScenario(false).ping('PC1', '198.51.100.80').success).toBe(false);
    const n = natScenario();
    const r = n.ping('PC1', '198.51.100.80');
    expect(r.success).toBe(true);
    const nat = r.events.filter(e => e.type === 'NAT_TRANSLATED');
    expect(nat[0].message).toContain('192.168.1.10');
    expect(nat[0].after).toContain('203.0.113.2');
    expect(nat[1].message).toContain('outside → inside');
    const outsideFrame = r.captures.find(c => c.linkId === n.snapshot().links.find(l => l.sourceDevice === 'R1' && l.targetDevice === 'ISP')!.id && c.info.includes('request'));
    expect(outsideFrame?.source).toBe('203.0.113.2');
  });
  it('PAT assigns a different global port when two hosts use the same source port', () => {
    const n = natScenario();
    expect(n.http('PC1', 'http://198.51.100.80/').status).toBe(200);
    expect(n.http('PC2', 'http://198.51.100.80/').status).toBe(200);
    const table = n.device('R1').natTable!.filter(e => e.protocol === 'tcp');
    expect(table.map(e => e.insideLocalPort)).toEqual([49152, 49152]);
    expect(new Set(table.map(e => e.insideGlobalPort)).size).toBe(2);
  });
  it('traceroute through PAT receives translated ICMP errors', () => {
    const probes = natScenario().traceroute('PC1', '198.51.100.80');
    expect(probes.map(p => p.address)).toEqual(['192.168.1.1', '203.0.113.1', '198.51.100.80']);
  });
  it('unsolicited inbound traffic needs a port-forward (DNAT)', () => {
    const n = natScenario();
    expect(n.http('EXT', 'http://203.0.113.2/').success).toBe(false);
    n.update('R1', d => { d.nat!.push({ id: 'nas', type: 'port-forward', protocol: 'tcp', outside: '203.0.113.2', outsidePort: 80, inside: '192.168.1.20', insidePort: 80 }); });
    const r = n.http('EXT', 'http://203.0.113.2/');
    expect(r.status).toBe(200);
    expect(r.body).toContain('NAS');
  });
  it('ICMP errors from inside are translated outbound: outer source and the quoted destination become inside-global', () => {
    const n = natScenario();
    n.update('R1', d => { d.nat!.push({ id: 'dns', type: 'port-forward', protocol: 'udp', outside: '203.0.113.2', outsidePort: 53, inside: '192.168.1.20', insidePort: 53 }); });
    const r = n.dnsLookup('EXT', 'www.example.com', 'A', { server: '203.0.113.2' });
    const icmp = r.captures.find(c => c.deviceId === 'R1' && c.interfaceId === 'g0/1' && c.packet?.protocol === 'ICMP')?.packet as IcmpPacket;
    expect(icmp).toMatchObject({ source: '203.0.113.2', original: { destination: '203.0.113.2', destinationPort: 53 } });
  });
  it('static NAT maps one inside host 1:1', () => {
    const n = natScenario();
    n.update('R1', d => { d.nat = [{ id: 's1', type: 'static', inside: '192.168.1.20', outside: '203.0.113.2' }]; });
    expect(n.http('EXT', 'http://203.0.113.2/').status).toBe(200);
  });
});

describe('Firewall', () => {
  it('default deny drops, rules permit, stateful return traffic is automatic', () => {
    expect(firewallScenario(false).http('PC1', 'https://10.0.2.80/', { insecure: true }).success).toBe(false);
    const n = firewallScenario(true);
    const r = n.http('PC1', 'https://10.0.2.80/', { insecure: true });
    expect(r.status).toBe(200);
    expect(r.events.some(e => e.type === 'FIREWALL_ACCEPT' && e.message.includes('conntrack'))).toBe(true);
    // The final ACK after FIN keeps the entry CLOSED with the short timeout.
    expect(n.device('FW').conntrack).toMatchObject([{ destinationPort: 443, state: 'CLOSED' }]);
    expect(n.device('FW').conntrack![0].expiresAt).toBeLessThanOrEqual(n.now() + 10_000);
    // SSH is not permitted
    const ssh = n.tcpConnect('PC1', '10.0.2.80', 22);
    expect(ssh.success).toBe(false);
    expect(ssh.events.some(e => e.type === 'FIREWALL_DROP' && e.message.includes('デフォルトポリシー'))).toBe(true);
  });
  it('stateless mode needs an explicit return rule', () => {
    const n = firewallScenario(true);
    n.update('FW', d => { d.firewall!.stateful = false; });
    expect(n.tcpConnect('PC1', '10.0.2.80', 443).success).toBe(false);
    n.update('FW', d => { d.firewall!.rules.push(parseRule(40, 'permit tcp host 10.0.2.80 eq 443 10.0.1.0/24 established'.split(' '))); });
    expect(n.tcpConnect('PC1', '10.0.2.80', 443).success).toBe(true);
  });
  it('first match wins; reject sends ICMP administratively prohibited', () => {
    const n = firewallScenario(true);
    n.update('FW', d => { d.firewall!.rules.unshift(parseRule(5, 'reject tcp any host 10.0.2.80 eq 443'.split(' '))); });
    const r = n.tcpConnect('PC1', '10.0.2.80', 443);
    expect(r.success).toBe(false);
    expect(r.reason).toContain('prohibited');
    expect(r.events.find(e => e.type === 'FIREWALL_DROP')?.rule).toContain('5 reject');
  });
  it('DMZ publishing: outside → port-forward → firewall rule on the inside address', () => {
    const n = firewallScenario(true);
    expect(n.http('EXT', 'https://203.0.113.2/').status).toBe(200);
    n.update('FW', d => { d.firewall!.rules = d.firewall!.rules.filter(r => r.seq !== 20); });
    expect(n.http('EXT', 'https://203.0.113.2/').success).toBe(false);
  });
  it('router ACL is stateless and returns !X to traceroute', () => {
    const n = routingScenario(true);
    n.update('R1', d => {
      d.acls = [{ name: 'NO-PING', rules: [parseRule(10, 'deny icmp any host 192.168.2.10'.split(' ')), parseRule(20, 'permit ip any any'.split(' '))] }];
      d.interfaces[0].acl = { in: 'NO-PING' };
    });
    const r = n.ping('PC1', '192.168.2.10');
    expect(r.success).toBe(false);
    expect(r.reply?.code).toBe(13);
    expect(n.traceroute('PC1', '192.168.2.10').at(-1)?.marker).toBe('!X');
  });
  it('TCP traceroute stops when the destination REJECTs with Port Unreachable', () => {
    const n = routingScenario(true);
    n.update('PC2', d => { d.firewall = { stateful: false, defaultAction: 'permit', rules: [parseRule(1, 'reject tcp any any eq 80'.split(' '))] }; });
    expect(n.traceroute('PC1', '192.168.2.10', 16, 'tcp', 80).map(p => p.address)).toEqual(['192.168.1.1', '10.0.0.2', '192.168.2.10']);
  });
  it('Linux host INPUT chain with conntrack', () => {
    const n = dnsScenario();
    n.update('WEB', d => { d.firewall = { stateful: false, defaultAction: 'deny', rules: [] }; });
    expect(n.http('PC1', 'http://203.0.113.80/').success).toBe(false);
    n.update('WEB', d => { d.firewall!.rules.push(parseRule(1, 'permit tcp any any eq 80'.split(' '))); });
    expect(n.http('PC1', 'http://203.0.113.80/').status).toBe(200);
    // Outgoing connections need ESTABLISHED replies allowed.
    n.update('PC1', d => { d.firewall = { stateful: false, defaultAction: 'deny', rules: [] }; });
    expect(n.ping('PC1', '192.168.1.53').success).toBe(false);
    expect(n.http('PC1', 'http://203.0.113.80/').success).toBe(false);
    n.update('PC1', d => { d.firewall!.rules.push(parseRule(1, 'permit ip any any ctstate ESTABLISHED,RELATED'.split(' '))); });
    expect(n.ping('PC1', '192.168.1.53').success).toBe(true);
    expect(n.http('PC1', 'http://203.0.113.80/').status).toBe(200);
    // WEB's policy still drops ICMP: only tcp/80 is allowed in.
    expect(n.ping('PC1', '203.0.113.80').success).toBe(false);
  });
  it('evaluates rule fields: ports, ranges, protocols', () => {
    const pkt = (dport: number): Packet => ({ id: 1, source: '10.0.0.1', destination: '10.0.0.2', ttl: 64, protocol: 'TCP', sourcePort: 50000, destinationPort: dport, flags: ['SYN'], seq: 1, ack: 0, window: 1 });
    const rules = [parseRule(10, 'permit tcp any any range 8000 8080'.split(' ')), parseRule(20, 'deny ip any any'.split(' '))];
    expect(evaluateRules(rules, 'permit', pkt(8080)).action).toBe('permit');
    expect(evaluateRules(rules, 'permit', pkt(8081)).rule?.seq).toBe(20);
    expect(() => parseRule(1, 'permit icmp any any eq 80'.split(' '))).toThrow();
    const icmp: IcmpPacket = { id: 1, source: '1.1.1.1', destination: '2.2.2.2', ttl: 1, protocol: 'ICMP', type: 'echo-request', identifier: 1, sequence: 1 };
    expect(evaluateRules(rules, 'permit', icmp).rule?.seq).toBe(20);
  });
});
