import {
  forwardingKinds, hostKinds, switchingKinds,
  type AppPayload, type ArpEntry, type Capture, type DeviceKind, type DeviceState, type DnsMessage, type DnsQuestion, type DnsType,
  type IcmpPacket, type Link, type NetworkInterface, type NetworkSnapshot, type OperationResult, type Packet, type PingResult,
  type Route, type ServiceConfig, type SimulationEvent, type TcpFlag, type TcpPacket, type TunnelPacket, type UdpPacket,
} from './types';
import { validateDevice } from './validate';
import { cidr, contains, ipOf, ipv4, isIpv4 } from '../l3/ipv4';
import { installedRoutes, l3Up, resolveRoute, routingTable } from '../l3/RoutingTable';
import { encodeArp, encodeFrame, encodeIp, encodePayload } from '../capture/encode';
import { decodeFrame } from '../capture/decode';
import { BROADCAST_MAC, defaultSwitchport, egressTag, ingressVlan, vlanAllowed } from '../l2/Vlan';
import { computeStp, portKey, type StpResult } from '../l2/Stp';
import { evaluateRules, flowKey, reverseFlow, sameFlow, type CtState, type FilterDecision } from '../services/FirewallEngine';
import { natInbound, natOutbound } from '../services/Nat';
import { authoritativeAnswer, normalizeName, resolveIterative, type ResolveStep } from '../services/Dns';
import { computeOspf, type OspfResult } from '../routing/LinkState';
import { computeBgp, type BgpResult } from '../routing/Bgp';

type Delivery = { delivered: true; device: DeviceState; packet: Packet; iface?: NetworkInterface } |
  { delivered: false; reason: string; response?: IcmpPacket; responseDevice?: DeviceState };
interface Frame { sourceMac: string; destinationMac: string; packet?: Packet; arp?: { op: 1 | 2; senderIp: string; targetIp: string } }
interface Receiver { device: DeviceState; iface: NetworkInterface; time: number }
interface Hop { device: DeviceState; port: string; tag?: number; time: number }
interface IcmpSpec { type: 'time-exceeded' | 'unreachable'; code: number; source?: string }
interface View { local: string; localPort: number; remote: string; remotePort: number }
interface TcpConn { client: DeviceState; server: DeviceState; service: ServiceConfig; clientView: View; serverView: View; clientSeq: number; serverSeq: number }

export interface TraceProbe { ttl: number; address?: string; marker?: string; result: OperationResult & { reply?: Packet } }
export interface DnsLookupResult extends OperationResult { message?: DnsMessage; server?: string; steps: ResolveStep[] }
export interface HttpStage { layer: 'DNS' | 'TCP' | 'TLS' | 'HTTP'; ok: boolean; detail: string }
export interface HttpResult extends OperationResult { status?: number; headers?: string; body?: string; stages: HttpStage[]; address?: string }
export interface TcpResult extends OperationResult { refused?: boolean }

const ARP_TTL = 120_000;
const MAC_AGING = 300_000;
const CONNTRACK = { SYN_SENT: 120_000, ESTABLISHED: 3_600_000, CLOSED: 10_000, UDP: 30_000, ICMP: 30_000 };
const describe = (p: Packet): string => p.protocol === 'ICMP' ? p.type : p.protocol === 'TCP' ? `TCP ${p.sourcePort}→${p.destinationPort} [${p.flags.join(',')}]`
  : p.protocol === 'UDP' ? `UDP ${p.sourcePort}→${p.destinationPort}${p.payload?.kind === 'dns' ? ' (DNS)' : ''}` : `${p.protocol}（内側: ${describe(p.inner)}）`;
const hex2 = (n: number) => (n & 255).toString(16).padStart(2, '0');
const icmpText = (p: IcmpPacket) => p.type === 'time-exceeded' ? 'Time to live exceeded'
  : ({ 0: 'Network unreachable', 1: 'Host unreachable', 3: 'Port unreachable', 13: 'Communication administratively prohibited' } as Record<number, string>)[p.code ?? 0] ?? 'Destination unreachable';

/** Pure, deterministic TypeScript. No React, DOM, timers, network I/O or storage. */
export class NetworkSimulator {
  private devices = new Map<string, DeviceState>();
  private links: Link[] = [];
  private time = 0;
  private packetSequence = 0;
  private events: SimulationEvent[] = [];
  private captures: Capture[] = [];
  private eventSequence = 0;
  private captureSequence = 0;
  private ports = new Map<string, number>();
  private loading = false;
  private stp: StpResult = { bridges: new Map(), ports: new Map() };
  private ospfState?: OspfResult;
  private bgpState?: BgpResult;

