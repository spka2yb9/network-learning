import type { DeviceState, NetworkInterface, Route } from '../core/types';
import { cidr, contains, ipOf, ipv4 } from '../l3/ipv4';
import { l3Up } from '../l3/RoutingTable';

export interface OspfNeighbor { device: string; interfaceId: string; neighborId: string; neighborDevice: string; address: string; area: number; state: 'FULL' }
export type LsaLink = { type: 'router'; neighborId: string; cost: number; interfaceId: string; address: string } | { type: 'stub'; prefix: string; cost: number };
export interface RouterLsa { routerId: string; device: string; areas: number[]; links: LsaLink[]; external: string[] }
export interface SpfEntry { routerId: string; device: string; cost: number; path: string[] }
export interface OspfResult {
  neighbors: OspfNeighbor[];
  lsdb: RouterLsa[];
  spf: Map<string, SpfEntry[]>;
  routes: Map<string, Route[]>;
  issues: { device: string; message: string }[];
}
export type SegmentPeers = (device: DeviceState, iface: NetworkInterface) => { device: DeviceState; iface: NetworkInterface }[];

export function routerId(d: DeviceState) {
  if (d.ospf?.routerId) return d.ospf.routerId;
  const pick = (list: NetworkInterface[]) => list.map(i => ipOf(i.address)!).sort((a, b) => ipv4(b) - ipv4(a))[0];
  const withIp = d.interfaces.filter(i => i.up && i.address);
  return pick(withIp.filter(i => i.kind === 'loopback')) ?? pick(withIp) ?? '0.0.0.0';
}
/** Interface participates when its line protocol is up and a `network <CIDR> area <n>` statement contains its address (most specific statement wins). */
export function ospfArea(d: DeviceState, iface: NetworkInterface) {
  if (!d.ospf || !l3Up(d, iface)) return undefined;
  const ip = ipOf(iface.address)!;
  return d.ospf.networks.filter(n => contains(n.prefix, ip)).sort((a, b) => cidr(b.prefix).prefix - cidr(a.prefix).prefix)[0]?.area;
}

/**
 * Educational link-state routing (OSPF-like).
 * Simplified: no Hello/Dead timers or DR/BDR/Network LSAs; adjacent routers are linked directly.
 * Areas restrict adjacencies; inter-area paths are computed by one SPF through ABRs (no Summary LSAs / aggregation).
 */
