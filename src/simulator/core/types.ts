export type DeviceKind = 'pc' | 'server' | 'router' | 'switch' | 'l3switch' | 'firewall' | 'internet';
/** Devices that forward IPv4 packets between interfaces. */
export const forwardingKinds: readonly DeviceKind[] = ['router', 'l3switch', 'firewall', 'internet'];
/** Devices that bridge Ethernet frames between switchports. */
export const switchingKinds: readonly DeviceKind[] = ['switch', 'l3switch'];
export const hostKinds: readonly DeviceKind[] = ['pc', 'server'];

export type InterfaceKind = 'ethernet' | 'subinterface' | 'svi' | 'tunnel' | 'loopback';
export interface Switchport {
  mode: 'access' | 'trunk';
  accessVlan: number;
  /** Trunk allowed list. 'all' = 1-4094. */
  allowedVlans: number[] | 'all';
  nativeVlan: number;
}
export interface TunnelConfig {
  source: string;
  destination: string;
  mode: 'gre' | 'ipsec';
  /** Educational IKE parameters: both ends must match for the SA to come up. */
  psk?: string;
  proposal?: string;
}
export interface NetworkInterface {
  id: string;
  mac: string;
  address?: string;
  up: boolean;
  kind?: InterfaceKind;
  /** Subinterface: physical parent port. */
  parent?: string;
  /** Subinterface 802.1Q tag / SVI VLAN. */
  vlan?: number;
  switchport?: Switchport;
  stpCost?: number;
  nat?: 'inside' | 'outside';
  acl?: { in?: string; out?: string };
  ospfCost?: number;
  tunnel?: TunnelConfig;
  description?: string;
}
export type RouteKind = 'connected' | 'static' | 'ospf' | 'bgp';
export interface Route {
  destination: string;
  nextHop?: string;
  interfaceId?: string;
  preference: number;
  metric: number;
  kind: RouteKind;
  /** Human readable origin (e.g. BGP AS_PATH) for show commands. */
  info?: string;
}
export interface ArpEntry { ip: string; mac: string; interfaceId: string; expiresAt: number }
export interface MacEntry { mac: string; vlan: number; port: string; expiresAt: number }
export interface Vlan { id: number; name: string }

// ---- Filtering (router ACL / firewall / Linux iptables share one rule model) ----
export type FilterProtocol = 'ip' | 'tcp' | 'udp' | 'icmp';
export interface FilterRule {
  seq: number;
  action: 'permit' | 'deny' | 'reject';
  protocol: FilterProtocol;
  source: string;
  destination: string;
  sourcePort?: [number, number];
  destinationPort?: [number, number];
  /** Cisco-style `established`: TCP segments with ACK or RST. Stateless. */
  established?: boolean;
  /** iptables-style conntrack match. */
  ctState?: ('new' | 'established' | 'related')[];
  inInterface?: string;
  outInterface?: string;
  description?: string;
}
export interface Acl { name: string; rules: FilterRule[] }
export interface FirewallPolicy {
  stateful: boolean;
  defaultAction: 'permit' | 'deny';
  rules: FilterRule[];
}
export interface ConnEntry {
  protocol: 'tcp' | 'udp' | 'icmp';
  source: string; sourcePort: number;
  destination: string; destinationPort: number;
  state: 'SYN_SENT' | 'ESTABLISHED' | 'CLOSED' | 'UDP' | 'ICMP';
  expiresAt: number;
}

// ---- NAT ----
export type NatRule =
  | { id: string; type: 'pat'; source: string; outInterface: string }
  | { id: string; type: 'static'; inside: string; outside: string }
  | { id: string; type: 'port-forward'; protocol: 'tcp' | 'udp'; outside: string; outsidePort: number; inside: string; insidePort: number };
export interface NatEntry {
  protocol: 'tcp' | 'udp' | 'icmp';
  insideLocal: string; insideLocalPort: number;
  insideGlobal: string; insideGlobalPort: number;
  outside: string; outsidePort: number;
  rule: string;
  expiresAt: number;
}

