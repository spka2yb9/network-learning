import ipaddr from 'ipaddr.js';
import type { CaptureSummary } from '../core/types';

export interface Field { label: string; value: string; offset: number; length: number }
export interface Layer { name: string; offset: number; length: number; fields: Field[] }
export interface Decoded { layers: Layer[]; summary: CaptureSummary; error?: string }

class Truncated extends Error {}
class Reader {
  constructor(private bytes: ArrayLike<number>, public end = bytes.length) {}
  u8(o: number) { if (o >= this.end || o < 0) throw new Truncated(); return this.bytes[o]; }
  u16(o: number) { return this.u8(o) * 256 + this.u8(o + 1); }
  u32(o: number) { return ((this.u16(o) * 65536) + this.u16(o + 2)) >>> 0; }
  slice(o: number, n: number) { if (o + n > this.end) throw new Truncated(); return Array.from({ length: n }, (_, i) => this.bytes[o + i]); }
  mac(o: number) { return this.slice(o, 6).map(b => b.toString(16).padStart(2, '0')).join(':'); }
  ip(o: number) { return this.slice(o, 4).join('.'); }
  /** RFC 5952 text form (longest zero run compressed). */
  ip6(o: number) { return ipaddr.fromByteArray(this.slice(o, 16)).toString(); }
  text(o: number, n: number) { return new TextDecoder().decode(new Uint8Array(this.slice(o, Math.min(n, this.end - o)))); }
}
const hex = (n: number, width = 4) => `0x${n.toString(16).padStart(width, '0')}`;
const icmpTypes: Record<number, string> = { 0: 'Echo (ping) reply', 3: 'Destination unreachable', 8: 'Echo (ping) request', 11: 'Time-to-live exceeded' };
const unreachableCodes: Record<number, string> = { 0: 'Network unreachable', 1: 'Host unreachable', 3: 'Port unreachable', 4: 'Fragmentation needed', 13: 'Communication administratively filtered' };
const dnsTypes: Record<number, string> = { 1: 'A', 2: 'NS', 5: 'CNAME', 6: 'SOA', 12: 'PTR', 15: 'MX', 16: 'TXT', 28: 'AAAA' };
const rcodes: Record<number, string> = { 0: 'No error', 2: 'Server failure', 3: 'No such name', 5: 'Refused' };

