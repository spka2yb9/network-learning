import type { FilterProtocol, FilterRule, Packet } from '../core/types';
import { cidr, contains, ipv4 } from '../l3/ipv4';

export interface FlowKey { protocol: 'tcp' | 'udp' | 'icmp'; source: string; sourcePort: number; destination: string; destinationPort: number }
export type CtState = 'new' | 'established' | 'related' | 'invalid';
export interface MatchContext { inInterface?: string; outInterface?: string; ctState?: CtState }
export interface FilterDecision { action: 'permit' | 'deny' | 'reject'; rule?: FilterRule; text: string }

const ANY = '0.0.0.0/0';
/** 5-tuple used by conntrack / NAT. ICMP echo uses the identifier in place of ports. */
export function flowKey(packet: Packet): FlowKey | undefined {
  if (packet.protocol === 'TCP' || packet.protocol === 'UDP') return { protocol: packet.protocol === 'TCP' ? 'tcp' : 'udp', source: packet.source, sourcePort: packet.sourcePort, destination: packet.destination, destinationPort: packet.destinationPort };
  if (packet.protocol === 'ICMP' && (packet.type === 'echo-request' || packet.type === 'echo-reply')) {
    return { protocol: 'icmp', source: packet.source, sourcePort: packet.identifier, destination: packet.destination, destinationPort: packet.identifier };
  }
  return undefined;
}
export const reverseFlow = (f: FlowKey): FlowKey => ({ protocol: f.protocol, source: f.destination, sourcePort: f.destinationPort, destination: f.source, destinationPort: f.sourcePort });
export const sameFlow = (a: FlowKey, b: FlowKey) => a.protocol === b.protocol && a.source === b.source && a.destination === b.destination && a.sourcePort === b.sourcePort && a.destinationPort === b.destinationPort;

const packetProtocol = (p: Packet): FilterProtocol | undefined => p.protocol === 'TCP' ? 'tcp' : p.protocol === 'UDP' ? 'udp' : p.protocol === 'ICMP' ? 'icmp' : undefined;
const inRange = (port: number | undefined, range?: [number, number]) => !range || (port !== undefined && port >= range[0] && port <= range[1]);

export function ruleMatches(rule: FilterRule, packet: Packet, ctx: MatchContext = {}) {
  const proto = packetProtocol(packet);
  if (rule.protocol !== 'ip' && rule.protocol !== proto) return false;
  if (!contains(rule.source, packet.source) || !contains(rule.destination, packet.destination)) return false;
  const l4 = packet.protocol === 'TCP' || packet.protocol === 'UDP' ? packet : undefined;
  if (!inRange(l4?.sourcePort, rule.sourcePort) || !inRange(l4?.destinationPort, rule.destinationPort)) return false;
  if (rule.established && !(packet.protocol === 'TCP' && (packet.flags.includes('ACK') || packet.flags.includes('RST')))) return false;
  if (rule.ctState && !(ctx.ctState && ctx.ctState !== 'invalid' && rule.ctState.includes(ctx.ctState))) return false;
  if (rule.inInterface && rule.inInterface !== ctx.inInterface) return false;
  if (rule.outInterface && rule.outInterface !== ctx.outInterface) return false;
  return true;
}
/** First match wins. Rules are evaluated in ascending sequence number. */
export function evaluateRules(rules: FilterRule[], defaultAction: 'permit' | 'deny', packet: Packet, ctx: MatchContext = {}, defaultText = '暗黙のルール'): FilterDecision {
  const rule = [...rules].sort((a, b) => a.seq - b.seq).find(r => ruleMatches(r, packet, ctx));
  if (rule) return { action: rule.action, rule, text: formatRule(rule) };
  return { action: defaultAction, text: `${defaultText}: ${defaultAction === 'permit' ? 'permit any' : 'deny any'}` };
}