// ---- Services ----
export type DnsType = 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'NS' | 'SOA' | 'PTR';
export interface DnsRecord { name: string; type: DnsType; ttl: number; value: string }
export interface DnsZone { origin: string; records: DnsRecord[] }
export interface DnsServerConfig {
  zones: DnsZone[];
  recursive: boolean;
  rootHints: string[];
  /** Clients allowed to use recursion (CIDR). Empty = any. */
  allowRecursion?: string[];
}
export interface DnsCacheEntry {
  name: string; type: DnsType;
  records: DnsRecord[];
  negative?: 'NXDOMAIN' | 'NODATA';
  expiresAt: number;
}
export interface ServiceConfig {
  name: string;
  protocol: 'tcp' | 'udp';
  port: number;
  app: 'http' | 'https' | 'dns' | 'ssh' | 'generic';
  running: boolean;
  /** Listening address. 0.0.0.0 = all addresses. */
  bind: string;
  http?: { status: number; body: string };
  tls?: { names: string[]; expired: boolean; selfSigned: boolean };
}
export interface SocketEntry { protocol: 'tcp' | 'udp'; local: string; remote: string; state: string; expiresAt: number }

// ---- Dynamic routing ----
export interface OspfConfig {
  processId: number;
  routerId?: string;
  networks: { prefix: string; area: number }[];
  passive: string[];
  defaultOriginate?: boolean;
}
export interface BgpNeighbor {
  ip: string;
  remoteAs: number;
  shutdown?: boolean;
  nextHopSelf?: boolean;
  /** Interface whose address sources the session (iBGP over loopbacks). */
  updateSource?: string;
  prefixListIn?: string;
  prefixListOut?: string;
  /** Educational shortcuts for route-map `set` actions. */
  localPreference?: number;
  med?: number;
  prepend?: number;
}
export interface BgpConfig { asn: number; routerId?: string; networks: string[]; neighbors: BgpNeighbor[] }
export interface PrefixListEntry { seq: number; action: 'permit' | 'deny'; prefix: string; ge?: number; le?: number }
export interface PrefixList { name: string; entries: PrefixListEntry[] }

export interface DeviceState {
  id: string;
  kind: DeviceKind;
  interfaces: NetworkInterface[];
  routes: Route[];
  gateway?: string;
  position: { x: number; y: number };
  vlans?: Vlan[];
  stp?: { enabled: boolean; priority: number };
  dnsServers?: string[];
  services?: ServiceConfig[];
  dnsServer?: DnsServerConfig;
  nat?: NatRule[];
  acls?: Acl[];
  firewall?: FirewallPolicy;
  ospf?: OspfConfig;
  bgp?: BgpConfig;
  prefixLists?: PrefixList[];
  // ---- Runtime state: never authoritative, cleared on restore ----
  arp: ArpEntry[];
  macTable?: MacEntry[];
  natTable?: NatEntry[];
  conntrack?: ConnEntry[];
  dnsCache?: DnsCacheEntry[];
  dynamicRoutes?: Route[];
  tunnelStatus?: Record<string, { up: boolean; reason: string }>;
  /** Interfaces whose line protocol is down (no cable, link down, peer port down). */
  lineDown?: string[];
  sockets?: SocketEntry[];
}
export interface Link {
  id: string;
  sourceDevice: string;
  sourceInterface: string;
  targetDevice: string;
  targetInterface: string;
  up: boolean;
  bandwidth: number;
  latency: number;
}
export interface NetworkSnapshot { version: 1; devices: DeviceState[]; links: Link[]; time: number }

