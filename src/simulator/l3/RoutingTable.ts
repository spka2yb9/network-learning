import { forwardingKinds, type DeviceState, type NetworkInterface, type Route } from '../core/types';
import { cidr, contains, dotted } from './ipv4';

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
 */
function egress(device: DeviceState, table: Route[], route: Route, nextHop: string, path: Route[] = []): { iface: NetworkInterface; nextHop: string } | undefined {
  if (path.includes(route) || path.length > 8) return undefined;
  if (route.nextHop) nextHop = route.nextHop;
  if (route.interfaceId) {
    const iface = device.interfaces.find(i => i.id === route.interfaceId && l3Up(device, i));
    // On-link check. Tunnels are point-to-point: any next hop is reachable through them.
    return iface && (iface.kind === 'tunnel' || contains(iface.address!, nextHop)) ? { iface, nextHop } : undefined;
  }
  if (!route.nextHop) return undefined;
  for (const r of ranked(table, nextHop)) { const e = egress(device, table, r, nextHop, [...path, route]); if (e) return e; }
  return undefined;
}
/** Routes that win route selection per prefix (lowest preference, then metric) among usable ones — what `show ip route` lists. */
export function installedRoutes(device: DeviceState) {
  const table = routingTable(device);
  // Interface routes are installed while the interface is up (as on IOS); next-hop routes only when the next hop resolves.
  const all = table.filter(r => r.preference < 255 && (r.interfaceId ? device.interfaces.some(i => i.id === r.interfaceId && l3Up(device, i)) : egress(device, table, r, dotted(cidr(r.destination).network))));
  return all.filter(r => !all.some(o => o !== r && o.destination === r.destination && (o.preference < r.preference || (o.preference === r.preference && o.metric < r.metric))));
}

export function resolveRoute(device: DeviceState, destination: string, options: { dynamic?: boolean } = {}) {
  const table = routingTable(device, options);
  for (const route of ranked(table, destination)) { const e = egress(device, table, route, destination); if (e) return { route, ...e }; }
  return undefined;
}
