import { describe, expect, it } from 'vitest';
import { checksum, encodeFrame, encodeDns } from './encode';
import { decodeFrame } from './decode';
import { packetFilter } from './PacketFilter';
import { parsePcap, writePcap } from './pcap';
import { dnsScenario, vlanScenario } from '../scenarios/chapters';
import type { Packet } from '../core/types';

const pseudoSum = (bytes: number[], ipStart: number) => {
  const ihl = (bytes[ipStart] & 15) * 4; const total = bytes[ipStart + 2] * 256 + bytes[ipStart + 3];
  const seg = bytes.slice(ipStart + ihl, ipStart + total);
  return checksum([...bytes.slice(ipStart + 12, ipStart + 20), 0, bytes[ipStart + 9], (seg.length >> 8) & 255, seg.length & 255, ...seg]);
};

describe('Encoding / decoding', () => {
  it('TCP and UDP checksums (pseudo header) verify to zero', () => {
    const r = dnsScenario().http('PC1', 'http://www.example.com/');
    for (const c of r.captures.filter(c => c.ipProtocol === 6 || c.ipProtocol === 17)) {
      const ip = c.vlan === undefined ? 14 : 18;
      expect(checksum(c.bytes.slice(ip, ip + 20))).toBe(0);
      expect(pseudoSum(c.bytes, ip)).toBe(0);
    }
  });
  it('decodes DNS, HTTP and TCP into layered fields with byte offsets', () => {
    const r = dnsScenario().http('PC1', 'http://www.example.com/');
    const dns = r.captures.find(c => c.protocol === 'DNS' && c.info.includes('response') && c.destination === '192.168.1.10')!;
    const d = decodeFrame(dns.bytes);
    expect(d.layers.map(l => l.name)).toEqual(['Ethernet II', 'Internet Protocol Version 4', 'User Datagram Protocol', 'Domain Name System']);
    expect(d.summary.info).toContain('A www.example.com');
    expect(d.summary.info).toContain('203.0.113.80');
    const http = r.captures.find(c => c.protocol === 'HTTP' && c.info.startsWith('GET'))!;
    expect(http.info).toBe('GET / HTTP/1.1');
    const ttl = decodeFrame(http.bytes).layers[1].fields.find(f => f.label === 'Time to live')!;
    expect(http.bytes[ttl.offset]).toBe(Number(ttl.value));
  });
  it('decodes 802.1Q, ARP and ICMP', () => {
    const r = vlanScenario().ping('PC1', '192.168.20.14');
    const tagged = r.captures.find(c => c.vlan === 20)!;
    expect(decodeFrame(tagged.bytes).layers[1].name).toBe('802.1Q Virtual LAN');
    expect(r.captures.find(c => c.protocol === 'ARP')!.info).toMatch(/Who has .*\? Tell/);
  });
  it('reports truncated frames instead of throwing', () => {
    const r = vlanScenario().ping('PC1', '192.168.10.13');
    const bytes = r.captures.find(c => c.protocol === 'ICMP')!.bytes.slice(0, 30);
    const d = decodeFrame(bytes);
    expect(d.error).toBe('truncated');
    expect(d.layers.at(-1)!.name).toContain('truncated');
  });
  it('a ClientHello split across TCP segments (SNI in the 2nd) decodes as partial TLS, not malformed', () => {
    const hello = dnsScenario().http('PC1', 'https://www.example.com/').captures.find(c => c.info.startsWith('Client Hello'))!;
    const sni = decodeFrame(hello.bytes).layers.flatMap(l => l.fields).find(f => f.label === 'Server Name Indication')!;
    const first = hello.bytes.slice(0, sni.offset - 4);
    [first[16], first[17]] = [(first.length - 14) >> 8, (first.length - 14) & 255];
    const d = decodeFrame(first);
    expect(d.error).toBeUndefined();
    expect(d.summary).toMatchObject({ protocol: 'TLS', info: expect.stringContaining('Client Hello') });
  });
  it('encodes a DNS message byte-exactly', () => {
    const bytes = encodeDns({ id: 0x1234, response: false, opcode: 0, aa: false, rd: true, ra: false, rcode: 'NOERROR', question: { name: 'a.io.', type: 'A' }, answer: [], authority: [], additional: [] });
    expect(bytes).toEqual([0x12, 0x34, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0, 1, 97, 2, 105, 111, 0, 0, 1, 0, 1]);
  });
  it('prints IPv6 addresses in RFC 5952 form (longest zero run compressed)', () => {
    const src = [0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]; const dst = [...Array(15).fill(0), 1];
    const s = decodeFrame([...Array(12).fill(2), 0x86, 0xdd, 0x60, 0, 0, 0, 0, 0, 59, 64, ...src, ...dst]).summary;
    expect([s.source, s.destination]).toEqual(['2001:db8:0:0:1::', '::1']);
  });
  it('minimum Ethernet frame is padded to 60 bytes', () => {
    const syn: Packet = { id: 1, source: '10.0.0.1', destination: '10.0.0.2', ttl: 64, protocol: 'TCP', sourcePort: 1, destinationPort: 2, flags: ['SYN'], seq: 0, ack: 0, window: 1 };
    expect(encodeFrame(syn, '02:00:00:00:00:01', '02:00:00:00:00:02')).toHaveLength(60);
  });
});

