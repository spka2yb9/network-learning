import { NetworkSimulator } from '../simulator/core/NetworkSimulator';
import { hostKinds, type Capture, type DeviceState, type OperationResult } from '../simulator/core/types';
import { packetFilter } from '../simulator/capture/PacketFilter';
import { CommandRegistry, commandHelp } from './CommandRegistry';
import { options, parseCommand } from './CommandParser';
import { iosCommand } from './ios';
import { linuxCommand } from './linux';

export type Mode = 'user' | 'privileged' | 'config' | 'interface' | 'vlan' | 'router-ospf' | 'router-bgp' | 'acl';
export interface Session { mode: Mode; iface?: string; vlan?: number; acl?: string }
export interface Context { id: string; tokens: string[]; session: Session; device: DeviceState; network: NetworkSimulator; cli: CliEngine }

/** Last operation shown in the Packet Debugger / Event Log. */
export type DebugResult = OperationResult & { title?: string };

export class CliEngine {
  private sessions = new Map<string, Session>();
  private registry = new CommandRegistry<Context>();
  lastResult?: DebugResult;
  captures: Capture[] = [];
  /** When false (troubleshooting labs), outputs stay realistic and do not include the simulator's diagnosis. */
  explain = true;
  constructor(public network: NetworkSimulator) {
    this.registry.register(c => c.tokens[0] === 'help' || c.tokens[0] === '?', c => commandHelp(hostKinds.includes(c.device.kind) ? 'linux' : 'ios', c.device.kind));
    this.registry.register(c => c.tokens[0] === 'tcpdump', c => this.tcpdump(c));
    this.registry.register(c => hostKinds.includes(c.device.kind), linuxCommand);
    this.registry.register(() => true, iosCommand);
  }
  /** Record a simulator operation for the Debugger and the capture buffer. Multiple calls in one command are merged. */
  record(result: OperationResult, title?: string) {
    this.captures = [...this.captures, ...result.captures].slice(-3000);
    if (!this.lastResult) this.lastResult = { ...result, title };
    else this.lastResult = { ...result, title: this.lastResult.title ?? title, events: [...this.lastResult.events, ...result.events], captures: [...this.lastResult.captures, ...result.captures], elapsed: this.lastResult.elapsed + result.elapsed };
  }
  session(id: string) {
    this.network.device(id);
    if (!this.sessions.has(id)) this.sessions.set(id, { mode: 'user' });
    return this.sessions.get(id)!;
  }
  prompt(id: string) {
    const d = this.network.device(id);
    if (hostKinds.includes(d.kind)) return `user@${id}:~$`;
    const s = this.session(id);
    return id + ({ user: '>', privileged: '#', config: '(config)#', interface: '(config-if)#', vlan: '(config-vlan)#', 'router-ospf': '(config-router)#', 'router-bgp': '(config-router)#', acl: '(config-ext-nacl)#' }[s.mode]);
  }
  execute(id: string, input: string) {
    this.lastResult = undefined;
    try {
      let tokens = parseCommand(input);
      if (tokens[0] === 'sudo') tokens = tokens.slice(1);
      if (!tokens.length) return '';
      return this.registry.execute({ id, tokens, session: this.session(id), device: this.network.device(id), network: this.network, cli: this });
    } catch (error) { return `% ${error instanceof Error ? error.message : String(error)}`; }
  }
  private tcpdump({ id, tokens, device }: Context) {
    const { flags, values, rest } = options(tokens.slice(1), ['-i', '-c']);
    const own = this.network.snapshot().links.filter(l => l.sourceDevice === id || l.targetDevice === id);
    const iface = values.get('-i');
    if (iface && iface !== 'any' && !device.interfaces.some(i => i.id === iface)) throw new Error(`tcpdump: ${iface}: そのインターフェースはありません（インターフェース名を確認してください）`);
    const filter = packetFilter(rest.join(' '));
    const rows = this.captures.flatMap(c => {
      const link = own.find(l => l.id === c.linkId);
      return link ? [{ ...c, interfaceId: link.sourceDevice === id ? link.sourceInterface : link.targetInterface }] : [];
    }).filter(c => (!iface || iface === 'any' || c.interfaceId === iface || device.interfaces.some(i => i.parent === iface && i.id === c.interfaceId)) && filter(c));
    const count = values.has('-c') ? Number(values.get('-c')) : 100;
    if (!Number.isInteger(count) || count < 1) throw new Error(`tcpdump: invalid packet count ${values.get('-c')}（-c には1以上の整数を指定します）`);
    const header = `tcpdump: listening on ${iface ?? 'any'}（保存済みCaptureの再生: この機器のリンクを通過したフレーム）`;
    if (!rows.length) return `${header}\n一致するフレームはありません。先に ping / curl / dig などで通信を実行してください。`;
    const port = (p?: number) => p === undefined ? '' : `.${p}`;
    return [header, ...rows.slice(-count).map(c => `${(c.time / 1000).toFixed(6)} ${c.interfaceId} ${flags.has('-e') ? `${c.sourceMac} > ${c.destinationMac}${c.vlan !== undefined ? ` vlan ${c.vlan}` : ''}, ` : ''}${c.protocol === 'ARP' ? 'ARP' : 'IP'} ${c.source}${port(c.sourcePort)} > ${c.destination}${port(c.destinationPort)}: ${c.protocol} ${c.info}`),
      `${Math.min(rows.length, count)} packets captured`].join('\n');
  }
}