export function decodeFrame(input: ArrayLike<number>): Decoded {
  const r = new Reader(input);
  const layers: Layer[] = [];
  const s: CaptureSummary = { source: '', destination: '', sourceMac: '', destinationMac: '', protocol: 'Ethernet', info: '', hosts: [] };
  const layer = (name: string, offset: number, length: number) => { const l: Layer = { name, offset, length, fields: [] }; layers.push(l); return l; };
  const field = (l: Layer, label: string, value: string | number, offset: number, length: number) => l.fields.push({ label, value: String(value), offset, length });
  try {
    const eth = layer('Ethernet II', 0, 14);
    s.destinationMac = r.mac(0); s.sourceMac = r.mac(6);
    field(eth, 'Destination', s.destinationMac === 'ff:ff:ff:ff:ff:ff' ? 'ff:ff:ff:ff:ff:ff (Broadcast)' : s.destinationMac, 0, 6);
    field(eth, 'Source', s.sourceMac, 6, 6);
    let o = 12; let type = r.u16(o);
    if (type === 0x8100) {
      const tci = r.u16(14); s.vlan = tci & 0xfff;
      const q = layer('802.1Q Virtual LAN', 12, 4);
      field(q, 'TPID', '0x8100', 12, 2); field(q, 'Priority (PCP)', tci >> 13, 14, 2); field(q, 'VLAN ID', s.vlan, 14, 2);
      o = 16; type = r.u16(o); eth.length = 18;
    }
    field(eth, 'Type', type === 0x0800 ? '0x0800 (IPv4)' : type === 0x0806 ? '0x0806 (ARP)' : type === 0x86dd ? '0x86dd (IPv6)' : hex(type), o, 2);
    const start = o + 2;
    if (type === 0x0806) decodeArp(start);
    else if (type === 0x0800) decodeIpv4(start, r.end, true);
    else if (type === 0x86dd) decodeIpv6(start);
    else { s.protocol = hex(type); s.info = 'Ethernet frame'; }
  } catch (error) {
    if (!(error instanceof Truncated)) throw error;
    layers.push({ name: '[Malformed / truncated packet]', offset: 0, length: 0, fields: [] });
    s.info ||= 'Truncated frame';
    return { layers, summary: s, error: 'truncated' };
  }
  return { layers, summary: s };

  function decodeArp(o: number) {
    const l = layer('Address Resolution Protocol', o, 28);
    const op = r.u16(o + 6);
    field(l, 'Opcode', op === 1 ? 'request (1)' : op === 2 ? 'reply (2)' : op, o + 6, 2);
    field(l, 'Sender MAC', r.mac(o + 8), o + 8, 6); field(l, 'Sender IP', r.ip(o + 14), o + 14, 4);
    field(l, 'Target MAC', r.mac(o + 18), o + 18, 6); field(l, 'Target IP', r.ip(o + 24), o + 24, 4);
    s.protocol = 'ARP'; s.source = r.ip(o + 14); s.destination = r.ip(o + 24); s.hosts.push(s.source, s.destination);
    s.info = op === 1 ? `Who has ${s.destination}? Tell ${s.source}` : `${s.source} is at ${r.mac(o + 8)}`;
  }
  function decodeIpv4(o: number, limit: number, outer: boolean) {
    const ihl = (r.u8(o) & 15) * 4; const total = r.u16(o + 2); const proto = r.u8(o + 9);
    const src = r.ip(o + 12); const dst = r.ip(o + 16);
    const l = layer('Internet Protocol Version 4', o, ihl);
    field(l, 'Version / Header length', `4 / ${ihl} bytes`, o, 1); field(l, 'Total length', total, o + 2, 2);
    field(l, 'Identification', hex(r.u16(o + 4)), o + 4, 2); field(l, 'Time to live', r.u8(o + 8), o + 8, 1);
    field(l, 'Protocol', { 1: 'ICMP (1)', 6: 'TCP (6)', 17: 'UDP (17)', 47: 'GRE (47)', 50: 'ESP (50)' }[proto] ?? proto, o + 9, 1);
    field(l, 'Header checksum', hex(r.u16(o + 10)), o + 10, 2);
    field(l, 'Source', src, o + 12, 4); field(l, 'Destination', dst, o + 16, 4);
    s.source = src; s.destination = dst; s.hosts.push(src, dst);
    if (outer) s.ipProtocol = proto;
    const end = Math.min(limit, o + total);
    const p = o + ihl;
    s.protocol = 'IPv4'; s.info = `IPv4 protocol ${proto}`;
    if (proto === 1) decodeIcmp(p, end, src, dst);
    else if (proto === 6) decodeTcp(p, end);
    else if (proto === 17) decodeUdp(p, end);
    else if (proto === 47) {
      const g = layer('Generic Routing Encapsulation', p, 4);
      field(g, 'Flags / Version', hex(r.u16(p)), p, 2); field(g, 'Protocol type', r.u16(p + 2) === 0x0800 ? 'IP (0x0800)' : hex(r.u16(p + 2)), p + 2, 2);
      if (r.u16(p + 2) === 0x0800) {
        // src / dst / port (what tcpdump filters match) stay the outer header's; the inner packet is in the layers, info and `hosts`.
        const outer = { source: s.source, destination: s.destination };
        decodeIpv4(p + 4, end, false);
        s.info = `GRE: ${s.source} → ${s.destination} ${s.info}`;
        Object.assign(s, outer); delete s.sourcePort; delete s.destinationPort;
      }
    } else if (proto === 50) {
      const e = layer('Encapsulating Security Payload', p, end - p);
      const spi = r.u32(p);
      field(e, 'SPI', hex(spi, 8), p, 4); field(e, 'Sequence', r.u32(p + 4), p + 4, 4); field(e, 'Encrypted data', `${end - p - 8} bytes（暗号化されており中身は読めません）`, p + 8, end - p - 8);
      s.protocol = 'ESP'; s.info = `ESP (SPI=${hex(spi, 8)})`;
    }
  }
  function decodeIpv6(o: number) {
    const l = layer('Internet Protocol Version 6', o, 40);
    const next = r.u8(o + 6); const src = r.ip6(o + 8); const dst = r.ip6(o + 24);
    field(l, 'Payload length', r.u16(o + 4), o + 4, 2); field(l, 'Next header', next, o + 6, 1); field(l, 'Hop limit', r.u8(o + 7), o + 7, 1);
    field(l, 'Source', src, o + 8, 16); field(l, 'Destination', dst, o + 24, 16);
    s.source = src; s.destination = dst; s.hosts.push(src, dst); s.ipProtocol = next; s.protocol = 'IPv6'; s.info = `IPv6 next header ${next}`;
    const end = Math.min(r.end, o + 40 + r.u16(o + 4));
    if (next === 6) decodeTcp(o + 40, end); else if (next === 17) decodeUdp(o + 40, end);
    else if (next === 58) { s.protocol = 'ICMPv6'; s.info = `ICMPv6 type ${r.u8(o + 40)}`; layer('Internet Control Message Protocol v6', o + 40, end - o - 40); }
  }
  function decodeIcmp(o: number, end: number, src: string, dst: string) {
    const type = r.u8(o); const code = r.u8(o + 1);
    const l = layer('Internet Control Message Protocol', o, end - o);
    field(l, 'Type', `${type} (${icmpTypes[type] ?? 'Unknown'})`, o, 1);
    field(l, 'Code', type === 3 ? `${code} (${unreachableCodes[code] ?? 'Unknown'})` : code, o + 1, 1);
    field(l, 'Checksum', hex(r.u16(o + 2)), o + 2, 2);
    s.protocol = 'ICMP';
    if (type === 0 || type === 8) {
      field(l, 'Identifier', hex(r.u16(o + 4)), o + 4, 2); field(l, 'Sequence number', r.u16(o + 6), o + 6, 2);
      s.info = `${icmpTypes[type]} id=${hex(r.u16(o + 4))}, seq=${r.u16(o + 6)}`;
    } else {
      s.info = type === 3 ? `Destination unreachable (${unreachableCodes[code] ?? code})` : type === 11 ? 'Time-to-live exceeded (Time to live exceeded in transit)' : `ICMP type ${type}`;
      if (end - o >= 28) {
        field(l, 'Quoted IPv4 source → destination', `${r.ip(o + 20)} → ${r.ip(o + 24)} (protocol ${r.u8(o + 17)})`, o + 8, 20);
        s.source = src; s.destination = dst;
      }
    }
  }
  function decodeTcp(o: number, end: number) {
    const sp = r.u16(o); const dp = r.u16(o + 2); const offset = (r.u8(o + 12) >> 4) * 4; const bits = r.u8(o + 13);
    const flags = ['FIN', 'SYN', 'RST', 'PSH', 'ACK'].filter((_, i) => bits & (1 << i));
    const order = ['SYN', 'FIN', 'RST', 'PSH', 'ACK'].filter(f => flags.includes(f));
    const l = layer('Transmission Control Protocol', o, offset);
    field(l, 'Source port', sp, o, 2); field(l, 'Destination port', dp, o + 2, 2);
    field(l, 'Sequence number (raw)', r.u32(o + 4), o + 4, 4); field(l, 'Acknowledgment number (raw)', r.u32(o + 8), o + 8, 4);
    field(l, 'Flags', `${hex(bits, 3)} (${order.join(', ') || 'none'})`, o + 13, 1); field(l, 'Window', r.u16(o + 14), o + 14, 2);
    field(l, 'Checksum', hex(r.u16(o + 16)), o + 16, 2);
    const len = Math.max(0, end - o - offset);
    s.protocol = 'TCP'; s.sourcePort = sp; s.destinationPort = dp;
    s.info = `${sp} → ${dp} [${order.join(', ')}] Seq=${r.u32(o + 4)}${bits & 16 ? ` Ack=${r.u32(o + 8)}` : ''} Win=${r.u16(o + 14)} Len=${len}`;
    if (len > 0) application(o + offset, end, sp, dp);
  }
  function decodeUdp(o: number, end: number) {
    const sp = r.u16(o); const dp = r.u16(o + 2);
    const l = layer('User Datagram Protocol', o, 8);
    field(l, 'Source port', sp, o, 2); field(l, 'Destination port', dp, o + 2, 2); field(l, 'Length', r.u16(o + 4), o + 4, 2); field(l, 'Checksum', hex(r.u16(o + 6)), o + 6, 2);
    s.protocol = 'UDP'; s.sourcePort = sp; s.destinationPort = dp; s.info = `${sp} → ${dp} Len=${r.u16(o + 4) - 8}`;
    if (sp === 53 || dp === 53) decodeDns(o + 8, end);
  }
  function application(o: number, end: number, sp: number, dp: number) {
    const first = r.u8(o);
    if ([20, 21, 22, 23].includes(first) && r.u8(o + 1) === 3) return decodeTls(o, end);
    const text = r.text(o, Math.min(end - o, 400));
    if (/^(GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH) \S+ HTTP\/1\.[01]\r\n|^HTTP\/1\.[01] \d{3}/.test(text)) {
      const l = layer('Hypertext Transfer Protocol', o, end - o);
      text.split('\r\n').filter(Boolean).slice(0, 8).forEach(line => field(l, line.split(':')[0], line, o, 0));
      s.protocol = 'HTTP'; s.info = text.split('\r\n')[0];
    } else if (sp === 22 || dp === 22) { s.protocol = 'SSH'; s.info = text.split('\r\n')[0] || 'Encrypted packet'; layer('SSH Protocol', o, end - o); }
    else { layer('Data', o, end - o).fields.push({ label: 'Data', value: `${end - o} bytes`, offset: o, length: end - o }); }
  }
  function decodeTls(o: number, end: number) {
    const parts: string[] = [];
    while (o + 5 <= end) {
      const type = r.u8(o); const len = r.u16(o + 3);
      const l = layer(`Transport Layer Security (${type === 22 ? 'Handshake' : type === 23 ? 'Application Data' : type === 20 ? 'Change Cipher Spec' : type === 21 ? 'Alert' : type})`, o, 5 + len);
      field(l, 'Content type', type, o, 1); field(l, 'Version', hex(r.u16(o + 1)), o + 1, 2); field(l, 'Length', len, o + 3, 2);
      if (type === 22) {
        const hs = r.u8(o + 5);
        field(l, 'Handshake type', hs === 1 ? 'Client Hello (1)' : hs === 2 ? 'Server Hello (2)' : hs, o + 5, 1);
        if (hs === 1) {
          const sni = findSni(o + 9, Math.min(end, o + 5 + len));
          if (sni) field(l, 'Server Name Indication', sni.name, sni.offset, sni.length);
          parts.push(`Client Hello${sni ? ` (SNI=${sni.name})` : ''}`);
        } else parts.push(hs === 2 ? 'Server Hello' : `Handshake ${hs}`);
      } else if (type === 23) { field(l, 'Encrypted Application Data', `${len} bytes`, o + 5, len); parts.push('Application Data'); }
      else if (type === 20) parts.push('Change Cipher Spec');
      else parts.push('Alert');
      // A record longer than this segment continues in the next TCP segment.
      if (o + 5 + len > end) parts[parts.length - 1] += ' [partial]';
      o += 5 + len;
    }
    s.protocol = 'TLS'; s.info = parts.join(', ');
  }
  /** SNI within the captured bytes only (`end`): the SNI may be in a later segment. */
  function findSni(o: number, end: number) {
    const b = new Reader(input, end);
    try {
      let p = o + 2 + 32;
      p += 1 + b.u8(p);
      p += 2 + b.u16(p);
      p += 1 + b.u8(p);
      const extEnd = Math.min(end, p + 2 + b.u16(p)); p += 2;
      while (p + 4 <= extEnd) {
        const t = b.u16(p); const len = b.u16(p + 2);
        if (t === 0) { const n = b.u16(p + 7); return p + 9 + n <= end ? { name: b.text(p + 9, n), offset: p + 9, length: n } : undefined; }
        p += 4 + len;
      }
    } catch (error) { if (!(error instanceof Truncated)) throw error; }
    return undefined;
  }
  function decodeDns(o: number, end: number) {
    const id = r.u16(o); const flags = r.u16(o + 2);
    const qd = r.u16(o + 4); const an = r.u16(o + 6); const ns = r.u16(o + 8); const ar = r.u16(o + 10);
    const response = !!(flags & 0x8000); const rcode = flags & 15;
    const l = layer('Domain Name System', o, end - o);
    field(l, 'Transaction ID', hex(id), o, 2);
    field(l, 'Flags', `${hex(flags)} ${response ? 'Response' : 'Query'}${flags & 0x400 ? ', Authoritative' : ''}${flags & 0x100 ? ', Recursion desired' : ''}${flags & 0x80 ? ', Recursion available' : ''}${response ? `, ${rcodes[rcode] ?? rcode}` : ''}`, o + 2, 2);
    field(l, 'Questions / Answers / Authority / Additional', `${qd} / ${an} / ${ns} / ${ar}`, o + 4, 8);
    let p = o + 12;
    const name = (at: number): [string, number] => {
      const labels: string[] = []; let q = at; let jumped = -1; let guard = 0;
      while (guard++ < 128) {
        const len = r.u8(q);
        if (len === 0) { q++; break; }
        if ((len & 0xc0) === 0xc0) { if (jumped < 0) jumped = q + 2; q = o + (((len & 0x3f) << 8) | r.u8(q + 1)); continue; }
        labels.push(r.text(q + 1, len)); q += 1 + len;
      }
      return [labels.length ? `${labels.join('.')}` : '<Root>', jumped >= 0 ? jumped : q];
    };
    let qname = ''; let qtype = '';
    for (let i = 0; i < qd; i++) {
      const [n, next] = name(p); qname = n; qtype = dnsTypes[r.u16(next)] ?? String(r.u16(next));
      field(l, 'Query', `${n}: type ${qtype}, class IN`, p, next + 4 - p); p = next + 4;
    }
    const answers: string[] = [];
    for (const [section, count] of [['Answer', an], ['Authority', ns], ['Additional', ar]] as const) {
      for (let i = 0; i < count; i++) {
        const [n, next] = name(p); const type = r.u16(next); const ttl = r.u32(next + 4); const len = r.u16(next + 8); const d = next + 10;
        const t = dnsTypes[type] ?? String(type);
        const value = type === 1 ? r.ip(d) : type === 28 ? r.ip6(d) : [2, 5, 12].includes(type) ? name(d)[0] : type === 15 ? `${r.u16(d)} ${name(d + 2)[0]}` : type === 16 ? r.text(d + 1, r.u8(d)) : type === 6 ? name(d)[0] + ' …' : `${len} bytes`;
        field(l, section, `${n}: type ${t}, TTL ${ttl}, ${value}`, p, d + len - p);
        if (section === 'Answer') answers.push(`${t} ${value}`);
        p = d + len;
      }
    }
    s.protocol = 'DNS';
    s.info = response ? `Standard query response ${hex(id)} ${qtype} ${qname}${rcode ? ` ${rcodes[rcode] ?? rcode}` : ''}${answers.length ? ` ${answers.join(' ')}` : ''}` : `Standard query ${hex(id)} ${qtype} ${qname}`;
  }
}
