import ipaddr from 'ipaddr.js';
import type { AppPayload, DnsMessage, DnsRecord, DnsType, Packet, TcpFlag } from '../core/types';

export const macBytes = (mac: string) => mac.split(':').map(n => parseInt(n, 16));
export const ipBytes = (ip: string) => ip.split('.').map(Number);
export const word = (n: number) => [(n >>> 8) & 255, n & 255];
export const dword = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u24 = (n: number) => [(n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const utf8 = (text: string) => Array.from(new TextEncoder().encode(text));

export function checksum(bytes: number[]) {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 2) sum += (bytes[i] << 8) | (bytes[i + 1] ?? 0);
  while (sum >>> 16) sum = (sum & 65535) + (sum >>> 16);
  return (~sum) & 65535;
}
/** Deterministic filler for "encrypted" bytes (not cryptography). */
function opaque(length: number, seed: number) {
  let x = (seed * 2654435761) >>> 0 || 1;
  return Array.from({ length }, () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x & 255; });
}

// ---- DNS (RFC 1035 wire format, no name compression) ----
export const dnsTypeCode: Record<DnsType, number> = { A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12, MX: 15, TXT: 16, AAAA: 28 };
export const dnsRcode = { NOERROR: 0, SERVFAIL: 2, NXDOMAIN: 3, REFUSED: 5 } as const;
function dnsName(name: string) {
  if (name === '.') return [0];
  return [...name.replace(/\.$/, '').split('.').flatMap(l => [l.length, ...utf8(l)]), 0];
}
function rdata(r: DnsRecord): number[] {
  switch (r.type) {
    case 'A': return ipBytes(r.value);
    case 'AAAA': return ipaddr.IPv6.parse(r.value).toByteArray();
    case 'NS': case 'CNAME': case 'PTR': return dnsName(r.value);
    case 'MX': { const [pref, host] = r.value.split(' '); return [...word(Number(pref)), ...dnsName(host)]; }
    case 'TXT': { const b = utf8(r.value).slice(0, 255); return [b.length, ...b]; }
    case 'SOA': { const p = r.value.split(' '); return [...dnsName(p[0]), ...dnsName(p[1]), ...p.slice(2).flatMap(n => dword(Number(n)))]; }
  }
}
export function encodeDns(m: DnsMessage) {
  const flags = (m.response ? 0x8000 : 0) | (m.aa ? 0x400 : 0) | (m.rd ? 0x100 : 0) | (m.ra ? 0x80 : 0) | dnsRcode[m.rcode];
  const rr = (r: DnsRecord) => { const d = rdata(r); return [...dnsName(r.name), ...word(dnsTypeCode[r.type]), 0, 1, ...dword(r.ttl), ...word(d.length), ...d]; };
  return [...word(m.id), ...word(flags), ...word(1), ...word(m.answer.length), ...word(m.authority.length), ...word(m.additional.length),
    ...dnsName(m.question.name), ...word(dnsTypeCode[m.question.type]), 0, 1,
    ...m.answer.flatMap(rr), ...m.authority.flatMap(rr), ...m.additional.flatMap(rr)];
}

// ---- TLS 1.3 records (structure only; content after ServerHello is opaque) ----
function tls(payload: Extract<AppPayload, { kind: 'tls' }>, seed: number) {
  const record = (type: number, version: number, body: number[]) => [type, 3, version, ...word(body.length), ...body];
  if (payload.record === 'client-hello') {
    const sni = utf8(payload.sni ?? '');
    const ext = [
      ...(sni.length ? [0, 0, ...word(sni.length + 5), ...word(sni.length + 3), 0, ...word(sni.length), ...sni] : []),
      0, 0x2b, 0, 3, 2, 3, 4,
    ];
    const body = [3, 3, ...opaque(32, seed), 0, 0, 6, 0x13, 1, 0x13, 2, 0x13, 3, 1, 0, ...word(ext.length), ...ext];
    return record(22, 1, [1, ...u24(body.length), ...body]);
  }
  if (payload.record === 'server-hello') {
    const body = [3, 3, ...opaque(32, seed), 0, 0x13, 1, 0, ...word(6), 0, 0x2b, 0, 2, 3, 4];
    // ServerHello, compatibility ChangeCipherSpec, then encrypted EncryptedExtensions/Certificate/Finished.
    return [...record(22, 3, [2, ...u24(body.length), ...body]), ...record(20, 3, [1]), ...record(23, 3, opaque(64 + payload.detail.length, seed + 1))];
  }
  return record(23, 3, opaque(payload.record === 'alert' ? 19 : 16 + utf8(payload.detail).length, seed));
}
export function encodePayload(payload: AppPayload | undefined, seed = 1): number[] {
  if (!payload) return [];
  if (payload.kind === 'dns') return encodeDns(payload.message);
  if (payload.kind === 'tls') return tls(payload, seed);
  return utf8(payload.text);
}

