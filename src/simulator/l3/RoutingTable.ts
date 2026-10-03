import { forwardingKinds, type DeviceState, type NetworkInterface, type PathChoice, type Route } from '../core/types';
import { flowHash, flowText, type FlowKey } from '../core/flow';
import { cidr, contains, dotted, ipv4 } from './ipv4';

/** Interface usable for L3: administratively up, addressed, and (for tunnels) the SA is up. */
export function l3Up(device: DeviceState, iface: NetworkInterface) {
  if (!iface.up || !iface.address) return false;
  if (device.lineDown?.includes(iface.parent ?? iface.id)) return false;
  if (iface.kind === 'tunnel') return device.tunnelStatus?.[iface.id]?.up ?? false;
  if (iface.kind === 'subinterface') return device.interfaces.find(i => i.id === iface.parent)?.up ?? false;
  return true;
}
export function routingTable(device: DeviceState, options: { dynamic?: boolean } = {}): Route[] {
  const connected: Route[] = device.interfaces.filter(i => l3Up(device, i)).map(i => ({
    destination: cidr(i.address!).canonical, interfaceId: i.id, preference: 0, metric: 0, kind: 'connected',
  }));
  const gateway: Route[] = !forwardingKinds.includes(device.kind) && device.gateway ? [{
    destination: '0.0.0.0/0', nextHop: device.gateway, preference: 1, metric: 0, kind: 'static',
  }] : [];
  return [...connected, ...device.routes, ...gateway, ...(options.dynamic === false ? [] : device.dynamicRoutes ?? [])];
}
/** Candidates in route-selection order: longest prefix → AD → metric. AD 255 is never installed (IOS). */
const ranked = (routes: Route[], destination: string) => routes.filter(r => r.preference < 255 && contains(r.destination, destination)).sort((a, b) =>
  cidr(b.destination).prefix - cidr(a.destination).prefix || a.preference - b.preference || a.metric - b.metric);
export function longestPrefixMatch(routes: Route[], destination: string) { return ranked(routes, destination)[0]; }
/**
 * Egress for one route: its interface (on-link check), or recursive lookup of its next hop.
 * A next hop that does not resolve makes the route unusable, so lookups fall back to the next candidate.
 * `seen` spans the whole lookup: a recursive route is expanded once (a revisit is a loop or an already-failed branch).
 */
function egress(device: DeviceState, table: Route[], route: Route, nextHop: string, seen = new Set<Route>()): { iface: NetworkInterface; nextHop: string } | undefined {
  if (route.nextHop) nextHop = route.nextHop;
  if (route.interfaceId) {
    const iface = device.interfaces.find(i => i.id === route.interfaceId && l3Up(device, i));
    // On-link check for a next hop. Interface-only routes ARP the destination itself; tunnels are point-to-point.
    return iface && (iface.kind === 'tunnel' || !route.nextHop || contains(iface.address!, nextHop)) ? { iface, nextHop } : undefined;
  }
  if (!route.nextHop || seen.has(route)) return undefined;
  seen.add(route);
  for (const r of ranked(table, nextHop)) { const e = egress(device, table, r, nextHop, seen); if (e) return e; }
  return undefined;
}
/** Routes that win route selection per prefix (lowest preference, then metric) among usable ones — what `show ip route` lists. */
export function installedRoutes(device: DeviceState) {
  const table = routingTable(device);
  // Interface routes are installed while the interface is up (as on IOS); next-hop routes only when the next hop resolves.
  const all = table.filter(r => r.preference < 255 && (r.interfaceId ? device.interfaces.some(i => i.id === r.interfaceId && l3Up(device, i)) : egress(device, table, r, dotted(cidr(r.destination).network))));
  return all.filter(r => !all.some(o => o !== r && o.destination === r.destination && (o.preference < r.preference || (o.preference === r.preference && o.metric < r.metric))));
}

type Path = { route: Route; iface: NetworkInterface; nextHop: string };
/**
 * Route selection with ECMP: the best usable route plus every other usable route with the same prefix, AD and
 * metric. Paths are ordered by next hop; with a `flow`, its hash picks one (per-flow load balancing: the same
 * 5-tuple always takes the same path). Without a flow the first path is returned.
 */
export function resolveRoute(device: DeviceState, destination: string, options: { dynamic?: boolean; flow?: FlowKey } = {}): (Path & { ecmp?: { paths: Path[]; choice: PathChoice } }) | undefined {
  const table = routingTable(device, options);
  const list = ranked(table, destination);
  for (let i = 0; i < list.length; i++) {
    const first = egress(device, table, list[i], destination);
    if (!first) continue;
    const best = list[i];
    const paths: Path[] = [{ route: best, ...first }];
    for (const r of list.slice(i + 1)) {
      if (r.destination !== best.destination || r.preference !== best.preference || r.metric !== best.metric) break;
      const e = egress(device, table, r, destination);
      if (e && !paths.some(p => p.nextHop === e.nextHop && p.iface.id === e.iface.id)) paths.push({ route: r, ...e });
    }
    paths.sort((a, b) => ipv4(a.nextHop) - ipv4(b.nextHop) || a.iface.id.localeCompare(b.iface.id));
    if (paths.length === 1) return paths[0];
    const input = options.flow ? flowText(options.flow) : '';
    const hash = input ? flowHash(input) : 0;
    const chosen = hash % paths.length;
    return { ...paths[chosen], ecmp: { paths, choice: { kind: 'ecmp', candidates: paths.map(p => `via ${p.nextHop}（${p.iface.id}）`), chosen, input, hash } } };
  }
  return undefined;
}