describe('BPF-like filter', () => {
  const r = dnsScenario().http('PC1', 'http://www.example.com/');
  it.each([
    ['udp port 53', c => c.protocol === 'DNS'],
    ['tcp dst port 80', c => c.ipProtocol === 6 && c.destinationPort === 80],
    ['tcp and dst port 80', c => c.destinationPort === 80],
    ['host 203.0.113.80 and not arp', c => c.hosts.includes('203.0.113.80') && c.protocol !== 'ARP'],
    ['(dns or http) and src net 192.168.1.0/24', c => ['DNS', 'HTTP'].includes(c.protocol) && c.source.startsWith('192.168.1.')],
    ['arp || icmp', c => c.protocol === 'ARP' || c.ipProtocol === 1],
    ['arp or udp and port 53', c => c.protocol === 'DNS'], // and / or: equal precedence, left to right
  ] as [string, (c: (typeof r.captures)[number]) => boolean][])('%s', (expr, expected) => {
    const got = r.captures.filter(packetFilter(expr));
    expect(got.length).toBeGreaterThan(0);
    expect(got.length).toBe(r.captures.filter(expected).length);
  });
  it.each(['port', 'host 1.2.3', 'tcp and', '(tcp', 'src tcp', 'vlan 5000', 'magic'])('rejects %s', expr => expect(() => packetFilter(expr)).toThrow());
});

describe('PCAP', () => {
  it('round-trips simulator captures through the pcap writer and reader', () => {
    const r = dnsScenario().http('PC1', 'https://www.example.com/');
    const file = writePcap(r.captures);
    const parsed = parsePcap(file.buffer as ArrayBuffer);
    expect(parsed.packets).toHaveLength(r.captures.length);
    expect(parsed.packets[3].bytes).toEqual(r.captures[3].bytes);
    expect(decodeFrame(parsed.packets[3].bytes).summary).toEqual(r.captures[3] && decodeFrame(r.captures[3].bytes).summary);
    expect(parsed.packets[1].time).toBeCloseTo(r.captures[1].time, 3);
  });
  it('reads pcapng Enhanced Packet Blocks', () => {
    const frame = dnsScenario().ping('PC1', '192.168.1.53').captures[0].bytes;
    const pad = (n: number) => (4 - (n % 4)) % 4;
    const u32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
    const shb = [...u32(0x0a0d0d0a), ...u32(28), ...u32(0x1a2b3c4d), 1, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, ...u32(28)];
    const idb = [...u32(1), ...u32(20), 1, 0, 0, 0, ...u32(65535), ...u32(20)];
    const epbLen = 32 + frame.length + pad(frame.length);
    const epb = [...u32(6), ...u32(epbLen), ...u32(0), ...u32(0), ...u32(1_500_000), ...u32(frame.length), ...u32(frame.length), ...frame, ...Array(pad(frame.length)).fill(0), ...u32(epbLen)];
    const parsed = parsePcap(new Uint8Array([...shb, ...idb, ...epb]).buffer);
    expect(parsed.format).toBe('pcapng');
    expect(parsed.packets[0].bytes).toEqual(frame);
    expect(parsed.packets[0].time).toBeCloseTo(1500, 3);
  });
  it('rejects non-pcap and truncated files safely', () => {
    expect(() => parsePcap(new Uint8Array(40).buffer)).toThrow();
    const file = writePcap([{ time: 0, bytes: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] }]);
    const truncated = parsePcap(file.slice(0, file.length - 4).buffer as ArrayBuffer);
    expect(truncated.packets).toHaveLength(0);
    expect(truncated.warnings[0]).toContain('切れて');
  });
});