  static fromSnapshot(snapshot: NetworkSnapshot) {
    if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.devices) || !Array.isArray(snapshot.links)) throw new Error('未対応のラボデータです。このアプリの「書き出し」で保存したJSON（version 1）を選んでください');
    if (snapshot.links.length > 512) throw new Error('リンク数が多すぎます（上限512本）');
    if (!Number.isFinite(snapshot.time) || snapshot.time < 0) throw new Error('ラボデータのシミュレーション時刻（time）が不正です');
    const network = new NetworkSimulator();
    network.loading = true;
    for (const device of snapshot.devices) network.addDevice(device);
    for (const link of snapshot.links) network.connect(link);
    network.loading = false;
    network.time = snapshot.time;
    // Runtime caches are intentionally cold on restore; saved config remains authoritative.
    network.recompute();
    return network;
  }
  snapshot(): NetworkSnapshot {
    const devices = [...this.devices.values()].map(d => {
      const { macTable: _m, natTable: _n, conntrack: _c, dnsCache: _d, dynamicRoutes: _r, tunnelStatus: _t, sockets: _s, lineDown: _l, ...config } = d;
      return { ...config, arp: [] };
    });
    return structuredClone({ version: 1, devices, links: this.links, time: this.time });
  }
  /** Full copy including runtime state (ARP, MAC table, NAT table, caches, dynamic routes). */
  device(id: string) { return structuredClone(this.mutableDevice(id)); }
  now() { return this.time; }
  private mutableDevice(id: string) {
    const device = this.devices.get(id);
    if (!device) throw new Error(`機器 ${id} がありません`);
    return device;
  }

  // ---------------------------------------------------------------- configuration
  addDevice(device: DeviceState) {
    if (this.devices.size >= 128) throw new Error('このラボの上限は128機器です');
    if (this.devices.has(device?.id)) throw new Error(`機器名 ${device?.id} はすでに使われています（重複）。別の名前にしてください`);
    const copy = validateDevice(device, [...this.devices.values()]);
    Object.assign(copy, { arp: [], macTable: [], natTable: [], conntrack: [], dnsCache: [], sockets: [], dynamicRoutes: [], tunnelStatus: {} });
    this.devices.set(copy.id, copy);
    this.changed();
  }
  /** Validate-then-commit configuration change. Runtime tables are preserved. */
  update(id: string, mutate: (draft: DeviceState) => void) {
    const current = this.mutableDevice(id);
    const draft = structuredClone(current);
    mutate(draft);
    if (draft.id !== id) throw new Error('機器名はここでは変更できません');
    const others = [...this.devices.values()].filter(d => d.id !== id);
    const validated = validateDevice(draft, others);
    for (const port of current.interfaces) if (!validated.interfaces.some(i => i.id === port.id) && this.linkAt(id, port.id)) throw new Error(`${port.id} はケーブル接続中のため削除できません。先にケーブルを外してください`);
    this.devices.set(id, validated);
    this.changed();
  }
  removeDevice(id: string) {
    this.mutableDevice(id);
    this.links = this.links.filter(l => l.sourceDevice !== id && l.targetDevice !== id);
    this.devices.delete(id); this.changed();
  }
  moveDevice(id: string, position: { x: number; y: number }) {
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) throw new Error('座標が不正です');
    this.mutableDevice(id).position = { ...position };
  }
  connect(link: Link) {
    if (!link?.id || typeof link.id !== 'string' || link.id.length > 64 || this.links.some(l => l.id === link.id)) throw new Error('リンクIDが空・64文字超・重複のいずれかです');
    if (link.sourceDevice === link.targetDevice) throw new Error('同じ機器のポート同士はケーブルで接続できません');
    for (const [id, port] of [[link.sourceDevice, link.sourceInterface], [link.targetDevice, link.targetInterface]]) {
      const iface = this.mutableDevice(id).interfaces.find(i => i.id === port);
      if (!iface) throw new Error(`${id} にポート ${port} がありません`);
      if ((iface.kind ?? 'ethernet') !== 'ethernet') throw new Error(`${port} は論理インターフェース（サブインターフェース・SVI・loopback・tunnel）のため、ケーブルを接続できません。物理ポートを選んでください`);
      if (this.linkAt(id, port)) throw new Error(`${id} ${port} にはすでにケーブルが接続されています`);
    }
    if (typeof link.up !== 'boolean' || !Number.isFinite(link.bandwidth) || link.bandwidth <= 0 || !Number.isFinite(link.latency) || link.latency < 0 || link.latency > 10_000) throw new Error('リンク設定が不正です（up は true / false、帯域は正の値、遅延は0〜10000ms）');
    const { id, sourceDevice, sourceInterface, targetDevice, targetInterface, up, bandwidth, latency } = link;
    this.links.push({ id, sourceDevice, sourceInterface, targetDevice, targetInterface, up, bandwidth, latency }); this.changed();
  }
  removeLink(id: string) { this.links = this.links.filter(l => l.id !== id); this.changed(); }
  setLinkState(id: string, up: boolean) {
    const link = this.links.find(l => l.id === id);
    if (!link) throw new Error('リンクがありません');
    link.up = up; this.changed();
  }
  setLinkProperties(id: string, props: { bandwidth: number; latency: number }) {
    const link = this.links.find(l => l.id === id);
    if (!link) throw new Error('リンクがありません');
    if (!Number.isFinite(props.bandwidth) || props.bandwidth <= 0 || !Number.isFinite(props.latency) || props.latency < 0 || props.latency > 10_000) throw new Error('帯域は正の値、遅延は0〜10000msです');
    link.bandwidth = props.bandwidth; link.latency = props.latency; this.changed();
  }
  configureInterface(id: string, port: string, address: string | undefined, up: boolean) {
    this.update(id, d => {
      const iface = d.interfaces.find(i => i.id === port);
      if (!iface) throw new Error(`${id} にポート ${port} がありません`);
      if (address) iface.address = address; else delete iface.address;
      iface.up = up;
    });
  }
  setGateway(id: string, gateway: string) {
    if (gateway) ipv4(gateway);
    this.update(id, d => { if (gateway) d.gateway = gateway; else delete d.gateway; });
  }
  addRoute(id: string, route: Omit<Route, 'kind'>) {
    this.update(id, d => {
      const r: Route = { ...route, kind: 'static' };
      const same = d.routes.find(x => x.destination === cidr(r.destination).canonical && x.nextHop === r.nextHop && x.interfaceId === r.interfaceId);
      if (same) same.preference = r.preference; else d.routes.push(r);
    });
  }
  deleteRoute(id: string, destination: string, nextHop?: string) {
    const canonical = cidr(destination).canonical;
    const before = this.mutableDevice(id).routes.length;
    this.update(id, d => { d.routes = d.routes.filter(r => !(r.destination === canonical && (!nextHop || nextHop === r.nextHop))); });
    return before !== this.mutableDevice(id).routes.length;
  }
  table(id: string) { return routingTable(this.mutableDevice(id)); }
  installed(id: string) { return installedRoutes(this.mutableDevice(id)); }
  clearArp(id?: string) { for (const d of this.devices.values()) if (!id || d.id === id) d.arp = []; }
  clearMacTable(id?: string) { for (const d of this.devices.values()) if (!id || d.id === id) d.macTable = []; }
  clearNat(id: string) { this.mutableDevice(id).natTable = []; }
  clearConntrack(id: string) { this.mutableDevice(id).conntrack = []; }
  clearDnsCache(id: string) { this.mutableDevice(id).dnsCache = []; }
  advanceTime(ms: number) {
    if (!Number.isFinite(ms) || ms < 0) throw new Error('進める時間は0以上で指定してください');
    this.time += ms;
    for (const d of this.devices.values()) {
      d.arp = d.arp.filter(a => a.expiresAt > this.time);
      d.macTable = d.macTable?.filter(a => a.expiresAt > this.time);
      d.natTable = d.natTable?.filter(a => a.expiresAt > this.time);
      d.conntrack = d.conntrack?.filter(a => a.expiresAt > this.time);
      d.dnsCache = d.dnsCache?.filter(a => a.expiresAt > this.time);
      d.sockets = d.sockets?.filter(a => a.expiresAt > this.time);
    }
  }
  stpState() { return structuredClone(this.stp); }
  ospf() { return this.ospfState && structuredClone(this.ospfState); }
  bgp() { return this.bgpState && structuredClone(this.bgpState); }
  /** L3 interfaces that receive a broadcast sent from this interface (the broadcast domain). */
  broadcastDomain(id: string, port: string) {
    const d = this.mutableDevice(id); const iface = d.interfaces.find(i => i.id === port);
    if (!iface) throw new Error(`${id} にポート ${port} がありません`);
    return this.transmit(d, iface, { sourceMac: iface.mac, destinationMac: BROADCAST_MAC }, true).map(r => ({ device: r.device.id, interface: r.iface.id }));
  }

  private changed() {
    if (this.loading) return;
    // Topology/config change: flush L2/L3 neighbor caches (like a topology change notification).
    for (const d of this.devices.values()) { d.arp = []; d.macTable = []; }
    this.recompute();
  }
  private recompute() {
    const devices = [...this.devices.values()];
    for (const d of devices) {
      d.dynamicRoutes = []; d.tunnelStatus = {};
      // Line protocol: a routed port with no cable / a down link / a shut peer loses its connected route.
      d.lineDown = d.interfaces.filter(i => (i.kind ?? 'ethernet') === 'ethernet' && !i.switchport && !this.carrier(d, i)).map(i => i.id);
    }
    this.stp = computeStp(devices, this.links);
    // SVI line protocol (autostate): up only while an up, STP-forwarding port with carrier carries its VLAN.
    for (const d of devices) d.lineDown!.push(...d.interfaces.filter(i => i.kind === 'svi' && !d.interfaces.some(p => this.canEgress(d, p, i.vlan!) && this.carrier(d, p))).map(i => i.id));
    // A tunnel's underlay may be learned by OSPF/BGP (which may in turn run over tunnels): repeat until tunnel states settle.
    for (let round = 0, before = ''; round < 3; round++) {
      for (const d of devices) for (const i of d.interfaces) if (i.kind === 'tunnel') d.tunnelStatus![i.id] = this.tunnelCheck(d, i);
      const status = JSON.stringify(devices.map(d => d.tunnelStatus));
      if (status === before) break;
      before = status;
      for (const d of devices) d.dynamicRoutes = [];
      this.ospfState = devices.some(d => d.ospf) ? computeOspf(devices, (d, i) => this.segmentPeers(d, i), (d, i) => this.ospfCost(d, i)) : undefined;
      for (const [id, routes] of this.ospfState?.routes ?? []) this.devices.get(id)!.dynamicRoutes = routes;
      this.bgpState = devices.some(d => d.bgp) ? computeBgp(devices, {
        ownerOf: ip => { const device = devices.find(d => d.interfaces.some(i => l3Up(d, i) && ipOf(i.address) === ip)); return device && { device }; },
        sourceFor: (d, ip, updateSource) => {
          const route = resolveRoute(d, ip);
          if (!route) return undefined;
          if (updateSource) { const i = d.interfaces.find(x => x.id === updateSource); return i && l3Up(d, i) ? ipOf(i.address) : undefined; }
          return ipOf(route.iface.address);
        },
        connected: (d, ip) => routingTable(d).some(r => r.kind === 'connected' && contains(r.destination, ip)),
        hasRoute: (d, prefix) => routingTable(d).some(r => r.destination === prefix),
        nextHopReachable: (d, ip) => !!resolveRoute(d, ip),
      }) : undefined;
      for (const [id, routes] of this.bgpState?.routes ?? []) this.devices.get(id)!.dynamicRoutes!.push(...routes);
    }
  }
  private carrier(d: DeviceState, iface: NetworkInterface) {
    const link = this.linkAt(d.id, iface.id);
    if (!link || !link.up || !iface.up) return false;
    const [peerId, peerPort] = link.sourceDevice === d.id && link.sourceInterface === iface.id ? [link.targetDevice, link.targetInterface] : [link.sourceDevice, link.sourceInterface];
    return this.devices.get(peerId)?.interfaces.find(i => i.id === peerPort)?.up ?? false;
  }
  private ospfCost(d: DeviceState, iface: NetworkInterface) {
    if (iface.ospfCost) return iface.ospfCost;
    if (iface.kind === 'tunnel') return 1000; // IOS default tunnel bandwidth (100 kbit/s)
    if (iface.kind === 'loopback' || iface.kind === 'svi') return 1;
    const link = this.linkAt(d.id, iface.parent ?? iface.id);
    return Math.max(1, Math.floor(100 / (link?.bandwidth ?? 1000))); // reference bandwidth 100 Mbit/s
  }
  private segmentPeers(d: DeviceState, iface: NetworkInterface) {
    if (iface.kind === 'loopback') return [];
    if (iface.kind === 'tunnel') {
      const peer = this.tunnelPeer(d, iface);
      return peer && d.tunnelStatus?.[iface.id]?.up ? [peer] : [];
    }
    return this.transmit(d, iface, { sourceMac: iface.mac, destinationMac: BROADCAST_MAC }, true)
      .filter(r => r.device.id !== d.id && r.iface.address);
  }
  private tunnelPeer(d: DeviceState, iface: NetworkInterface) {
    const t = iface.tunnel; if (!t) return undefined;
    for (const device of this.devices.values()) {
      const peer = device.interfaces.find(i => i.kind === 'tunnel' && i.tunnel?.source === t.destination && i.tunnel.destination === t.source);
      if (peer && device.id !== d.id) return { device, iface: peer };
    }
    return undefined;
  }
  private tunnelCheck(d: DeviceState, iface: NetworkInterface): { up: boolean; reason: string } {
    const t = iface.tunnel;
    if (!iface.up) return { up: false, reason: 'administratively down（shutdown で停止中。no shutdown で有効にします）' };
    if (!t) return { up: false, reason: 'tunnel source / destination が未設定です' };
    if (!d.interfaces.some(i => i.kind !== 'tunnel' && l3Up(d, i) && ipOf(i.address) === t.source)) return { up: false, reason: `tunnel source ${t.source} は、この機器のUpしているインターフェースのアドレスではありません` };
    const underlay = resolveRoute(d, t.destination);
    if (!underlay) return { up: false, reason: `tunnel destination ${t.destination} への経路がありません（トンネルの外側のパケットを運ぶアンダーレイの経路が必要です）` };
    if (underlay.iface.kind === 'tunnel') return { up: false, reason: 'tunnel destination への経路がトンネル自身を指しています（再帰ルーティング）。外側のパケットはトンネル以外の経路で運ぶ必要があります' };
    const peer = this.tunnelPeer(d, iface);
    if (!peer) return { up: false, reason: `${t.destination} 側に、このトンネルと対になる設定がありません（相手の tunnel source / destination が、こちらと逆向きに一致する必要があります）` };
    const p = peer.iface.tunnel!;
    if (p.mode !== t.mode) return { up: false, reason: `トンネルモードが一致しません（${t.mode} / ${p.mode}）` };
    if (t.mode === 'ipsec') {
      if ((t.psk ?? '') !== (p.psk ?? '') || !t.psk) return { up: false, reason: 'IKE: 事前共有鍵（PSK）が一致しない、または未設定のため認証に失敗。両側の tunnel protection psk を確認します' };
      if ((t.proposal ?? 'aes256-sha256') !== (p.proposal ?? 'aes256-sha256')) return { up: false, reason: `IKE: 暗号化提案が一致しません（NO_PROPOSAL_CHOSEN: ${t.proposal} / ${p.proposal}）` };
    }
    return { up: true, reason: t.mode === 'ipsec' ? `IKE SA / IPsec SA 確立（${t.proposal ?? 'aes256-sha256'}）` : 'GREトンネル Up' };
  }

  // ---------------------------------------------------------------- recording
  private event(type: SimulationEvent['type'], device: DeviceState, packet: Packet | undefined, message: string, extra: Partial<SimulationEvent> = {}) {
    if (this.events.length >= 20_000) return;
    this.events.push(structuredClone({ id: ++this.eventSequence, time: this.time, type, deviceId: device.id, packet, message, ...extra }));
  }
  private capture(deviceId: string, interfaceId: string, linkId: string, time: number, frame: Frame, vlan?: number) {
    if (this.captures.length >= 20_000) return undefined;
    const bytes = frame.arp ? encodeArp(frame.sourceMac, frame.destinationMac, frame.arp.senderIp, frame.arp.targetIp, frame.arp.op === 2, vlan)
      : encodeFrame(frame.packet!, frame.sourceMac, frame.destinationMac, vlan);
    const value: Capture = structuredClone({ ...decodeFrame(bytes).summary, id: ++this.captureSequence, time, deviceId, interfaceId, linkId, bytes, packet: frame.packet });
    this.captures.push(value); return value.id;
  }
  private begin() { this.events = []; this.captures = []; return this.time; }
  private finish<T extends object>(result: T, start: number): T & OperationResult {
    return structuredClone({ success: false, reason: '', ...result, events: this.events, captures: this.captures, elapsed: this.time - start });
  }

  // ---------------------------------------------------------------- L2
  private linkAt(deviceId: string, port: string) {
    return this.links.find(l => (l.sourceDevice === deviceId && l.sourceInterface === port) || (l.targetDevice === deviceId && l.targetInterface === port));
  }
  private canEgress(sw: DeviceState, p: NetworkInterface, vlan: number) {
    return p.up && !!p.switchport && vlanAllowed(p.switchport, vlan) && (this.stp.ports.get(portKey(sw.id, p.id))?.forwarding ?? true) && !!this.linkAt(sw.id, p.id)?.up;
  }
  /**
   * Put a frame on the wire and follow it through switches (learning, VLAN tagging, STP, flooding).
   * Returns the L3 interfaces whose NIC accepts the frame. `silent` = control-plane probe: no events, no learning.
   */
  private transmit(sender: DeviceState, iface: NetworkInterface, frame: Frame, silent = false): Receiver[] {
    const receivers: Receiver[] = [];
    const queue: Hop[] = [];
    const what = frame.arp ? (frame.arp.op === 1 ? 'ARP Request' : 'ARP Reply') : 'Ethernetフレーム';
    let budget = 256;
    if (iface.kind === 'svi') this.bridge(sender, undefined, iface.vlan!, frame, this.time, queue, receivers, silent);
    else queue.push({ device: sender, port: iface.parent ?? iface.id, tag: iface.kind === 'subinterface' ? iface.vlan : undefined, time: this.time });
    while (queue.length) {
      const hop = queue.shift()!;
      if (--budget < 0) {
        if (!silent) this.event('BROADCAST_STORM', hop.device, frame.packet, 'フレームの複製が安全上限（256回）に達したため打ち切りました。L2ループで同じフレームが回り続けるブロードキャストストームの可能性が高く、STPが無効になっていないか show spanning-tree で確認します', { time: hop.time });
        break;
      }
      const discard = (device: DeviceState, message: string, port = hop.port, time = hop.time) => { if (!silent) this.event('FRAME_DISCARDED', device, frame.packet, message, { interfaceId: port, time, vlan: hop.tag }); };
      const link = this.linkAt(hop.device.id, hop.port);
      if (!link) { discard(hop.device, `${hop.port}: ケーブルが接続されていないため送信できません`); continue; }
      if (!link.up) { discard(hop.device, `${hop.port}: リンクが Down（切断状態）のため送信できません`); continue; }
      const forward = link.sourceDevice === hop.device.id && link.sourceInterface === hop.port;
      const peer = this.mutableDevice(forward ? link.targetDevice : link.sourceDevice);
      const port = peer.interfaces.find(i => i.id === (forward ? link.targetInterface : link.sourceInterface))!;
      const arrival = hop.time + link.latency;
      const common = { linkId: link.id, sourceMac: frame.sourceMac, destinationMac: frame.destinationMac, vlan: hop.tag };
      let captureId: number | undefined;
      if (!silent) {
        captureId = this.capture(hop.device.id, hop.port, link.id, hop.time, frame, hop.tag);
        this.event('FRAME_SENT', hop.device, frame.packet, `${hop.port} → ${peer.id} ${port.id}: ${what}を送信（MAC ${frame.sourceMac} → ${frame.destinationMac}${hop.tag !== undefined ? `、802.1Qタグ VLAN ${hop.tag}` : ''}）`, { ...common, interfaceId: hop.port, captureId, time: hop.time });
      }
      if (!port.up) { discard(peer, `${port.id} は shutdown（管理的に停止）中のため受信しません`, port.id, arrival); continue; }
      if (port.switchport && switchingKinds.includes(peer.kind)) {
        const stp = this.stp.ports.get(portKey(peer.id, port.id));
        if (stp && !stp.forwarding) { if (!silent) this.event('STP_BLOCKED', peer, frame.packet, `${port.id} はSTPでブロッキング中（役割: ${stp.role}）。ループを防ぐため、このポートで受け取ったフレームは破棄します`, { ...common, interfaceId: port.id, time: arrival }); continue; }
        const cls = ingressVlan(port.switchport, hop.tag);
        if ('drop' in cls) { discard(peer, `${port.id}: ${cls.drop}`, port.id, arrival); continue; }
        if (cls.vlan !== 1 && !(peer.vlans ?? []).some(v => v.id === cls.vlan)) { discard(peer, `${port.id}: VLAN ${cls.vlan} がこのスイッチに作成されていないため破棄（vlan ${cls.vlan} で作成し、show vlan brief で確認します）`, port.id, arrival); continue; }
        if (!silent) this.event('FRAME_RECEIVED', peer, frame.packet, `${port.id} で受信（VLAN ${cls.vlan}${port.switchport.mode === 'trunk' ? `、トランク${hop.tag === undefined ? '・タグなしのためネイティブVLAN' : ''}` : '、アクセスポート'}）`, { ...common, interfaceId: port.id, captureId, time: arrival });
        this.bridge(peer, port, cls.vlan, frame, arrival, queue, receivers, silent);
        continue;
      }
      const logical = hop.tag === undefined ? (port.switchport ? undefined : port)
        : peer.interfaces.find(i => i.kind === 'subinterface' && i.parent === port.id && i.vlan === hop.tag);
      if (!logical || !logical.up) { discard(peer, hop.tag !== undefined ? `${port.id}: VLAN ${hop.tag} のタグに対応するUpのサブインターフェース（encapsulation dot1q ${hop.tag}）がないため破棄` : `${port.id}: 受信できるインターフェースがありません`, port.id, arrival); continue; }
      if (frame.destinationMac !== BROADCAST_MAC && frame.destinationMac !== logical.mac) { discard(peer, `宛先MAC ${frame.destinationMac} は自分（${logical.mac}）宛てではないため、NICが破棄します`, logical.id, arrival); continue; }
      if (!silent) this.event('FRAME_RECEIVED', peer, frame.packet, frame.packet ? `${logical.id} で受信。Ethernetヘッダを外し、IPの宛先を確認します` : `${logical.id} で${what}を受信`, { ...common, interfaceId: logical.id, captureId, time: arrival });
      receivers.push({ device: peer, iface: logical, time: arrival });
    }
    return receivers;
  }
  private bridge(sw: DeviceState, ingress: NetworkInterface | undefined, vlan: number, frame: Frame, time: number, queue: Hop[], receivers: Receiver[], silent: boolean) {
    const table = sw.macTable ??= [];
    if (ingress && !silent) {
      const old = table.find(e => e.mac === frame.sourceMac && e.vlan === vlan);
      if (!old || old.port !== ingress.id || old.expiresAt <= time) {
        const moved = old && old.port !== ingress.id && old.expiresAt > time;
        if (old) table.splice(table.indexOf(old), 1);
        table.push({ mac: frame.sourceMac, vlan, port: ingress.id, expiresAt: time + MAC_AGING });
        this.event('MAC_LEARNED', sw, frame.packet, moved ? `MACアドレスの移動を検出: ${frame.sourceMac}（VLAN ${vlan}）${old!.port} → ${ingress.id}。端末をつなぎ替えていないなら、L2ループの兆候です`
          : `送信元MAC ${frame.sourceMac} は ${ingress.id} の先にいると学習し、MACアドレステーブルに登録（VLAN ${vlan}）`, { interfaceId: ingress.id, vlan, time });
      } else old.expiresAt = time + MAC_AGING;
    }
    const svi = sw.interfaces.find(i => i.kind === 'svi' && i.vlan === vlan && i.up);
    const flood = () => sw.interfaces.filter(p => p.switchport && p.id !== ingress?.id && this.canEgress(sw, p, vlan)).map(p => p.id);
    // Explain trunks / blocked ports that are skipped: the most common "why didn't it arrive?" answer.
    const skipped = () => {
      const notes = sw.interfaces.filter(p => p.switchport && p.id !== ingress?.id && this.linkAt(sw.id, p.id) && !this.canEgress(sw, p, vlan)).map(p =>
        `${p.id}: ${!vlanAllowed(p.switchport!, vlan) ? (p.switchport!.mode === 'trunk' ? `トランクでVLAN ${vlan} 不許可` : `別VLAN（アクセスVLAN ${p.switchport!.accessVlan}）`) : this.stp.ports.get(portKey(sw.id, p.id))?.forwarding === false ? 'STPブロッキング' : 'Down'}`);
      return notes.length ? `。送らないポート: ${notes.join(' / ')}` : '';
    };
    let targets: string[]; let decision: string;
    if (frame.destinationMac === BROADCAST_MAC) {
      targets = flood(); decision = `ブロードキャストなので、受信ポート以外で VLAN ${vlan} を送れるポートすべてへフラッディング（${targets.join(', ') || '対象ポートなし'}）${skipped()}`;
      if (svi && ingress) receivers.push({ device: sw, iface: svi, time });
    } else if (svi && frame.destinationMac === svi.mac) {
      targets = []; decision = `宛先MACは自分の ${svi.id}（SVI: VLANのIPインターフェース）。L3処理（ルーティング）へ渡します`;
      if (ingress) receivers.push({ device: sw, iface: svi, time });
    } else {
      const entry = table.find(e => e.mac === frame.destinationMac && e.vlan === vlan && e.expiresAt > time);
      if (entry && entry.port === ingress?.id) { targets = []; decision = `宛先MACは受信ポート ${entry.port} 側にあるため転送しません（フィルタリング）`; }
      else if (entry) { targets = [entry.port]; decision = `MACアドレステーブルに一致: ${frame.destinationMac}（VLAN ${vlan}）→ ${entry.port} だけに転送`; }
      else { targets = flood(); decision = `宛先MAC ${frame.destinationMac} はVLAN ${vlan} で未学習（どのポートの先にいるか不明）。受信ポート以外へフラッディング（${targets.join(', ') || '対象ポートなし'}）${skipped()}`; }
    }
    if (!silent) this.event('MAC_LOOKUP', sw, frame.packet, decision, { vlan, time, interfaceId: ingress?.id });
    for (const id of targets) {
      const p = sw.interfaces.find(i => i.id === id)!;
      if (!this.canEgress(sw, p, vlan)) { if (!silent) this.event('FRAME_DISCARDED', sw, frame.packet, `${id} はVLAN ${vlan} を送信できない状態です（VLAN不許可・STPブロッキング・リンクDownのいずれか）`, { interfaceId: id, time, vlan }); continue; }
      queue.push({ device: sw, port: id, tag: egressTag(p.switchport!, vlan), time });
    }
  }
  private learn(device: DeviceState, entry: Omit<ArpEntry, 'expiresAt'>) {
    device.arp = device.arp.filter(a => !(a.ip === entry.ip && a.interfaceId === entry.interfaceId));
    device.arp.push({ ...entry, expiresAt: this.time + ARP_TTL });
  }
  private resolveMac(device: DeviceState, iface: NetworkInterface, nextHop: string, packet: Packet) {
    const cached = device.arp.find(a => a.ip === nextHop && a.interfaceId === iface.id && a.expiresAt > this.time);
    this.event('ARP_LOOKUP', device, packet, cached ? `${nextHop} のMACアドレスは ${cached.mac}（ARPキャッシュにあり）` : `${nextHop} のMACアドレスがARPキャッシュにないため、ARP Request（ブロードキャスト）で問い合わせます`, { interfaceId: iface.id });
    if (cached) return cached.mac;
    const sourceIp = ipOf(iface.address)!;
    this.event('ARP_REQUEST', device, packet, `Broadcast: Who has ${nextHop}? Tell ${sourceIp}（${nextHop} を持つ機器は、MACアドレスを ${sourceIp} に教えて）`, { interfaceId: iface.id, sourceMac: iface.mac, destinationMac: BROADCAST_MAC });
    const heard = this.transmit(device, iface, { sourceMac: iface.mac, destinationMac: BROADCAST_MAC, arp: { op: 1, senderIp: sourceIp, targetIp: nextHop } });
    const target = heard.find(r => ipOf(r.iface.address) === nextHop && l3Up(r.device, r.iface));
    this.time = Math.max(this.time, ...heard.map(r => r.time));
    if (!target) return undefined;
    this.learn(target.device, { ip: sourceIp, mac: iface.mac, interfaceId: target.iface.id });
    this.event('ARP_REPLY', target.device, packet, `${nextHop} is at ${target.iface.mac}（${target.device.id} が自分のMACアドレスを返答）`, { interfaceId: target.iface.id, sourceMac: target.iface.mac, destinationMac: iface.mac });
    const back = this.transmit(target.device, target.iface, { sourceMac: target.iface.mac, destinationMac: iface.mac, arp: { op: 2, senderIp: nextHop, targetIp: sourceIp } });
    const got = back.find(r => r.device.id === device.id && r.iface.id === iface.id);
    if (!got) return undefined;
    this.time = Math.max(this.time, got.time);
    this.learn(device, { ip: nextHop, mac: target.iface.mac, interfaceId: iface.id });
    return target.iface.mac;
  }

  // ---------------------------------------------------------------- L3 pipeline
  private isLocal(device: DeviceState, ip: string, fromWire: boolean) {
    return device.interfaces.some(i => l3Up(device, i) && ipOf(i.address) === ip) || (!fromWire && ip.startsWith('127.'));
  }
  private fail(device: DeviceState, packet: Packet, reason: string, icmp?: IcmpSpec): Delivery {
    this.event('PACKET_DROPPED', device, packet, reason);
    // ICMP errors never generate additional ICMP errors.
    if (!icmp || (packet.protocol === 'ICMP' && (packet.type === 'time-exceeded' || packet.type === 'unreachable'))) return { delivered: false, reason };
    const source = icmp.source ?? ipOf(resolveRoute(device, packet.source)?.iface.address);
    if (!source) return { delivered: false, reason };
    return { delivered: false, reason, responseDevice: device, response: {
      id: ++this.packetSequence, source, destination: packet.source, ttl: 64, protocol: 'ICMP', type: icmp.type, code: icmp.code,
      identifier: packet.protocol === 'ICMP' ? packet.identifier : 0, sequence: packet.protocol === 'ICMP' ? packet.sequence : 0,
      quote: encodeIp(packet).slice(0, 28), original: packet,
    } };
  }
  private aclCheck(device: DeviceState, name: string, packet: Packet, iface: NetworkInterface, direction: 'in' | 'out'): Delivery | undefined {
    const acl = device.acls?.find(a => a.name === name);
    if (!acl) return undefined;
    const d = evaluateRules(acl.rules, 'deny', packet, direction === 'in' ? { inInterface: iface.id } : { outInterface: iface.id }, '暗黙の deny（どの行にも一致しないときにACLの末尾で適用）');
    this.event(d.action === 'permit' ? 'FIREWALL_ACCEPT' : 'FIREWALL_DROP', device, packet, `ACL ${name}（${iface.id} ${direction}）: ${d.action === 'permit' ? '許可' : '拒否'} — ${d.text}`, { rule: d.text, interfaceId: iface.id });
    if (d.action === 'permit') return undefined;
    return this.fail(device, packet, `${device.id}: ACL ${name}（${iface.id} ${direction}）が拒否しました（${d.text}）。ACLは上の行から順に比べるため、show access-lists で行の順番を確認します`, { type: 'unreachable', code: 13, source: direction === 'in' ? ipOf(iface.address) : undefined });
  }
  private ctState(device: DeviceState, packet: Packet): CtState {
    const table = device.conntrack = (device.conntrack ?? []).filter(e => e.expiresAt > this.time);
    if (packet.protocol === 'ICMP' && packet.original) {
      const of = flowKey(packet.original);
      return of && table.some(e => sameFlow(e, of) || sameFlow(e, reverseFlow(of))) ? 'related' : 'invalid';
    }
    const f = flowKey(packet);
    if (!f) return 'new';
    if (table.some(e => sameFlow(e, f) || sameFlow(e, reverseFlow(f)))) return 'established';
    if (packet.protocol === 'TCP' && !(packet.flags.includes('SYN') && !packet.flags.includes('ACK'))) return 'invalid';
    if (packet.protocol === 'ICMP' && packet.type === 'echo-reply') return 'invalid';
    return 'new';
  }
  private ctRecord(device: DeviceState, packet: Packet, state: CtState) {
    const f = flowKey(packet); if (!f) return;
    const table = device.conntrack ??= [];
    const e = table.find(x => sameFlow(x, f) || sameFlow(x, reverseFlow(f)));
    if (e) {
      e.state = e.protocol === 'tcp' ? (e.state === 'CLOSED' || (packet.protocol === 'TCP' && (packet.flags.includes('FIN') || packet.flags.includes('RST'))) ? 'CLOSED' : e.state === 'SYN_SENT' && sameFlow(e, f) ? 'SYN_SENT' : 'ESTABLISHED') : e.state;
      e.expiresAt = this.time + CONNTRACK[e.state];
    } else if (state === 'new') {
      const s = f.protocol === 'tcp' ? 'SYN_SENT' : f.protocol === 'udp' ? 'UDP' : 'ICMP';
      table.push({ ...f, state: s, expiresAt: this.time + CONNTRACK[s] });
      if (table.length > 2000) table.shift();
    }
  }
  private filter(device: DeviceState, packet: Packet, ctx: { inInterface?: string; outInterface?: string }, chain: 'input' | 'forward'): Delivery | undefined {
    const policy = device.firewall!;
    const tracking = policy.stateful || chain === 'input';
    const state = tracking ? this.ctState(device, packet) : undefined;
    let decision: FilterDecision;
    if (policy.stateful && chain === 'forward' && (state === 'established' || state === 'related')) decision = { action: 'permit', text: `conntrack: ${state.toUpperCase()}（既存の接続に属する通信なので自動許可）` };
    else if (policy.stateful && chain === 'forward' && state === 'invalid') decision = { action: 'deny', text: 'conntrack: INVALID（対応する接続がありません。行きと帰りで通る経路が違い、このFirewallが接続の始まりを見ていない可能性）' };
    else decision = evaluateRules(policy.rules, policy.defaultAction, packet, { ...ctx, ctState: state }, 'デフォルトポリシー（どのルールにも一致しなかった）');
    const label = chain === 'input' ? `${device.id} INPUT` : `${device.id} Firewall（${policy.stateful ? 'stateful' : 'stateless'}）`;
    this.event(decision.action === 'permit' ? 'FIREWALL_ACCEPT' : 'FIREWALL_DROP', device, packet,
      `${label}: ${decision.action === 'permit' ? '許可' : decision.action === 'reject' ? '拒否（REJECT）' : '破棄（DROP）'} — ${decision.text}`, { rule: decision.text, interfaceId: ctx.inInterface });
    if (decision.action === 'permit') { if (tracking && state) this.ctRecord(device, packet, state); return undefined; }
    const reason = `${device.id}: ${chain === 'input' ? 'ホストのFirewall（INPUT）' : 'Firewall'}が${decision.action === 'reject' ? '拒否' : '破棄'}しました（${decision.text}）`;
    if (decision.action === 'reject') return this.fail(device, packet, reason, { type: 'unreachable', code: chain === 'input' ? 3 : 13, source: chain === 'input' ? packet.destination : undefined });
    return this.fail(device, packet, reason);
  }
  private routeMessage(device: DeviceState, packet: Packet, resolved: ReturnType<typeof resolveRoute>) {
    if (!resolved) return `宛先 ${packet.destination} に一致する有効な経路がありません（一致する経路がないか、その経路の Next Hop に到達できません）`;
    const r = resolved.route;
    const kind = { connected: '直結', static: device.gateway && r.nextHop === device.gateway && r.destination === '0.0.0.0/0' ? 'Default Gateway' : 'Static', ospf: 'OSPF', bgp: 'BGP' }[r.kind];
    if (r.kind === 'connected') return `宛先 ${packet.destination} は直結ネットワーク ${r.destination}（${resolved.iface.id}）内。ルータを経由せず、宛先へ直接届けます`;
    return `宛先 ${packet.destination} に最も長く一致する経路 ${r.destination}（${kind}${r.kind !== 'static' ? ` metric ${r.metric}` : ''}）を選択 → Next Hop ${resolved.nextHop}（${resolved.iface.id}）へ送ります`;
  }
  private trackOutput(device: DeviceState, packet: Packet) {
    if (device.firewall && !forwardingKinds.includes(device.kind)) this.ctRecord(device, packet, this.ctState(device, packet) === 'established' ? 'established' : 'new');
  }
  private deliver(origin: DeviceState, initial: Packet, depth = 0): Delivery {
    let current = origin;
    let packet = initial;
    let incoming: NetworkInterface | undefined;
    if (depth > 3) return this.fail(origin, packet, 'トンネルの入れ子が深すぎます（3段まで）');
    this.event('PACKET_CREATED', current, packet, `${describe(packet)}: ${packet.source} → ${packet.destination}`);
    this.trackOutput(current, packet);
    for (let hop = 0; hop < 128; hop++) {
      if (incoming) {
        if (incoming.acl?.in) { const d = this.aclCheck(current, incoming.acl.in, packet, incoming, 'in'); if (d) return d; }
        if (incoming.nat === 'outside' && current.nat?.length) {
          const t = natInbound(current, packet, this.time);
          if (t) { packet = t.packet; this.event('NAT_TRANSLATED', current, packet, `NAT（outside → inside）: 宛先を ${t.before} から ${t.after} に書き換えます`, { rule: t.entry.rule, before: t.before, after: t.after, interfaceId: incoming.id }); }
        }
      }
      if (this.isLocal(current, packet.destination, !!incoming)) {
        if (incoming && current.firewall && !forwardingKinds.includes(current.kind)) { const d = this.filter(current, packet, { inInterface: incoming.id }, 'input'); if (d) return d; }
        if (packet.protocol === 'ESP' || packet.protocol === 'GRE') {
          const outer = packet;
          const tunnel = current.interfaces.find(i => i.kind === 'tunnel' && i.tunnel?.destination === outer.source && i.tunnel.source === outer.destination && l3Up(current, i));
          if (!tunnel) return this.fail(current, packet, `${current.id}: ${packet.protocol} を受信しましたが、対応するUpのトンネルがありません（送信元・宛先が tunnel destination / source と一致するトンネルが必要です）`);
          this.event('TUNNEL_DECAPSULATED', current, outer.inner, `${tunnel.id}: ${outer.protocol === 'ESP' ? 'ESPを復号し' : 'GREヘッダを外し'}、元のパケット ${outer.inner.source} → ${outer.inner.destination} を取り出します`, { interfaceId: tunnel.id });
          packet = outer.inner; incoming = tunnel;
          continue;
        }
        this.event('PACKET_RECEIVED', current, packet, `${current.id} が ${describe(packet)} を受信しました（宛先 ${packet.destination} は自分のアドレス）`, { interfaceId: incoming?.id });
        return { delivered: true, device: current, packet, iface: incoming };
      }
      if (incoming && !forwardingKinds.includes(current.kind)) return this.fail(current, packet, `${current.id} はIPパケットを中継（ルーティング）しない機器です。宛先 ${packet.destination} は自分のアドレスではないため破棄しました`);
      if (incoming && packet.ttl <= 1) return this.fail(current, packet, `${current.id}: TTL exceeded（受信した TTL=${packet.ttl}。1減らすと0になるため転送できず破棄）。TTLを小さくしていないのに起きたら、経路のループを疑います`, { type: 'time-exceeded', code: 0, source: ipOf(incoming.address) });
      const resolved = resolveRoute(current, packet.destination);
      this.event('ROUTE_LOOKUP', current, packet, this.routeMessage(current, packet, resolved), { route: resolved?.route, interfaceId: resolved?.iface.id });
      if (!resolved) return this.fail(current, packet, `${current.id}: 宛先 ${packet.destination} への経路がありません（Network unreachable）。${hostKinds.includes(current.kind) ? 'ip route' : 'show ip route'} で、宛先のネットワークか Default Route があるか確認します`, incoming ? { type: 'unreachable', code: 0, source: ipOf(incoming.address) } : undefined);
      const { iface, nextHop } = resolved;
      if (incoming && current.firewall && forwardingKinds.includes(current.kind)) { const d = this.filter(current, packet, { inInterface: incoming.id, outInterface: iface.id }, 'forward'); if (d) return d; }
      if (incoming) {
        const old = packet.ttl; packet = { ...packet, ttl: old - 1 };
        this.event('TTL_DECREMENTED', current, packet, `ルータで転送するため TTL を1減らします（${old} → ${packet.ttl}）。NATがなければ、IPの送信元・宛先は変わりません`);
      }
      if (incoming?.nat === 'inside' && iface.nat === 'outside' && current.nat?.length) {
        const t = natOutbound(current, packet, iface, this.time);
        if (t) { packet = t.packet; this.event('NAT_TRANSLATED', current, packet, `NAT（inside → outside）: 送信元を ${t.before} から ${t.after} に書き換えます`, { rule: t.entry.rule, before: t.before, after: t.after, interfaceId: iface.id }); }
        else this.event('NAT_TRANSLATED', current, packet, `NAT対象外: 一致する ip nat inside source ルールがないため、送信元 ${packet.source} のまま送信します`, { interfaceId: iface.id });
      }
      if (incoming && iface.acl?.out) { const d = this.aclCheck(current, iface.acl.out, packet, iface, 'out'); if (d) return d; }
      if (iface.kind === 'tunnel') {
        const t = iface.tunnel!;
        const outer: TunnelPacket = { id: ++this.packetSequence, source: t.source, destination: t.destination, ttl: 64, protocol: t.mode === 'ipsec' ? 'ESP' : 'GRE', inner: packet,
          ...(t.mode === 'ipsec' ? { spi: 0x1000 + (ipv4(t.destination) & 0xfff) } : {}) };
        this.event('TUNNEL_ENCAPSULATED', current, outer, `${iface.id}: 元のパケットを${t.mode === 'ipsec' ? 'IPsec ESPで暗号化し' : 'GREでカプセル化し'}、外側IPヘッダ ${t.source} → ${t.destination} を付けます`, { interfaceId: iface.id });
        return this.deliver(current, outer, depth + 1);
      }
      if (iface.kind !== 'svi') {
        const link = this.linkAt(current.id, iface.parent ?? iface.id);
        const physical = current.interfaces.find(i => i.id === (iface.parent ?? iface.id));
        if (!link || !link.up || !physical?.up) return this.fail(current, packet, `${current.id} ${iface.id}: Link / Interface Down（shutdown・リンク切断）、またはケーブル未接続のため送信できません`, incoming ? { type: 'unreachable', code: 1, source: ipOf(incoming.address) } : undefined);
      }
      const mac = this.resolveMac(current, iface, nextHop, packet);
      if (!mac) return this.fail(current, packet, `${current.id}: ARP応答なし。Next Hop ${nextHop} からMACアドレスの返事がありません。${nextHop} が同じLANにいるか、相手のIPアドレス・ケーブル・VLANを確認します`, incoming ? { type: 'unreachable', code: 1, source: ipOf(incoming.address) } : undefined);
      const receivers = this.transmit(current, iface, { sourceMac: iface.mac, destinationMac: mac, packet });
      const receiver = receivers.find(r => r.iface.mac === mac);
      if (!receiver) return this.fail(current, packet, `${current.id}: フレームが宛先MAC ${mac} の機器に届きませんでした。途中のスイッチのVLAN・トランクの許可VLAN・STPのブロッキングを確認します`);
      this.time = Math.max(this.time, receiver.time);
      current = receiver.device; incoming = receiver.iface;
    }
    return this.fail(current, packet, '転送が128ホップを超えたため、シミュレーションの安全上限で打ち切りました');
  }
  /** Deliver an ICMP error produced by a failed delivery back to `origin`. */
  private bounce(result: Delivery, origin: DeviceState): IcmpPacket | undefined {
    if (result.delivered || !result.response || !result.responseDevice || result.responseDevice.id === origin.id) return undefined;
    const back = this.deliver(result.responseDevice, result.response);
    return back.delivered && back.device.id === origin.id ? back.packet as IcmpPacket : undefined;
  }
  private sourceAddress(origin: DeviceState, destination: string) {
    return ipOf(resolveRoute(origin, destination)?.iface.address) ?? ipOf(origin.interfaces.find(i => l3Up(origin, i))?.address);
  }
  private ephemeral(device: DeviceState) {
    const n = this.ports.get(device.id) ?? 0; this.ports.set(device.id, n + 1);
    return 49152 + (n % 16384);
  }
  private isn() { return ((++this.packetSequence * 1103515245 + 12345) >>> 0); }

  // ---------------------------------------------------------------- ICMP
  ping(id: string, destination: string, ttl = 64, sequence = 1): PingResult {
    ipv4(destination);
    if (!Number.isInteger(ttl) || ttl < 1 || ttl > 255) throw new Error('TTLは1〜255です');
    const origin = this.mutableDevice(id);
    const start = this.begin();
    return this.finish(this.echo(origin, destination, ttl, sequence), start);
  }
  private echo(origin: DeviceState, destination: string, ttl: number, sequence: number): { success: boolean; reason: string; reply?: IcmpPacket } {
    const source = this.sourceAddress(origin, destination);
    if (!source) return { success: false, reason: `${origin.id}: 有効なIPアドレスを持つUpポートがありません。IPアドレスの設定と、ポートがUpかを確認します` };
    const packet: IcmpPacket = { id: ++this.packetSequence, source, destination, ttl, protocol: 'ICMP', type: 'echo-request', identifier: this.packetSequence & 65535, sequence };
    const outbound = this.deliver(origin, packet);
    if (outbound.delivered) {
      const got = outbound.packet as IcmpPacket;
      const response: IcmpPacket = { ...got, id: ++this.packetSequence, source: got.destination, destination: got.source, ttl: 64, type: 'echo-reply' };
      const inbound = this.deliver(outbound.device, response);
      if (inbound.delivered && inbound.device.id === origin.id) { const reply = inbound.packet as IcmpPacket; return { success: true, reason: `${destination} から応答: ttl=${reply.ttl}`, reply }; }
      return { success: false, reason: `Echo Request は宛先に届きましたが応答が戻りません（帰り道の問題）。${inbound.delivered ? `応答は別の機器 ${inbound.device.id} に届きました` : inbound.reason}` };
    }
    const reply = this.bounce(outbound, origin);
    let reason = outbound.reason;
    if (outbound.response && outbound.responseDevice && outbound.responseDevice.id !== origin.id && !reply) reason += '（エラーを知らせるICMPも、送信元まで戻れませんでした）';
    return { success: false, reason, reply };
  }

  // ---------------------------------------------------------------- traceroute
  traceroute(id: string, destination: string, maxHops = 16, mode: 'icmp' | 'udp' | 'tcp' = 'icmp', port = 80): TraceProbe[] {
    ipv4(destination);
    if (!Number.isInteger(maxHops) || maxHops < 1 || maxHops > 64) throw new Error('ホップ上限は1〜64です');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('ポートは1〜65535です');
    const origin = this.mutableDevice(id);
    const probes: TraceProbe[] = [];
    for (let ttl = 1; ttl <= maxHops; ttl++) {
      const start = this.begin();
      let result: { success: boolean; reason: string; reply?: Packet };
      if (mode === 'icmp') result = this.echo(origin, destination, ttl, ttl);
      else result = this.probe(origin, destination, ttl, mode, mode === 'udp' ? 33433 + ttl : port);
      const r = this.finish(result, start);
      const reply = r.reply;
      const marker = reply?.protocol === 'ICMP' && reply.type === 'unreachable' && !(reply.code === 3 && reply.source === destination)
        ? ({ 0: '!N', 1: '!H', 3: '!P', 13: '!X' } as Record<number, string>)[reply.code ?? 0] ?? '!' : undefined;
      probes.push({ ttl, address: reply?.source, marker, result: r });
      if (r.success || marker || !r.events.some(e => e.type === 'FRAME_SENT')) break;
    }
    return probes;
  }
  /** One UDP (Linux default) or TCP SYN traceroute probe. */
  private probe(origin: DeviceState, destination: string, ttl: number, mode: 'udp' | 'tcp', port: number): { success: boolean; reason: string; reply?: Packet } {
    const source = this.sourceAddress(origin, destination);
    if (!source) return { success: false, reason: '送信元にできるIPアドレスがありません（UpでIPアドレスを持つポートがない）' };
    const sport = this.ephemeral(origin);
    const packet: Packet = mode === 'udp'
      ? { id: ++this.packetSequence, source, destination, ttl, protocol: 'UDP', sourcePort: sport, destinationPort: port }
      : { id: ++this.packetSequence, source, destination, ttl, protocol: 'TCP', sourcePort: sport, destinationPort: port, flags: ['SYN'], seq: this.isn(), ack: 0, window: 64240 };
    const out = this.deliver(origin, packet);
    if (!out.delivered) { const reply = this.bounce(out, origin); return { success: false, reason: out.reason, reply }; }
    const server = out.device; const got = out.packet as TcpPacket | UdpPacket;
    const svc = this.listening(server, got);
    let response: Packet;
    if (got.protocol === 'UDP') {
      if (svc) return { success: false, reason: `UDP ${port} で待ち受けているプロセスがあるため、ICMP Port Unreachable が返らず到達を確認できません` };
      const f = this.fail(server, got, `${server.id}: UDP ${port} で待ち受けがないため Port Unreachable を返します`, { type: 'unreachable', code: 3, source: got.destination });
      const reply = this.bounce(f, origin);
      return { success: !!reply, reason: reply ? '宛先に到達（Port Unreachable）' : '応答が戻りません', reply };
    }
    response = { id: ++this.packetSequence, source: got.destination, destination: got.source, ttl: 64, protocol: 'TCP', sourcePort: got.destinationPort, destinationPort: got.sourcePort,
      flags: svc ? ['SYN', 'ACK'] : ['RST', 'ACK'], seq: svc ? this.isn() : 0, ack: got.seq + 1, window: 64240 };
    const back = this.deliver(server, response);
    return back.delivered && back.device.id === origin.id ? { success: true, reason: svc ? '宛先に到達（SYN-ACK）' : '宛先に到達（RST）', reply: back.packet } : { success: false, reason: '応答が戻りません' };
  }

  // ---------------------------------------------------------------- L4 / services
  private listening(server: DeviceState, packet: TcpPacket | UdpPacket) {
    const proto = packet.protocol === 'TCP' ? 'tcp' : 'udp';
    const svc = server.services?.find(s => s.protocol === proto && s.port === packet.destinationPort);
    const ok = svc && svc.running && (svc.bind === '0.0.0.0' || svc.bind === packet.destination);
    this.event('SOCKET_LOOKUP', server, packet, ok ? `${proto}/${packet.destinationPort} を ${svc.name} が待ち受けています`
      : svc && !svc.running ? `${svc.name} は停止中です（${proto}/${packet.destinationPort} で待ち受けなし）。systemctl start ${svc.name} で起動します`
      : svc ? `${svc.name} は ${svc.bind} だけで待ち受けています。${packet.destination} 宛ては受け付けません（0.0.0.0 で待ち受けると全アドレスで受け付けます）`
      : `${proto}/${packet.destinationPort} で待ち受けているプロセスがありません（ポート番号の誤り、またはサービス未設定）`);
    return ok ? svc : undefined;
  }
  private udpExchange(origin: DeviceState, destination: string, port: number, payload: AppPayload): { response?: UdpPacket; icmp?: IcmpPacket; reason: string } {
    const source = this.sourceAddress(origin, destination);
    if (!source) return { reason: '送信元にできるIPアドレスがありません（UpでIPアドレスを持つポートがない）' };
    const packet: UdpPacket = { id: ++this.packetSequence, source, destination, ttl: 64, protocol: 'UDP', sourcePort: this.ephemeral(origin), destinationPort: port, payload };
    const out = this.deliver(origin, packet);
    if (!out.delivered) { const icmp = this.bounce(out, origin); return { icmp, reason: icmp ? `ICMP ${icmpText(icmp)}（${icmp.source}）` : out.reason }; }
    const server = out.device; const got = out.packet as UdpPacket;
    const svc = this.listening(server, got);
    if (!svc) {
      const f = this.fail(server, got, `${server.id}: UDP ${port} で待ち受けがありません（Port Unreachable）`, { type: 'unreachable', code: 3, source: got.destination });
      const icmp = this.bounce(f, origin);
      return { icmp, reason: `ICMP Port unreachable（${got.destination}:${port}）` };
    }
    const reply = svc.app === 'dns' && got.payload?.kind === 'dns' ? { kind: 'dns' as const, message: this.dnsServe(server, got.payload.message, got.source) }
      : got.payload?.kind === 'data' ? { kind: 'data' as const, text: got.payload.text } : undefined;
    if (!reply) return { reason: '応答がありません' };
    const response: UdpPacket = { id: ++this.packetSequence, source: got.destination, destination: got.source, ttl: 64, protocol: 'UDP', sourcePort: got.destinationPort, destinationPort: got.sourcePort, payload: reply };
    const back = this.deliver(server, response);
    if (!back.delivered || back.device.id !== origin.id) return { reason: `応答が戻りません（${back.delivered ? back.device.id : back.reason}）` };
    return { response: back.packet as UdpPacket, reason: 'ok' };
  }

  // ---------------------------------------------------------------- DNS
  private dnsId = 0x1a2b;
  private dnsServe(server: DeviceState, query: DnsMessage, client: string): DnsMessage {
    const cfg = server.dnsServer;
    const q = query.question;
    const base: DnsMessage = { id: query.id, response: true, opcode: 0, aa: false, rd: query.rd, ra: !!cfg?.recursive, rcode: 'NOERROR', question: q, answer: [], authority: [], additional: [] };
    if (!cfg) return { ...base, rcode: 'REFUSED' };
    const auth = authoritativeAnswer(cfg.zones, q);
    const mayRecurse = cfg.recursive && query.rd && (!cfg.allowRecursion?.length || cfg.allowRecursion.some(c => contains(c, client)));
    if (auth && (auth.aa || !mayRecurse)) {
      this.event('DNS_RESPONSE', server, undefined, auth.aa ? `${server.id}: 権威サーバーとして応答（${auth.rcode}${auth.answer.length ? `: ${auth.answer.map(r => `${r.type} ${r.value}`).join(', ')}` : ''}）`
        : `${server.id}: ${auth.authority[0]?.name} は別の権威サーバーに委任済み。そのNSレコードを返し、次に聞く相手を教えます（referral）`, { peer: client });
      return { ...base, ...auth };
    }
    if (!mayRecurse) {
      this.event('DNS_RESPONSE', server, undefined, `${server.id}: ${cfg.recursive ? 'このクライアントには再帰問い合わせを許可していない' : '自分が権威を持たない名前で、再帰問い合わせも無効'}ため REFUSED（拒否）`, { peer: client });
      return { ...base, rcode: 'REFUSED' };
    }
    const result = resolveIterative(q, cfg.rootHints, {
      now: () => this.time, cache: server.dnsCache ??= [],
      query: (ip, question) => this.dnsAsk(server, ip, question, false),
    });
    for (const s of result.steps.filter(s => s.result === 'cache')) this.event('DNS_CACHE', server, undefined, `${server.id}: ${s.question.name} ${s.question.type} — ${s.detail}`, { peer: client });
    this.event('DNS_RESPONSE', server, undefined, `${server.id}: 再帰解決の結果を返します（${result.rcode}${result.answer.length ? `: ${result.answer.map(r => `${r.type} ${r.value}`).join(', ')}` : ''}）`, { peer: client });
    return { ...base, ra: true, rcode: result.rcode, answer: result.answer, authority: result.authority };
  }
  private dnsAsk(from: DeviceState, server: string, question: DnsQuestion, rd: boolean): DnsMessage | undefined {
    this.dnsId = (this.dnsId * 75 + 74) % 65537 & 0xffff;
    const message: DnsMessage = { id: this.dnsId, response: false, opcode: 0, aa: false, rd, ra: false, rcode: 'NOERROR', question, answer: [], authority: [], additional: [] };
    this.event('DNS_QUERY', from, undefined, `${from.id} → ${server}: ${question.name} ${question.type} ?${rd ? '（再帰要求 RD=1: 最終的な答えまで調べてほしい）' : '（反復問い合わせ RD=0: 知っている範囲で答えてほしい）'}`, { peer: server });
    const r = this.udpExchange(from, server, 53, { kind: 'dns', message });
    const m = r.response?.payload?.kind === 'dns' ? r.response.payload.message : undefined;
    if (!m) { this.event('DNS_RESPONSE', from, undefined, `${server} から応答がありません（${r.reason}）。タイムアウトまで待ち、次のサーバーがあればそちらへ問い合わせます`, { peer: server }); this.advanceTime(1000); }
    return m;
  }
  /** Stub resolver (`dig` / `nslookup`). `trace` iterates from the root like `dig +trace`. */
  dnsLookup(id: string, name: string, type: DnsType = 'A', opts: { server?: string; recurse?: boolean; trace?: boolean } = {}): DnsLookupResult {
    const origin = this.mutableDevice(id);
    const q = { name: normalizeName(name), type };
    const start = this.begin();
    const servers = opts.server ? [opts.server] : origin.dnsServers ?? [];
    if (opts.server) ipv4(opts.server);
    if (!servers.length) return this.finish({ success: false, reason: 'DNSサーバーが設定されていません（/etc/resolv.conf に nameserver がありません）', steps: [] }, start);
    if (opts.trace) {
      const root = this.dnsAsk(origin, servers[0], { name: '.', type: 'NS' }, true);
      const rootIps = (root?.answer ?? []).filter(r => r.type === 'NS').flatMap(ns => {
        const glue = root!.additional.find(a => a.type === 'A' && a.name === ns.value);
        if (glue) return [glue.value];
        const a = this.dnsAsk(origin, servers[0], { name: ns.value, type: 'A' }, true);
        return a?.answer.filter(x => x.type === 'A').map(x => x.value) ?? [];
      });
      if (!rootIps.length) return this.finish({ success: false, reason: 'ルートサーバーの情報を取得できません', steps: [] }, start);
      const result = resolveIterative(q, rootIps, { now: () => this.time, query: (ip, question) => this.dnsAsk(origin, ip, question, false) });
      const message: DnsMessage = { id: 0, response: true, opcode: 0, aa: true, rd: false, ra: false, rcode: result.rcode, question: q, answer: result.answer, authority: result.authority, additional: [] };
      return this.finish({ success: result.rcode === 'NOERROR' && result.answer.length > 0, reason: result.rcode, message, steps: result.steps }, start);
    }
    for (const server of servers) {
      const message = this.dnsAsk(origin, server, q, opts.recurse ?? true);
      if (message) return this.finish({ success: message.rcode === 'NOERROR' && message.answer.length > 0, reason: message.rcode, message, server, steps: [] }, start);
    }
    return this.finish({ success: false, reason: `connection timed out; no servers could be reached（${servers.join(', ')}）`, steps: [] }, start);
  }
  private resolveHost(origin: DeviceState, host: string): { address?: string; detail: string } {
    if (isIpv4(host)) return { address: host, detail: 'IPアドレス指定のためDNSは使用しません' };
    if (/^localhost\.?$/i.test(host)) return { address: '127.0.0.1', detail: 'localhost' };
    const servers = origin.dnsServers ?? [];
    if (!servers.length) return { detail: 'DNSサーバーが設定されていません（/etc/resolv.conf）' };
    const name = normalizeName(host);
    for (const server of servers) {
      const m = this.dnsAsk(origin, server, { name, type: 'A' }, true);
      if (!m) continue;
      const a = m.answer.find(r => r.type === 'A');
      if (a) return { address: a.value, detail: `${host} → ${a.value}（${server}）${m.answer.length > 1 ? ` 経由: ${m.answer.filter(r => r.type === 'CNAME').map(r => `CNAME ${r.value}`).join(', ')}` : ''}` };
      return { detail: `${m.rcode === 'NXDOMAIN' ? 'NXDOMAIN（名前が存在しません）' : m.rcode === 'NOERROR' ? 'Aレコードがありません（NODATA）' : m.rcode}（${server}）` };
    }
    return { detail: `DNSサーバー ${servers.join(', ')} から応答がありません` };
  }

  // ---------------------------------------------------------------- TCP
  private segment(v: View, flags: TcpFlag[], seq: number, ack: number, payload?: AppPayload): TcpPacket {
    return { id: ++this.packetSequence, source: v.local, destination: v.remote, ttl: 64, protocol: 'TCP', sourcePort: v.localPort, destinationPort: v.remotePort, flags, seq: seq >>> 0, ack: ack >>> 0, window: 64240, ...(payload ? { payload } : {}) };
  }
  private tcpOpen(origin: DeviceState, destination: string, port: number): TcpConn | { error: string; refused?: boolean } {
    const source = this.sourceAddress(origin, destination);
    if (!source) return { error: '送信元にできるIPアドレスがありません（UpでIPアドレスを持つポートがない）' };
    const clientView: View = { local: source, localPort: this.ephemeral(origin), remote: destination, remotePort: port };
    const cseq = this.isn();
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) { this.event('TCP_RETRANSMIT', origin, undefined, `応答がないため SYN を再送します（${attempt}回目、待ち時間 ${2 ** (attempt - 1)}秒）`); this.advanceTime(1000 * 2 ** (attempt - 1)); }
      this.event('TCP_STATE', origin, undefined, `${origin.id}: SYN_SENT（${source}:${clientView.localPort} → ${destination}:${port}。SYNを送り、SYN-ACKを待ちます）`);
      const out = this.deliver(origin, this.segment(clientView, ['SYN'], cseq, 0));
      if (!out.delivered) {
        const icmp = this.bounce(out, origin);
        // Linux maps ICMP errors to connect() errors: port unreachable → ECONNREFUSED, net → ENETUNREACH, others → EHOSTUNREACH.
        if (icmp) return { error: `${icmp.type === 'unreachable' && icmp.code === 3 ? 'Connection refused' : icmp.type === 'unreachable' && icmp.code === 0 ? 'Network is unreachable' : 'No route to host'}（ICMP ${icmpText(icmp)} from ${icmp.source}）`, refused: icmp.code === 3 };
        continue;
      }
      const server = out.device; const got = out.packet as TcpPacket;
      const svc = this.listening(server, got);
      const serverView: View = { local: got.destination, localPort: got.destinationPort, remote: got.source, remotePort: got.sourcePort };
      if (!svc) {
        const back = this.deliver(server, this.segment(serverView, ['RST', 'ACK'], 0, got.seq + 1));
        return back.delivered ? { error: 'Connection refused（RSTを受信）', refused: true } : { error: 'RSTが戻らずタイムアウト' };
      }
      const sseq = this.isn();
      this.event('TCP_STATE', server, undefined, `${server.id}: LISTEN → SYN_RECEIVED（SYNを受け取り、SYN-ACKを返します）`);
      const back = this.deliver(server, this.segment(serverView, ['SYN', 'ACK'], sseq, got.seq + 1));
      if (!back.delivered || back.device.id !== origin.id) continue;
      this.event('TCP_STATE', origin, undefined, `${origin.id}: SYN_SENT → ESTABLISHED（SYN-ACKを受信し、ACKを返します）`);
      const ack = this.deliver(origin, this.segment(clientView, ['ACK'], cseq + 1, sseq + 1));
      if (!ack.delivered) return { error: '3-way handshake の最後のACKが届きません' };
      this.event('TCP_STATE', server, undefined, `${server.id}: SYN_RECEIVED → ESTABLISHED（3-way handshake 完了）`);
      origin.sockets = [...(origin.sockets ?? []), { protocol: 'tcp' as const, local: `${source}:${clientView.localPort}`, remote: `${destination}:${port}`, state: 'ESTAB', expiresAt: this.time + 60_000 }].slice(-50);
      return { client: origin, server, service: svc, clientView, serverView, clientSeq: cseq + 1, serverSeq: sseq + 1 };
    }
    return { error: 'Connection timed out（SYNに応答がありません。途中のFirewallで破棄されたか、行きか帰りの経路に問題がある可能性）' };
  }
  /** Request/response over an established connection. Returns the server's payload (or undefined). */
  private tcpExchange(c: TcpConn, request: AppPayload, respond: (req: AppPayload) => AppPayload | undefined): AppPayload | undefined {
    const req = this.segment(c.clientView, ['PSH', 'ACK'], c.clientSeq, c.serverSeq, request);
    c.clientSeq += encodePayload(request, req.id).length;
    const out = this.deliver(c.client, req);
    if (!out.delivered) return undefined;
    const reply = respond(request);
    this.event('APP_DATA', c.server, undefined, `${c.server.id}（${c.service.name}）がデータを受信し、${reply ? '応答します' : '応答しません'}`);
    if (!reply) { this.deliver(c.server, this.segment(c.serverView, ['ACK'], c.serverSeq, c.clientSeq)); return undefined; }
    const seg = this.segment(c.serverView, ['PSH', 'ACK'], c.serverSeq, c.clientSeq, reply);
    c.serverSeq += encodePayload(reply, seg.id).length;
    const back = this.deliver(c.server, seg);
    if (!back.delivered) return undefined;
    this.deliver(c.client, this.segment(c.clientView, ['ACK'], c.clientSeq, c.serverSeq));
    return (back.packet as TcpPacket).payload;
  }
  private tcpClose(c: TcpConn) {
    this.event('TCP_STATE', c.client, undefined, `${c.client.id}: ESTABLISHED → FIN_WAIT_1（接続を閉じます）`);
    this.deliver(c.client, this.segment(c.clientView, ['FIN', 'ACK'], c.clientSeq, c.serverSeq));
    this.deliver(c.server, this.segment(c.serverView, ['FIN', 'ACK'], c.serverSeq, c.clientSeq + 1));
    this.deliver(c.client, this.segment(c.clientView, ['ACK'], c.clientSeq + 1, c.serverSeq + 1));
    this.event('TCP_STATE', c.client, undefined, `${c.client.id}: TIME_WAIT（遅れて届くパケットに備えて一定時間（2MSL）待ってから CLOSED）`);
    const local = `${c.clientView.local}:${c.clientView.localPort}`;
    c.client.sockets = (c.client.sockets ?? []).map(s => s.local === local ? { ...s, state: 'TIME-WAIT' } : s);
  }
  /** `nc -zv host port`: TCP connect check. */
  tcpConnect(id: string, destination: string, port: number): TcpResult {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('ポートは1〜65535です');
    const origin = this.mutableDevice(id);
    const start = this.begin();
    const r = this.resolveHost(origin, destination);
    if (!r.address) return this.finish({ success: false, reason: `名前解決に失敗: ${r.detail}` }, start);
    const conn = this.tcpOpen(origin, r.address, port);
    if ('error' in conn) return this.finish({ success: false, reason: conn.error, refused: conn.refused }, start);
    this.tcpClose(conn);
    return this.finish({ success: true, reason: `Connection to ${r.address} ${port} port [tcp] succeeded!` }, start);
  }
  /** `curl`: DNS → TCP → (TLS) → HTTP, each step through the simulated network. */
  http(id: string, url: string, opts: { insecure?: boolean; head?: boolean } = {}): HttpResult {
    const origin = this.mutableDevice(id);
    const m = /^(https?):\/\/([a-zA-Z0-9.-]+)(?::(\d{1,5}))?(\/[^\s]*)?$/.exec(url);
    if (!m) throw new Error('URLは http(s)://ホスト[:ポート]/パス の形式です（例: https://www.example.com/）');
    const [, scheme, host, portText, path = '/'] = m;
    const port = portText ? Number(portText) : scheme === 'https' ? 443 : 80;
    if (port < 1 || port > 65535) throw new Error('ポートは1〜65535です');
    const start = this.begin();
    const stages: HttpStage[] = [];
    const done = (reason: string, extra: Partial<HttpResult> = {}) => this.finish({ success: false, reason, stages, ...extra }, start);
    const resolved = this.resolveHost(origin, host);
    stages.push({ layer: 'DNS', ok: !!resolved.address, detail: resolved.detail });
    if (!resolved.address) return done(`Could not resolve host: ${host}（${resolved.detail}）`);
    const conn = this.tcpOpen(origin, resolved.address, port);
    if ('error' in conn) { stages.push({ layer: 'TCP', ok: false, detail: conn.error }); return done(`Failed to connect to ${host} port ${port}: ${conn.error}`, { address: resolved.address }); }
    stages.push({ layer: 'TCP', ok: true, detail: `${resolved.address}:${port} へ3-way handshake完了` });
    const svc = conn.service;
    if (scheme === 'https') {
      this.event('TLS_HANDSHAKE', origin, undefined, `ClientHello（SNI: ${host}＝接続したいホスト名）を送信`);
      const hello = this.tcpExchange(conn, { kind: 'tls', record: 'client-hello', sni: host, detail: `ClientHello SNI=${host}` },
        () => svc.app === 'https' && svc.tls ? { kind: 'tls', record: 'server-hello', detail: `ServerHello + Certificate(${svc.tls.names.join(', ')})` } : { kind: 'data', text: 'HTTP/1.1 400 Bad Request\r\n\r\n' });
      if (!hello) { stages.push({ layer: 'TLS', ok: false, detail: 'サーバーから応答がありません' }); return done('TLS handshake timed out', { address: resolved.address }); }
      if (hello.kind !== 'tls') { stages.push({ layer: 'TLS', ok: false, detail: 'サーバーがTLSではなく平文で応答しました（HTTPS用でないポート）' }); this.tcpClose(conn); return done('SSL routines::wrong version number', { address: resolved.address }); }
      const tls = svc.tls!;
      const name = host.toLowerCase();
      const nameOk = tls.names.some(n => (n = n.toLowerCase()) === name || (n.startsWith('*.') && name.split('.').slice(1).join('.') === n.slice(2) && name.split('.').length > 2));
      const problem = !nameOk ? `証明書の名前（${tls.names.join(', ')}）が ${host} と一致しません` : tls.expired ? '証明書の有効期限が切れています' : tls.selfSigned && !opts.insecure ? '自己署名証明書で、信頼できる認証局が発行していません' : undefined;
      if (problem) {
        if (!opts.insecure) {
          this.event('TLS_HANDSHAKE', origin, undefined, `証明書の検証に失敗: ${problem}。Alertを送信して切断します`);
          this.tcpExchange(conn, { kind: 'tls', record: 'alert', detail: 'Alert: bad_certificate' }, () => undefined);
          this.tcpClose(conn);
          stages.push({ layer: 'TLS', ok: false, detail: problem });
          return done(`SSL certificate problem: ${problem}`, { address: resolved.address });
        }
        this.event('TLS_HANDSHAKE', origin, undefined, `証明書の問題（${problem}）を -k により無視して続行します（検証を省くため、確認用に限ります）`);
      } else this.event('TLS_HANDSHAKE', origin, undefined, '証明書を検証: 名前・有効期限・発行者 OK。以降の通信は暗号化されます');
      stages.push({ layer: 'TLS', ok: true, detail: problem ? `検証を無視（-k）: ${problem}` : 'TLS 1.3 ハンドシェイク完了' });
    }
    const request = `${opts.head ? 'HEAD' : 'GET'} ${path} HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: curl/8 (PATH simulator)\r\nAccept: */*\r\n\r\n`;
    // Plain HTTP to a TLS port: nginx answers 400 instead of the page.
    const response = this.httpResponse(conn.server, scheme === 'http' && svc.app === 'https' ? { ...svc, http: { status: 400, body: '<h1>400 Bad Request</h1>The plain HTTP request was sent to HTTPS port' } } : svc, request, !!opts.head);
    const payload: AppPayload = scheme === 'https' ? { kind: 'tls', record: 'encrypted', detail: request } : { kind: 'http', text: request };
    const reply = this.tcpExchange(conn, payload, () => svc.app === 'http' || svc.app === 'https'
      ? (scheme === 'https' ? { kind: 'tls', record: 'encrypted', detail: response } : { kind: 'http', text: response })
      : svc.app === 'ssh' ? { kind: 'data', text: 'SSH-2.0-OpenSSH_9.6 (PATH simulated)\r\n' } : undefined);
    if (!reply) { stages.push({ layer: 'HTTP', ok: false, detail: 'HTTP応答がありません' }); this.tcpClose(conn); return done('Empty reply from server', { address: resolved.address }); }
    const text = reply.kind === 'http' || reply.kind === 'data' ? reply.text : reply.kind === 'tls' ? reply.detail : '';
    this.tcpClose(conn);
    const status = Number(/^HTTP\/1\.1 (\d{3})/.exec(text)?.[1]);
    if (!status) { stages.push({ layer: 'HTTP', ok: false, detail: `HTTPではない応答: ${text.split('\r\n')[0]}` }); return done('Received HTTP/0.9 when not allowed', { address: resolved.address }); }
    const [headers, body = ''] = text.split('\r\n\r\n');
    stages.push({ layer: 'HTTP', ok: status < 400, detail: headers.split('\r\n')[0] });
    return this.finish({ success: status < 400, reason: headers.split('\r\n')[0], status, headers, body, stages, address: resolved.address }, start);
  }
  private httpResponse(server: DeviceState, svc: ServiceConfig, _request: string, head: boolean) {
    const status = svc.http?.status ?? 200;
    const body = svc.http?.body ?? `<h1>${server.id}</h1>`;
    const reason = ({ 200: 'OK', 301: 'Moved Permanently', 400: 'Bad Request', 403: 'Forbidden', 404: 'Not Found', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable' } as Record<number, string>)[status] ?? 'Status';
    const length = new TextEncoder().encode(body).length;
    return `HTTP/1.1 ${status} ${reason}\r\nServer: path-sim\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${length}\r\nConnection: close\r\n\r\n${head ? '' : body}`;
  }
  /** Listening sockets + recent connections for `ss`. */
  sockets(id: string) {
    const d = this.mutableDevice(id);
    const listening = (d.services ?? []).filter(s => s.running).map(s => ({ protocol: s.protocol, local: `${s.bind}:${s.port}`, remote: '*:*', state: s.protocol === 'tcp' ? 'LISTEN' : 'UNCONN', process: s.name }));
    return [...listening, ...(d.sockets ?? []).filter(s => s.expiresAt > this.time).map(s => ({ ...s, process: '' }))];
  }
}

// ---------------------------------------------------------------- device factory
const portCount: Record<DeviceKind, number> = { pc: 1, server: 1, router: 3, switch: 8, l3switch: 8, firewall: 3, internet: 3 };
export function createDevice(id: string, kind: DeviceKind, ordinal: number, position = { x: 80, y: 120 }): DeviceState {
  const switching = switchingKinds.includes(kind);
  const device: DeviceState = { id, kind, position, routes: [], arp: [], interfaces: Array.from({ length: portCount[kind] }, (_, i) => ({
    id: hostKinds.includes(kind) ? `eth${i}` : switching ? `g0/${i + 1}` : `g0/${i}`, up: true,
    mac: `02:00:${hex2(ordinal >>> 8)}:${hex2(ordinal)}:00:${hex2(i + 1)}`,
    ...(switching ? { switchport: defaultSwitchport() } : {}),
  })) };
  if (switching) { device.vlans = []; device.stp = { enabled: true, priority: 32768 }; }
  if (kind === 'firewall') device.firewall = { stateful: true, defaultAction: 'deny', rules: [] };
  return device;
}
/** MAC for a new logical interface (SVI / loopback / tunnel), derived from the device's base MAC. */
export function logicalMac(device: DeviceState, group: number, index: number) {
  const base = device.interfaces[0].mac.split(':').slice(0, 4).join(':');
  return `${base}:${hex2(group | (index >>> 8))}:${hex2(index)}`;
}
