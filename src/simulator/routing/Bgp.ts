import type { BgpNeighbor, DeviceState, PrefixList, Route } from '../core/types';
import { cidr, contains, dotted, ipOf, ipv4 } from '../l3/ipv4';

export interface BgpSession {
  device: string; neighbor: string; neighborDevice?: string; localAddress?: string;
  remoteAs: number; type: 'eBGP' | 'iBGP';
  state: 'Established' | 'Idle' | 'Active';
  reason?: string;
  received: number;
}
export interface BgpPath {
  prefix: string;
  nextHop: string;
  asPath: number[];
  localPref: number;
  med: number;
  from: string;
  fromDevice: string;
  type: 'local' | 'eBGP' | 'iBGP';
  peerRouterId: string;
  valid: boolean;
  best?: boolean;
  reason?: string;
}
export interface BgpLog { round: number; from: string; to: string; prefix: string; action: 'advertise' | 'withdraw' | 'reject-loop' | 'filtered-in' | 'filtered-out'; detail: string }
export interface BgpResult { sessions: BgpSession[]; tables: Map<string, BgpPath[]>; routes: Map<string, Route[]>; log: BgpLog[]; rounds: number }
export interface BgpContext {
  /** Device + interface that owns this address (up interfaces only). */
  ownerOf(ip: string): { device: DeviceState } | undefined;
  /** Local source address used to reach `ip` through non-BGP routes, if reachable. */
  sourceFor(device: DeviceState, ip: string, updateSource?: string): string | undefined;
  /** Is `ip` on a directly connected subnet of the device? (eBGP single-hop check) */
  connected(device: DeviceState, ip: string): boolean;
  /** Exact prefix present in the non-BGP routing table (`network` statement requirement). */
  hasRoute(device: DeviceState, prefix: string): boolean;
  nextHopReachable(device: DeviceState, ip: string): boolean;
}

export function prefixListPermits(list: PrefixList | undefined, prefix: string) {
  if (!list) return true;
  const p = cidr(prefix);
  for (const e of [...list.entries].sort((a, b) => a.seq - b.seq)) {
    const range = cidr(e.prefix);
    const lengthOk = e.ge === undefined && e.le === undefined ? p.prefix === range.prefix
      : p.prefix >= (e.ge ?? range.prefix) && p.prefix <= (e.le ?? 32);
    if (p.prefix >= range.prefix && contains(e.prefix, dotted(p.network)) && lengthOk) return e.action === 'permit';
  }
  return false; // implicit deny
}

export function bgpRouterId(d: DeviceState) {
  if (d.bgp?.routerId) return d.bgp.routerId;
  const ips = d.interfaces.filter(i => i.up && i.address);
  const pick = (list: typeof ips) => list.map(i => ipOf(i.address)!).sort((a, b) => ipv4(b) - ipv4(a))[0];
  return pick(ips.filter(i => i.kind === 'loopback')) ?? pick(ips) ?? '0.0.0.0';
}

/** Ordered subset of the BGP decision process. Returns negative when `a` is better, with the deciding reason. */
export function comparePaths(a: BgpPath, b: BgpPath): { order: number; reason: string } {
  if (a.valid !== b.valid) return { order: a.valid ? -1 : 1, reason: 'NEXT_HOPに到達できる経路を優先' };
  if (a.localPref !== b.localPref) return { order: b.localPref - a.localPref, reason: `LOCAL_PREF が大きい（${Math.max(a.localPref, b.localPref)}）` };
  if ((a.type === 'local') !== (b.type === 'local')) return { order: a.type === 'local' ? -1 : 1, reason: '自身が生成した経路を優先' };
  if (a.asPath.length !== b.asPath.length) return { order: a.asPath.length - b.asPath.length, reason: `AS_PATH が短い（${Math.min(a.asPath.length, b.asPath.length)}）` };
  if (a.asPath[0] !== undefined && a.asPath[0] === b.asPath[0] && a.med !== b.med) return { order: a.med - b.med, reason: `同じ隣接ASからの経路で MED が小さい（${Math.min(a.med, b.med)}）` };
  if (a.type !== b.type && (a.type === 'eBGP' || b.type === 'eBGP')) return { order: a.type === 'eBGP' ? -1 : 1, reason: 'eBGP経路をiBGP経路より優先' };
  const rid = ipv4(a.peerRouterId) - ipv4(b.peerRouterId);
  if (rid) return { order: rid, reason: '送信元のRouter IDが小さい' };
  return { order: ipv4(a.from === 'local' ? '0.0.0.0' : a.from) - ipv4(b.from === 'local' ? '0.0.0.0' : b.from), reason: 'ネイバーアドレスが小さい' };
}