// ---- Packets ----
export type IcmpType = 'echo-request' | 'echo-reply' | 'time-exceeded' | 'unreachable';
export type TcpFlag = 'SYN' | 'ACK' | 'FIN' | 'RST' | 'PSH';
interface PacketBase { id: number; source: string; destination: string; ttl: number }
export interface IcmpPacket extends PacketBase {
  protocol: 'ICMP';
  type: IcmpType;
  /** Unreachable: 0 net, 1 host, 3 port, 13 administratively prohibited. */
  code?: number;
  identifier: number;
  sequence: number;
  quote?: number[];
  /** The offending packet for ICMP errors (simulation metadata used by NAT / conntrack). */
  original?: Packet;
}
export interface TcpPacket extends PacketBase {
  protocol: 'TCP';
  sourcePort: number; destinationPort: number;
  flags: TcpFlag[];
  seq: number; ack: number; window: number;
  payload?: AppPayload;
}
export interface UdpPacket extends PacketBase {
  protocol: 'UDP';
  sourcePort: number; destinationPort: number;
  payload?: AppPayload;
}
export interface TunnelPacket extends PacketBase {
  protocol: 'ESP' | 'GRE';
  spi?: number;
  inner: Packet;
}
export type Packet = IcmpPacket | TcpPacket | UdpPacket | TunnelPacket;

export interface DnsQuestion { name: string; type: DnsType }
export interface DnsMessage {
  id: number;
  response: boolean;
  opcode: 0;
  aa: boolean; rd: boolean; ra: boolean;
  rcode: 'NOERROR' | 'NXDOMAIN' | 'SERVFAIL' | 'REFUSED';
  question: DnsQuestion;
  answer: DnsRecord[];
  authority: DnsRecord[];
  additional: DnsRecord[];
}
export type AppPayload =
  | { kind: 'dns'; message: DnsMessage }
  | { kind: 'http'; text: string }
  | { kind: 'tls'; record: 'client-hello' | 'server-hello' | 'encrypted' | 'alert'; sni?: string; detail: string }
  | { kind: 'data'; text: string };

export type EventType = 'PACKET_CREATED' | 'ROUTE_LOOKUP' | 'ARP_LOOKUP' | 'ARP_REQUEST' | 'ARP_REPLY'
  | 'FRAME_SENT' | 'FRAME_RECEIVED' | 'FRAME_DISCARDED' | 'MAC_LEARNED' | 'MAC_LOOKUP' | 'STP_BLOCKED' | 'BROADCAST_STORM'
  | 'TTL_DECREMENTED' | 'NAT_TRANSLATED' | 'FIREWALL_ACCEPT' | 'FIREWALL_DROP'
  | 'TUNNEL_ENCAPSULATED' | 'TUNNEL_DECAPSULATED'
  | 'TCP_STATE' | 'TCP_RETRANSMIT' | 'SOCKET_LOOKUP' | 'DNS_QUERY' | 'DNS_RESPONSE' | 'DNS_CACHE' | 'TLS_HANDSHAKE' | 'APP_DATA'
  | 'PACKET_RECEIVED' | 'PACKET_DROPPED';
export interface SimulationEvent {
  id: number;
  time: number;
  type: EventType;
  deviceId: string;
  message: string;
  packet?: Packet;
  interfaceId?: string;
  linkId?: string;
  sourceMac?: string;
  destinationMac?: string;
  vlan?: number;
  route?: Route;
  captureId?: number;
  /** Matched filter rule / NAT rule description. */
  rule?: string;
  /** Counterpart device or address (DNS server, BGP peer ...). */
  peer?: string;
  before?: string;
  after?: string;
}
export interface CaptureSummary {
  source: string;
  destination: string;
  sourceMac: string;
  destinationMac: string;
  vlan?: number;
  protocol: string;
  info: string;
  ipProtocol?: number;
  sourcePort?: number;
  destinationPort?: number;
  /** Innermost L3 addresses for filters. */
  hosts: string[];
}
export interface Capture extends CaptureSummary {
  id: number;
  time: number;
  deviceId: string;
  interfaceId: string;
  linkId: string;
  bytes: number[];
  packet?: Packet;
}
export interface OperationResult {
  success: boolean;
  reason: string;
  events: SimulationEvent[];
  captures: Capture[];
  elapsed: number;
}
export interface PingResult extends OperationResult { reply?: IcmpPacket }