export function computeOspf(devices: DeviceState[], segmentPeers: SegmentPeers, linkCost: (d: DeviceState, i: NetworkInterface) => number): OspfResult {
  const result: OspfResult = { neighbors: [], lsdb: [], spf: new Map(), routes: new Map(), issues: [] };
  const speakers = devices.filter(d => d.ospf);
  const rid = new Map(speakers.map(d => [d.id, routerId(d)]));
  const seen = new Map<string, string>();
  for (const d of speakers) {
    const r = rid.get(d.id)!;
    if (seen.has(r)) result.issues.push({ device: d.id, message: `Router ID ${r} が ${seen.get(r)} と重複しています（router-id で機器ごとに別の値にします）` });
    seen.set(r, d.id);
  }
  for (const d of speakers) {
    const lsa: RouterLsa = { routerId: rid.get(d.id)!, device: d.id, areas: [], links: [], external: [] };
    for (const iface of d.interfaces) {
      const area = ospfArea(d, iface);
      if (area === undefined) continue;
      if (!lsa.areas.includes(area)) lsa.areas.push(area);
      const cost = linkCost(d, iface);
      const prefix = iface.kind === 'loopback' ? `${ipOf(iface.address)}/32` : cidr(iface.address!).canonical;
      lsa.links.push({ type: 'stub', prefix, cost });
      if (d.ospf!.passive.includes(iface.id) || iface.kind === 'loopback') continue;
      for (const peer of segmentPeers(d, iface)) {
        if (!peer.device.ospf || peer.device.id === d.id) continue;
        const peerArea = ospfArea(peer.device, peer.iface);
        if (peerArea === undefined || peer.device.ospf.passive.includes(peer.iface.id)) continue;
        if (cidr(peer.iface.address!).canonical !== cidr(iface.address!).canonical) {
          result.issues.push({ device: d.id, message: `${iface.id}: ${peer.device.id} とサブネット/マスクが一致しないため隣接（ネイバー）になりません。両側の ip address（ネットワークとマスク）を確認します` });
          continue;
        }
        if (peerArea !== area) {
          result.issues.push({ device: d.id, message: `${iface.id}: ${peer.device.id} とエリア番号が異なります（${area} ≠ ${peerArea}）。隣接（ネイバー）になりません。両側の network ... area の番号をそろえます` });
          continue;
        }
        if (rid.get(peer.device.id) === lsa.routerId) continue;
        result.neighbors.push({ device: d.id, interfaceId: iface.id, neighborId: rid.get(peer.device.id)!, neighborDevice: peer.device.id, address: ipOf(peer.iface.address)!, area, state: 'FULL' });
        lsa.links.push({ type: 'router', neighborId: rid.get(peer.device.id)!, cost, interfaceId: iface.id, address: ipOf(peer.iface.address)! });
      }
    }
    if (d.ospf!.defaultOriginate && d.routes.some(r => r.destination === '0.0.0.0/0')) lsa.external.push('0.0.0.0/0');
    result.lsdb.push(lsa);
  }
  const byRid = new Map(result.lsdb.map(l => [l.routerId, l]));
  // A link is usable only when both ends list each other (two-way check).
  const edges = (l: RouterLsa) => l.links.filter((x): x is Extract<LsaLink, { type: 'router' }> => x.type === 'router' && !!byRid.get(x.neighborId)?.links.some(y => y.type === 'router' && y.neighborId === l.routerId));
  for (const self of result.lsdb) {
    const dist = new Map<string, { cost: number; first?: Extract<LsaLink, { type: 'router' }>; path: string[] }>([[self.routerId, { cost: 0, path: [self.device] }]]);
    const done = new Set<string>();
    while (true) {
      const next = [...dist.entries()].filter(([r]) => !done.has(r)).sort((a, b) => a[1].cost - b[1].cost || a[0].localeCompare(b[0]))[0];
      if (!next) break;
      const [r, info] = next; done.add(r);
      const lsa = byRid.get(r); if (!lsa) continue;
      for (const e of edges(lsa)) {
        const cost = info.cost + e.cost;
        const old = dist.get(e.neighborId);
        if (!old || cost < old.cost) dist.set(e.neighborId, { cost, first: info.first ?? e, path: [...info.path, byRid.get(e.neighborId)!.device] });
      }
    }
    result.spf.set(self.device, [...dist.entries()].map(([r, v]) => ({ routerId: r, device: byRid.get(r)!.device, cost: v.cost, path: v.path })));
    const own = new Set(self.links.filter(l => l.type === 'stub').map(l => (l as { prefix: string }).prefix));
    const best = new Map<string, Route>();
    for (const [r, v] of dist) {
      if (r === self.routerId || !v.first) continue;
      const lsa = byRid.get(r)!;
      const candidates = [...lsa.links.filter((l): l is Extract<LsaLink, { type: 'stub' }> => l.type === 'stub').map(l => ({ prefix: l.prefix, cost: v.cost + l.cost, info: 'O' })),
        ...lsa.external.map(prefix => ({ prefix, cost: 1, info: 'O*E2' }))];
      for (const c of candidates) {
        if (own.has(c.prefix)) continue;
        const old = best.get(c.prefix);
        if (!old || c.cost < old.metric || (c.cost === old.metric && ipv4(v.first.address) < ipv4(old.nextHop!))) {
          best.set(c.prefix, { destination: c.prefix, nextHop: v.first.address, interfaceId: v.first.interfaceId, preference: 110, metric: c.cost, kind: 'ospf', info: `${c.info} via ${lsa.device}` });
        }
      }
    }
    result.routes.set(self.device, [...best.values()]);
  }
  return result;
}