/**
 * Educational BGP: sessions are "Established" when configuration matches and the peer address is reachable
 * through non-BGP routes (TCP/179, OPEN, KEEPALIVE and timers are not simulated).
 * Propagation runs in synchronous rounds until no best path changes (convergence).
 */
export function computeBgp(devices: DeviceState[], ctx: BgpContext): BgpResult {
  const speakers = devices.filter(d => d.bgp);
  const byId = new Map(speakers.map(d => [d.id, d]));
  const sessions: BgpSession[] = [];
  const log: BgpLog[] = [];
  for (const d of speakers) for (const n of d.bgp!.neighbors) sessions.push(session(d, n));
  function session(d: DeviceState, n: BgpNeighbor): BgpSession {
    const s: BgpSession = { device: d.id, neighbor: n.ip, remoteAs: n.remoteAs, type: n.remoteAs === d.bgp!.asn ? 'iBGP' : 'eBGP', state: 'Idle', received: 0 };
    if (n.shutdown) return { ...s, reason: 'neighbor shutdown（管理的に停止）' };
    const owner = ctx.ownerOf(n.ip);
    const local = ctx.sourceFor(d, n.ip, n.updateSource);
    if (!local) return { ...s, state: 'Active', reason: `${n.ip} への経路がありません（BGP以外の経路で到達できる必要があります）` };
    s.localAddress = local;
    if (s.type === 'eBGP' && !ctx.connected(d, n.ip)) return { ...s, state: 'Active', reason: 'eBGPネイバーが直結されていません（このシミュレータは ebgp-multihop 未対応。直結したインターフェースのアドレスを neighbor に指定します）' };
    if (!owner) return { ...s, state: 'Active', reason: `${n.ip} を持つ機器が応答しません` };
    const peer = byId.get(owner.device.id);
    s.neighborDevice = owner.device.id;
    if (!peer) return { ...s, state: 'Active', reason: `${owner.device.id} でBGPが設定されていません` };
    const back = peer.bgp!.neighbors.find(x => x.ip === local);
    if (!back) return { ...s, state: 'Active', reason: `${peer.id} に neighbor ${local} の設定がありません（相手が neighbor に指定したアドレスと、こちらの送信元アドレスが違う可能性。update-source を確認します）` };
    if (back.shutdown) return { ...s, state: 'Idle', reason: `${peer.id} 側で neighbor shutdown` };
    if (n.remoteAs !== peer.bgp!.asn) return { ...s, reason: `remote-as 不一致: 設定 ${n.remoteAs} / 相手のAS ${peer.bgp!.asn}（OPENメッセージで拒否）` };
    if (back.remoteAs !== d.bgp!.asn) return { ...s, reason: `相手側の remote-as ${back.remoteAs} が自AS ${d.bgp!.asn} と一致しません` };
    if (!ctx.sourceFor(peer, local, back.updateSource)) return { ...s, state: 'Active', reason: `${peer.id} から ${local} へ戻る経路がありません` };
    return { ...s, state: 'Established' };
  }
  const established = sessions.filter(s => s.state === 'Established');
  const peerSession = (s: BgpSession) => established.find(x => x.device === s.neighborDevice && x.neighbor === s.localAddress);
  const local = new Map<string, BgpPath[]>();
  for (const d of speakers) {
    local.set(d.id, d.bgp!.networks.filter(p => ctx.hasRoute(d, p)).map(prefix => ({
      prefix, nextHop: '0.0.0.0', asPath: [], localPref: 100, med: 0, from: 'local', fromDevice: d.id, type: 'local', peerRouterId: bgpRouterId(d), valid: true,
    })));
  }
  // adjRibIn[device][neighbor ip] = paths received from that neighbor
  const adjIn = new Map<string, Map<string, BgpPath[]>>(speakers.map(d => [d.id, new Map()]));
  const best = new Map<string, Map<string, BgpPath>>(speakers.map(d => [d.id, new Map()]));
  const select = (d: DeviceState) => {
    const all = [...local.get(d.id)!, ...[...adjIn.get(d.id)!.values()].flat()];
    const next = new Map<string, BgpPath>();
    for (const prefix of new Set(all.map(p => p.prefix))) {
      const candidates = all.filter(p => p.prefix === prefix);
      candidates.forEach(p => { p.best = false; p.reason = undefined; });
      const sorted = [...candidates].sort((a, b) => comparePaths(a, b).order);
      const winner = sorted[0];
      if (!winner.valid) continue;
      winner.best = true;
      winner.reason = sorted.length > 1 ? comparePaths(winner, sorted[1]).reason : '唯一の経路';
      for (const loser of sorted.slice(1)) loser.reason = comparePaths(winner, loser).reason;
      next.set(prefix, winner);
    }
    return next;
  };
  for (const d of speakers) best.set(d.id, select(d));
  const signature = (m: Map<string, BgpPath>) => [...m.values()].map(p => `${p.prefix}|${p.from}|${p.asPath.join(' ')}|${p.localPref}|${p.med}|${p.nextHop}`).sort().join(';');
  let rounds = 0;
  for (let round = 1; round <= 50; round++) {
    const exports: { to: DeviceState; from: BgpSession; paths: BgpPath[] }[] = [];
    for (const s of established) {
      const d = byId.get(s.device)!; const to = byId.get(s.neighborDevice!)!;
      const n = d.bgp!.neighbors.find(x => x.ip === s.neighbor)!;
      const outList = d.prefixLists?.find(l => l.name === n.prefixListOut);
      const paths: BgpPath[] = [];
      for (const p of best.get(d.id)!.values()) {
        if (p.type === 'iBGP' && s.type === 'iBGP') continue; // iBGP split horizon
        if (n.prefixListOut && !prefixListPermits(outList, p.prefix)) {
          log.push({ round, from: d.id, to: to.id, prefix: p.prefix, action: 'filtered-out', detail: `prefix-list ${n.prefixListOut} (out) で拒否` }); continue;
        }
        const ebgp = s.type === 'eBGP';
        paths.push({
          prefix: p.prefix,
          nextHop: ebgp || n.nextHopSelf || p.type === 'local' ? s.localAddress! : p.nextHop,
          asPath: ebgp ? [...Array(1 + (n.prepend ?? 0)).fill(d.bgp!.asn), ...p.asPath] : p.asPath,
          localPref: ebgp ? 100 : p.localPref,
          med: ebgp ? n.med ?? 0 : p.med,
          from: s.localAddress!, fromDevice: d.id, type: s.type, peerRouterId: bgpRouterId(d), valid: true,
        });
      }
      exports.push({ to, from: s, paths });
    }
    for (const { to, from, paths } of exports) {
      const back = peerSession(from)!;
      const n = to.bgp!.neighbors.find(x => x.ip === back.neighbor)!;
      const inList = to.prefixLists?.find(l => l.name === n.prefixListIn);
      const accepted: BgpPath[] = [];
      for (const p of paths) {
        if (from.type === 'eBGP' && p.asPath.includes(to.bgp!.asn)) {
          log.push({ round, from: from.device, to: to.id, prefix: p.prefix, action: 'reject-loop', detail: `AS_PATH [${p.asPath.join(' ')}] に自AS ${to.bgp!.asn} が含まれるため破棄（ループ防止）` }); continue;
        }
        if (n.prefixListIn && !prefixListPermits(inList, p.prefix)) {
          log.push({ round, from: from.device, to: to.id, prefix: p.prefix, action: 'filtered-in', detail: `prefix-list ${n.prefixListIn} (in) で拒否` }); continue;
        }
        const path = { ...p, localPref: n.localPreference ?? p.localPref, valid: ctx.nextHopReachable(to, p.nextHop) };
        accepted.push(path);
      }
      const previous = adjIn.get(to.id)!.get(back.neighbor) ?? [];
      const key = (p: BgpPath) => `${p.prefix}|${p.asPath.join(' ')}|${p.nextHop}|${p.localPref}|${p.med}`;
      for (const p of accepted) if (!previous.some(q => key(q) === key(p))) log.push({ round, from: from.device, to: to.id, prefix: p.prefix, action: 'advertise', detail: `UPDATE: AS_PATH [${p.asPath.join(' ') || '(空)'}] NEXT_HOP ${p.nextHop}` });
      for (const q of previous) if (!accepted.some(p => p.prefix === q.prefix)) log.push({ round, from: from.device, to: to.id, prefix: q.prefix, action: 'withdraw', detail: 'WITHDRAW' });
      adjIn.get(to.id)!.set(back.neighbor, accepted);
    }
    let changed = false;
    for (const d of speakers) {
      const next = select(d);
      if (signature(next) !== signature(best.get(d.id)!)) changed = true;
      best.set(d.id, next);
    }
    rounds = round;
    if (!changed) break;
  }
  const tables = new Map<string, BgpPath[]>();
  const routes = new Map<string, Route[]>();
  for (const d of speakers) {
    const all = [...local.get(d.id)!, ...[...adjIn.get(d.id)!.values()].flat()];
    select(d);
    tables.set(d.id, all);
    routes.set(d.id, [...best.get(d.id)!.values()].filter(p => p.type !== 'local').map(p => ({
      destination: p.prefix, nextHop: p.nextHop, preference: p.type === 'eBGP' ? 20 : 200, metric: p.med, kind: 'bgp' as const,
      info: `${p.type} AS_PATH ${p.asPath.join(' ') || 'i'} LP ${p.localPref}`,
    })));
  }
  for (const s of sessions) s.received = [...(adjIn.get(s.device)?.get(s.neighbor) ?? [])].length;
  return { sessions, tables, routes, log, rounds };
}