// ---- L4 / L3 ----
const tcpFlagBits: Record<TcpFlag, number> = { FIN: 1, SYN: 2, RST: 4, PSH: 8, ACK: 16 };
const pseudo = (p: Packet, protocol: number, length: number) => [...ipBytes(p.source), ...ipBytes(p.destination), 0, protocol, ...word(length)];
export const ipProtocolNumber = (p: Packet) => ({ ICMP: 1, TCP: 6, UDP: 17, GRE: 47, ESP: 50 })[p.protocol];

function transport(packet: Packet): number[] {
  switch (packet.protocol) {
    case 'ICMP': {
      const type = { 'echo-request': 8, 'echo-reply': 0, 'time-exceeded': 11, unreachable: 3 }[packet.type];
      const echo = type === 8 || type === 0;
      const body = echo ? [...word(packet.identifier), ...word(packet.sequence), ...utf8('PATH learning packet')] : [0, 0, 0, 0, ...(packet.quote ?? [])];
      const icmp = [type, packet.code ?? 0, 0, 0, ...body];
      icmp.splice(2, 2, ...word(checksum(icmp)));
      return icmp;
    }
    case 'TCP': {
      const data = encodePayload(packet.payload, packet.id);
      const flags = packet.flags.reduce((n, f) => n | tcpFlagBits[f], 0);
      const seg = [...word(packet.sourcePort), ...word(packet.destinationPort), ...dword(packet.seq), ...dword(packet.ack), 0x50, flags, ...word(packet.window), 0, 0, 0, 0, ...data];
      seg.splice(16, 2, ...word(checksum([...pseudo(packet, 6, seg.length), ...seg])));
      return seg;
    }
    case 'UDP': {
      const data = encodePayload(packet.payload, packet.id);
      const dgram = [...word(packet.sourcePort), ...word(packet.destinationPort), ...word(8 + data.length), 0, 0, ...data];
      const sum = checksum([...pseudo(packet, 17, dgram.length), ...dgram]);
      dgram.splice(6, 2, ...word(sum === 0 ? 0xffff : sum));
      return dgram;
    }
    case 'GRE': return [0, 0, 8, 0, ...encodeIp(packet.inner)];
    case 'ESP': {
      const inner = encodeIp(packet.inner);
      return [...dword(packet.spi ?? 0x1001), ...dword(packet.id), ...opaque(inner.length + 18, packet.id)];
    }
  }
}
export function encodeIp(packet: Packet) {
  const body = transport(packet);
  const header = [0x45, 0, ...word(20 + body.length), ...word(packet.id & 65535), 0, 0, packet.ttl, ipProtocolNumber(packet), 0, 0, ...ipBytes(packet.source), ...ipBytes(packet.destination)];
  header.splice(10, 2, ...word(checksum(header)));
  return [...header, ...body];
}

// ---- L2 ----
export function encodeEthernet(destinationMac: string, sourceMac: string, etherType: number, body: number[], vlan?: number) {
  const tag = vlan === undefined ? [] : [0x81, 0x00, ...word(vlan & 0xfff)];
  const frame = [...macBytes(destinationMac), ...macBytes(sourceMac), ...tag, ...word(etherType), ...body];
  // Minimum Ethernet frame without FCS is 60 bytes.
  return frame.length < 60 ? [...frame, ...Array(60 - frame.length).fill(0)] : frame;
}
export function encodeFrame(packet: Packet, sourceMac: string, destinationMac: string, vlan?: number) {
  return encodeEthernet(destinationMac, sourceMac, 0x0800, encodeIp(packet), vlan);
}
export function encodeArp(sourceMac: string, destinationMac: string, source: string, target: string, reply: boolean, vlan?: number) {
  const body = [0, 1, 8, 0, 6, 4, 0, reply ? 2 : 1, ...macBytes(sourceMac), ...ipBytes(source),
    ...macBytes(reply ? destinationMac : '00:00:00:00:00:00'), ...ipBytes(target)];
  return encodeEthernet(destinationMac, sourceMac, 0x0806, body, vlan);
}
export function hexDump(bytes: ArrayLike<number>) {
  const rows: string[] = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const chunk = Array.from(bytes).slice(i, i + 16);
    const ascii = chunk.map(b => b >= 32 && b < 127 ? String.fromCharCode(b) : '.').join('');
    rows.push(`${i.toString(16).padStart(4, '0')}  ${chunk.map(b => b.toString(16).padStart(2, '0')).join(' ').padEnd(47)}  ${ascii}`);
  }
  return rows.join('\n');
}