const endpoint = (range: string) => range === ANY ? 'any' : range.endsWith('/32') ? `host ${range.slice(0, -3)}` : range;
const ports = (r?: [number, number]) => !r ? '' : r[0] === r[1] ? ` eq ${r[0]}` : ` range ${r[0]} ${r[1]}`;
/** Educational ACL syntax: Cisco-like keywords, CIDR instead of wildcard masks. */
export function formatRule(r: FilterRule) {
  return `${r.seq} ${r.action} ${r.protocol} ${endpoint(r.source)}${ports(r.sourcePort)} ${endpoint(r.destination)}${ports(r.destinationPort)}`
    + `${r.established ? ' established' : ''}${r.ctState ? ` ctstate ${r.ctState.join(',').toUpperCase()}` : ''}`
    + `${r.inInterface ? ` in ${r.inInterface}` : ''}${r.outInterface ? ` out ${r.outInterface}` : ''}`;
}
export function formatIptables(r: FilterRule, chain = 'INPUT') {
  const parts = [`-A ${chain}`];
  if (r.protocol !== 'ip') parts.push(`-p ${r.protocol}`);
  if (r.source !== ANY) parts.push(`-s ${r.source}`);
  if (r.destination !== ANY) parts.push(`-d ${r.destination}`);
  if (r.inInterface) parts.push(`-i ${r.inInterface}`);
  if (r.sourcePort) parts.push(`--sport ${r.sourcePort[0] === r.sourcePort[1] ? r.sourcePort[0] : r.sourcePort.join(':')}`);
  if (r.destinationPort) parts.push(`--dport ${r.destinationPort[0] === r.destinationPort[1] ? r.destinationPort[0] : r.destinationPort.join(':')}`);
  if (r.ctState) parts.push(`-m conntrack --ctstate ${r.ctState.join(',').toUpperCase()}`);
  parts.push(`-j ${r.action === 'permit' ? 'ACCEPT' : r.action === 'deny' ? 'DROP' : 'REJECT'}`);
  return parts.join(' ');
}

function parseEndpoint(tokens: string[]): string {
  const t = tokens.shift();
  if (t === 'any') return ANY;
  if (t === 'host') { const ip = tokens.shift() ?? ''; ipv4(ip); return `${ip}/32`; }
  if (t && t.includes('/')) return cidr(t).canonical;
  throw new Error(`送信元/宛先は any / host <IPv4> / <CIDR> で指定します（"${t ?? ''}"）`);
}
function parsePort(tokens: string[]): [number, number] | undefined {
  const port = (s?: string) => { const n = Number(s); if (!Number.isInteger(n) || n < 0 || n > 65535) throw new Error(`ポート番号が不正です: ${s}`); return n; };
  if (tokens[0] === 'eq') { tokens.shift(); const n = port(tokens.shift()); return [n, n]; }
  if (tokens[0] === 'range') { tokens.shift(); const a = port(tokens.shift()); const b = port(tokens.shift()); if (b < a) throw new Error('rangeは小さい順です'); return [a, b]; }
  if (tokens[0] === 'gt') { tokens.shift(); return [port(tokens.shift()) + 1, 65535]; }
  if (tokens[0] === 'lt') { tokens.shift(); return [0, port(tokens.shift()) - 1]; }
  return undefined;
}
/** Parse "permit tcp any host 10.0.0.10 eq 80 [established] [in g0/0] [out g0/1]". */
export function parseRule(seq: number, input: string[]): FilterRule {
  const tokens = [...input];
  const action = tokens.shift();
  if (action !== 'permit' && action !== 'deny' && action !== 'reject') throw new Error('permit / deny / reject のいずれかで始めてください');
  const protocol = tokens.shift() as FilterProtocol;
  if (!['ip', 'tcp', 'udp', 'icmp'].includes(protocol)) throw new Error('プロトコルは ip / tcp / udp / icmp です');
  const rule: FilterRule = { seq, action, protocol, source: parseEndpoint(tokens), destination: ANY };
  const sp = parsePort(tokens);
  rule.destination = parseEndpoint(tokens);
  const dp = parsePort(tokens);
  if ((sp || dp) && protocol !== 'tcp' && protocol !== 'udp') throw new Error('ポート条件は tcp / udp でのみ指定できます');
  if (sp) rule.sourcePort = sp;
  if (dp) rule.destinationPort = dp;
  while (tokens.length) {
    const t = tokens.shift();
    if (t === 'established' && protocol === 'tcp') rule.established = true;
    else if (t === 'ctstate') rule.ctState = (tokens.shift() ?? '').toLowerCase().split(',').map(s => {
      if (s !== 'new' && s !== 'established' && s !== 'related') throw new Error('ctstate は NEW / ESTABLISHED / RELATED です');
      return s;
    });
    else if (t === 'in') rule.inInterface = tokens.shift();
    else if (t === 'out') rule.outInterface = tokens.shift();
    else throw new Error(`解釈できない条件です: ${t}`);
  }
  return rule;
}
