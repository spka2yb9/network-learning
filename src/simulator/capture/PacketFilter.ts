import type { CaptureSummary } from '../core/types';
import { contains, cidr, ipv4 } from '../l3/ipv4';

type Row = CaptureSummary & { interfaceId?: string };
type Predicate = (c: Row) => boolean;

const protocols: Record<string, Predicate> = {
  arp: c => c.protocol === 'ARP',
  ip: c => c.ipProtocol !== undefined && !c.source.includes(':'),
  ip6: c => c.source.includes(':'),
  icmp: c => c.ipProtocol === 1,
  tcp: c => c.ipProtocol === 6,
  udp: c => c.ipProtocol === 17,
  gre: c => c.ipProtocol === 47,
  esp: c => c.ipProtocol === 50,
  // Display-filter style extensions (not BPF): decoded application protocol.
  dns: c => c.protocol === 'DNS',
  http: c => c.protocol === 'HTTP',
  tls: c => c.protocol === 'TLS',
};
const HELP = '対応フィルタ: tcp / udp / icmp / arp / ip / dns / http / tls / esp / gre, [src|dst] host <IP>, [src|dst] net <CIDR>, [src|dst] port <n>, vlan <id>, ether host <MAC>, -i <IF>, and / or / not, ( )';

/**
 * Educational BPF-like subset (tcpdump primitives + and/or/not/parentheses).
 * Unsupported expressions throw instead of silently matching everything.
 */
export function packetFilter(input: string): (capture: Row) => boolean {
  const tokens = input.trim().toLowerCase().replace(/([()!])/g, ' $1 ').replace(/&&/g, ' and ').replace(/\|\|/g, ' or ').split(/\s+/).filter(Boolean);
  if (!tokens.length) return () => true;
  let i = 0;
  const peek = () => tokens[i];
  const next = () => { const t = tokens[i++]; if (t === undefined) throw new Error(`条件が途中で終わっています。${HELP}`); return t; };
  // pcap-filter: `and` and `or` have equal precedence and associate left to right (`a or b and c` = `(a or b) and c`).
  function expr(): Predicate {
    let left = not();
    while (peek() === 'and' || peek() === 'or') { const op = next(); const a = left; const b = not(); left = op === 'and' ? c => a(c) && b(c) : c => a(c) || b(c); }
    return left;
  }
  function not(): Predicate {
    if (peek() === 'not' || peek() === '!') { i++; const p = not(); return c => !p(c); }
    return primary();
  }
  function primary(): Predicate {
    const t = next();
    if (t === '(') { const p = expr(); if (next() !== ')') throw new Error('括弧が閉じていません'); return p; }
    // BPF protocol qualifier: "tcp port 80", "udp src port 53", "arp host 10.0.0.1".
    if (protocols[t] && ['src', 'dst', 'host', 'net', 'port'].includes(peek())) { const proto = protocols[t]; const rest = primary(); return c => proto(c) && rest(c); }
    if (protocols[t]) return protocols[t];
    let dir: 'src' | 'dst' | undefined;
    let word = t;
    if (word === 'src' || word === 'dst') { dir = word; word = next(); }
    if (word === 'host') {
      const ip = next(); ipv4(ip);
      if (dir === 'src') return c => c.source === ip;
      if (dir === 'dst') return c => c.destination === ip;
      return c => c.hosts.includes(ip) || c.source === ip || c.destination === ip;
    }
    if (word === 'net') {
      const range = cidr(next()).canonical;
      const inNet = (ip: string) => !!ip && !ip.includes(':') && contains(range, ip);
      if (dir === 'src') return c => inNet(c.source);
      if (dir === 'dst') return c => inNet(c.destination);
      return c => inNet(c.source) || inNet(c.destination);
    }
    if (word === 'port') {
      const port = Number(next());
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('port は 0〜65535 です');
      if (dir === 'src') return c => c.sourcePort === port;
      if (dir === 'dst') return c => c.destinationPort === port;
      return c => c.sourcePort === port || c.destinationPort === port;
    }
    if (dir) throw new Error(`src / dst の後には host / net / port が必要です。${HELP}`);
    if (word === 'vlan') { const id = Number(next()); if (!Number.isInteger(id) || id < 1 || id > 4094) throw new Error('VLAN IDは1〜4094です'); return c => c.vlan === id; }
    if (word === 'ether') {
      if (next() !== 'host') throw new Error('ether host <MAC> の形式です');
      const mac = next();
      if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac)) throw new Error('MACアドレスは aa:bb:cc:dd:ee:ff の形式です');
      return c => c.sourceMac === mac || c.destinationMac === mac;
    }
    if (word === '-i') { const iface = next(); return c => (c.interfaceId ?? '').toLowerCase() === iface; }
    throw new Error(`解釈できない条件 "${word}" です。${HELP}`);
  }
  const predicate = expr();
  if (i < tokens.length) throw new Error(`条件は and / or で結合してください（"${tokens[i]}" の前）`);
  return predicate;
}
