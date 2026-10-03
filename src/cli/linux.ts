import type { Context } from './CliEngine';
import { note, pad, ping, resolveName, speedText, traceroute } from './common';
import { options } from './CommandParser';
import type { DnsType, FilterRule } from '../simulator/core/types';
import { cidr, dotted, ipOf, ipv4, isIpv4 } from '../simulator/l3/ipv4';
import { installedRoutes, l3Up, resolveRoute, routingTable } from '../simulator/l3/RoutingTable';
import { toCidr } from './ios';
import { dnsTypes, formatRecord, reverseName } from '../simulator/services/Dns';
import { formatIptables } from '../simulator/services/FirewallEngine';
import { iperf } from '../simulator/scenarios/build';

const ANY = '0.0.0.0/0';
function linkState(ctx: Context, port: string) {
  const i = ctx.device.interfaces.find(x => x.id === port)!;
  const link = ctx.network.snapshot().links.find(l => (l.sourceDevice === ctx.id && l.sourceInterface === port) || (l.targetDevice === ctx.id && l.targetInterface === port));
  if (!i.up) return 'DOWN';
  if (!link || !link.up) return 'NO-CARRIER';
  const peer = link.sourceDevice === ctx.id ? [link.targetDevice, link.targetInterface] : [link.sourceDevice, link.sourceInterface];
  return ctx.network.device(peer[0]).interfaces.find(x => x.id === peer[1])?.up ? 'UP' : 'NO-CARRIER';
}
function ipAddr(ctx: Context, brief: boolean, onlyLink = false) {
  const rows = ctx.device.interfaces.filter(i => i.kind !== 'tunnel');
  if (brief) return ['lo               UNKNOWN        127.0.0.1/8', ...rows.map(i => `${pad(i.id, 16)} ${pad(linkState(ctx, i.id), 14)} ${onlyLink ? i.mac : i.address ?? ''}`)].join('\n');
  return ['1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 state UNKNOWN', '    link/loopback 00:00:00:00:00:00', ...(onlyLink ? [] : ['    inet 127.0.0.1/8 scope host lo']),
    ...rows.flatMap((i, n) => {
      const state = linkState(ctx, i.id);
      const flags = i.up ? (state === 'UP' ? 'BROADCAST,MULTICAST,UP,LOWER_UP' : 'NO-CARRIER,BROADCAST,MULTICAST,UP') : 'BROADCAST,MULTICAST';
      return [`${n + 2}: ${i.id}: <${flags}> mtu 1500 state ${state}`, `    link/ether ${i.mac} brd ff:ff:ff:ff:ff:ff`,
        ...(!onlyLink && i.address ? [`    inet ${i.address} brd ${dotted(cidr(i.address).broadcast)} scope global ${i.id}`] : [])];
    })].join('\n');
}
function ipRoute(ctx: Context) {
  const installed = installedRoutes(ctx.device);
  // A configured route whose gateway is unreachable is not installed (lookups skip it); list it with the note so the cause is visible.
  const routes = [...installed, ...routingTable(ctx.device).filter(r => r.kind === 'static' && !installed.some(o => o.destination === r.destination && o.nextHop === r.nextHop && o.interfaceId === r.interfaceId))];
  if (!routes.length) return '';
  return routes.sort((a, b) => cidr(b.destination).prefix - cidr(a.destination).prefix).map(r => {
    const dest = r.destination === ANY ? 'default' : r.destination;
    if (r.kind === 'connected') { const i = ctx.device.interfaces.find(x => x.id === r.interfaceId)!; return `${dest} dev ${i.id} proto kernel scope link src ${ipOf(i.address)}`; }
    const via = resolveRoute(ctx.device, r.nextHop ?? '0.0.0.0');
    return `${dest} via ${r.nextHop}${via ? ` dev ${via.iface.id}` : ''}${r.nextHop && !via ? ' （Next Hopに到達できません）' : ''}`;
  }).join('\n');
}
/** `iperf3 -c`: the educational capacity model (link speeds only), one line per parallel stream. */
function iperf3(ctx: Context, t: string[]): string {
  const { flags, values, rest } = options(t, ['-c', '-P', '-p', '-t']);
  if (flags.has('-s')) {
    if (!ctx.device.services?.some(s => s.port === 5201 && s.protocol === 'tcp' && s.running)) ctx.network.update(ctx.id, d => { d.services = [...(d.services ?? []).filter(s => !(s.port === 5201 && s.protocol === 'tcp')), iperf()]; });
    return '-----------------------------------------------------------\nServer listening on 5201（教育用: サービス iperf3 として待ち受けます。Ctrl+C不要）\n-----------------------------------------------------------';
  }
  const target = values.get('-c') ?? rest[0];
  if (!target) throw new Error('使い方: iperf3 -c <host> [-P 並列数] [-p port]（受け手で iperf3 -s を起動しておきます）');
  const ip = resolveName(ctx, target, 'iperf3');
  const parallel = Number(values.get('-P') ?? 1); const port = Number(values.get('-p') ?? 5201);
  if (!Number.isInteger(parallel) || parallel < 1 || parallel > 16) throw new Error('iperf3: -P は1〜16です');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('iperf3: -p は1〜65535です');
  const r = ctx.network.throughput(Array.from({ length: parallel }, () => ({ from: ctx.id, to: ip, port })));
  ctx.cli.record(r, `iperf3 -c ${target}${parallel > 1 ? ` -P ${parallel}` : ''}`);
  const failed = r.streams.find(x => !x.ok);
  if (failed) return `iperf3: error - unable to connect to server: ${failed.reason}${note(ctx, failed.reason)}`;
  const rate = (mbps: number) => mbps >= 1000 ? `${(mbps / 1000).toFixed(2)} Gbits/sec` : `${mbps.toFixed(0)} Mbits/sec`;
  const local = ipOf(resolveRoute(ctx.device, ip)?.iface.address) ?? '?';
  const slowest = (x: typeof r.streams[number]) => x.hops.reduce((a, h) => h.bandwidth < a.bandwidth ? h : a);
  return [`Connecting to host ${ip}, port ${port}`, ...r.streams.map((x, i) => `[${String(5 + i * 2).padStart(3)}] local ${local} port ${x.sourcePort} connected to ${ip} port ${port}`),
    '[ ID] Interval           Bitrate', ...r.streams.map((x, i) => `[${String(5 + i * 2).padStart(3)}]   0.00-10.00  sec  ${pad(rate(x.rate), 16)}${x.shared > 1 ? ` （${x.shared}本のストリームでリンクを共有）` : ''}`),
    ...(parallel > 1 ? [`[SUM]   0.00-10.00  sec  ${rate(r.total)}`] : []), '', 'iperf Done.'].join('\n')
    + note(ctx, `教育用の理論値: 経路上で最も遅いリンクの速度（同じリンクを使うストリームで均等に分けたもの）です。プロトコルのオーバーヘッド・輻輳・キューは含みません。${r.streams.map((x, i) => `ストリーム${i + 1}: ${x.hops.map(h => `${h.device} ${h.interfaceId}${h.lag ? `（${h.lag.id}のメンバー）` : ''} ${speedText(h.bandwidth)}`).join(' → ')}。ボトルネック ${slowest(x).device} ${slowest(x).interfaceId}`).join(' ／ ')}`);
}
function ethtool(ctx: Context, port: string | undefined) {
  const i = ctx.device.interfaces.find(x => x.id === port);
  if (!i) throw new Error(port ? `ethtool: ${port}: そのインターフェースはありません（例: ethtool eth0）` : '使い方: ethtool <インターフェース>（例: ethtool eth0）');
  const link = ctx.network.snapshot().links.find(l => (l.sourceDevice === ctx.id && l.sourceInterface === i.id) || (l.targetDevice === ctx.id && l.targetInterface === i.id));
  const up = linkState(ctx, i.id) === 'UP';
  return [`Settings for ${i.id}:`, `\tSpeed: ${up && link ? `${link.bandwidth}Mb/s` : 'Unknown!'}`, `\tDuplex: ${up ? 'Full' : 'Unknown! (255)'}`, `\tLink detected: ${up ? 'yes' : 'no'}`].join('\n')
    + note(ctx, link ? `このポートのリンク速度は ${speedText(link.bandwidth)}（教育用: 速度はリンク単位で持ち、媒体・オートネゴシエーションは再現しません）` : 'ケーブルが接続されていません');
}
function iptables(ctx: Context, t: string[]): string {
  const { flags, values, rest } = options(t, ['-A', '-I', '-D', '-P', '-p', '-s', '-d', '--dport', '--destination-port', '--sport', '--source-port', '-i', '-j', '-m', '--ctstate', '--state', '-t']);
  const policy = ctx.device.firewall ?? { stateful: false, defaultAction: 'permit' as const, rules: [] };
  if (values.get('-t') && values.get('-t') !== 'filter') throw new Error('iptables: 教育用サブセットでは filter テーブル（INPUT）のみ対応です。NATはルータで設定します');
  const chainArg = values.get('-A') ?? values.get('-I') ?? values.get('-D') ?? values.get('-P') ?? (flags.has('-F') ? rest[0] : undefined);
  if (chainArg && chainArg !== 'INPUT') throw new Error(`iptables: 教育用サブセットでは INPUT チェーンのみ対応です（${chainArg}）`);
  if (flags.has('-L') || flags.has('-S') || t.length === 0) {
    if (flags.has('-S')) return ['-P INPUT ' + (policy.defaultAction === 'permit' ? 'ACCEPT' : 'DROP'), ...policy.rules.map(r => formatIptables(r))].join('\n');
    const pt = (k: string, p?: [number, number]) => p ? ` ${k}${p[0] === p[1] ? `:${p[0]}` : `s:${p.join(':')}`}` : '';
    return [`Chain INPUT (policy ${policy.defaultAction === 'permit' ? 'ACCEPT' : 'DROP'})`, 'num  target     prot  source               destination',
      ...policy.rules.map((r, i) => `${pad(i + 1, 4)} ${pad(r.action === 'permit' ? 'ACCEPT' : r.action === 'deny' ? 'DROP' : 'REJECT', 10)} ${pad(r.protocol === 'ip' ? 'all' : r.protocol, 5)} ${pad(r.source, 20)} ${pad(r.destination, 20)}${r.sourcePort || r.destinationPort ? ` ${r.protocol}${pt('spt', r.sourcePort)}${pt('dpt', r.destinationPort)}` : ''}${r.established ? ' established' : ''}${r.ctState ? ` ctstate ${r.ctState.join(',').toUpperCase()}` : ''}${r.inInterface ? ` in:${r.inInterface}` : ''}${r.outInterface ? ` out:${r.outInterface}` : ''}`)].join('\n');
  }
  const commit = (rules: FilterRule[], defaultAction = policy.defaultAction) => ctx.network.update(ctx.id, d => { d.firewall = { stateful: false, defaultAction, rules: rules.map((r, i) => ({ ...r, seq: i + 1 })) }; });
  if (values.has('-P')) {
    const target = rest[0];
    if (target !== 'ACCEPT' && target !== 'DROP') throw new Error('iptables -P INPUT ACCEPT|DROP');
    commit(policy.rules, target === 'ACCEPT' ? 'permit' : 'deny'); return '';
  }
  if (flags.has('-F')) { commit([]); return ''; }
  if (values.has('-D')) {
    const n = Number(rest[0]);
    if (!Number.isInteger(n) || n < 1 || n > policy.rules.length) throw new Error('iptables: Index of deletion too big（iptables -L --line-numbers で番号を確認）');
    commit(policy.rules.filter((_, i) => i !== n - 1)); return '';
  }
  if (!values.has('-A') && !values.has('-I')) throw new Error('iptables: 対応オプション -L / -S / -A / -I / -D / -P / -F');
  // Anything left over would silently widen the rule (! -s, -m multiport --dports …): reject it. -I takes only the position.
  const extra = [...(values.has('-m') && !['conntrack', 'state', 'tcp', 'udp'].includes(values.get('-m')!) ? [`-m ${values.get('-m')}`] : []), ...flags, ...rest.filter((x, i) => !(values.has('-I') && i === 0 && /^[1-9]\d*$/.test(x)))];
  if (extra.length) throw new Error(`iptables: 未対応のオプション・引数です: ${extra.join(' ')}（教育用サブセット: -p / -s / -d / --dport / --sport / -i / -m conntrack --ctstate / -j）`);
  const target = values.get('-j');
  if (!target || !['ACCEPT', 'DROP', 'REJECT'].includes(target)) throw new Error('iptables: -j ACCEPT|DROP|REJECT が必要です');
  const protocol = (values.get('-p') ?? 'all') as FilterRule['protocol'] | 'all';
  if (!['all', 'tcp', 'udp', 'icmp'].includes(protocol)) throw new Error('iptables: -p tcp|udp|icmp');
  const port = (v?: string): [number, number] | undefined => {
    if (!v) return undefined;
    const [a, b = a] = v.split(':').map(Number);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b > 65535 || b < a) throw new Error(`iptables: ポートが不正です: ${v}`);
    return [a, b];
  };
  const rule: FilterRule = { seq: 0, action: target === 'ACCEPT' ? 'permit' : target === 'DROP' ? 'deny' : 'reject', protocol: protocol === 'all' ? 'ip' : protocol,
    source: values.has('-s') ? cidr(values.get('-s')!.includes('/') ? values.get('-s')! : `${values.get('-s')}/32`).canonical : ANY,
    destination: values.has('-d') ? cidr(values.get('-d')!.includes('/') ? values.get('-d')! : `${values.get('-d')}/32`).canonical : ANY };
  const dp = port(values.get('--dport') ?? values.get('--destination-port')); const sp = port(values.get('--sport') ?? values.get('--source-port'));
  if ((dp || sp) && rule.protocol !== 'tcp' && rule.protocol !== 'udp') throw new Error('iptables: --dport / --sport には -p tcp|udp が必要です');
  if (dp) rule.destinationPort = dp; if (sp) rule.sourcePort = sp;
  if (values.has('-i')) rule.inInterface = values.get('-i');
  const state = values.get('--ctstate') ?? values.get('--state');
  if (state) { rule.ctState = state.toLowerCase().split(',') as FilterRule['ctState']; if (!rule.ctState!.every(x => ['new', 'established', 'related'].includes(x))) throw new Error(`iptables: --ctstate は NEW / ESTABLISHED / RELATED です（${state}）`); }
  if (values.has('-A')) commit([...policy.rules, rule]);
  else { const at = Math.max(0, Math.min(policy.rules.length, (Number(rest[0]) || 1) - 1)); commit([...policy.rules.slice(0, at), rule, ...policy.rules.slice(at)]); }
  return '';
}
function nft(ctx: Context) {
  const p = ctx.device.firewall;
  if (!p) return 'table inet filter {\n  chain input {\n    type filter hook input priority filter; policy accept;\n  }\n}';
  const pt = (k: string, x?: [number, number]) => x ? `${k} ${x[0] === x[1] ? x[0] : x.join('-')}` : '';
  const line = (r: FilterRule) => [r.inInterface ? `iifname "${r.inInterface}"` : '', r.outInterface ? `oifname "${r.outInterface}"` : '', r.protocol !== 'ip' ? `meta l4proto ${r.protocol}` : '', r.source !== ANY ? `ip saddr ${r.source}` : '', r.destination !== ANY ? `ip daddr ${r.destination}` : '',
    pt(`${r.protocol} sport`, r.sourcePort), pt(`${r.protocol} dport`, r.destinationPort), r.established ? 'tcp flags & (ack | rst) != 0' : '',
    r.ctState ? `ct state ${r.ctState.join(',')}` : '', r.action === 'permit' ? 'accept' : r.action === 'deny' ? 'drop' : 'reject'].filter(Boolean).join(' ');
  return ['table inet filter {', '  chain input {', `    type filter hook input priority filter; policy ${p.defaultAction === 'permit' ? 'accept' : 'drop'};`, ...p.rules.map(r => `    ${line(r)}`), '  }', '}'].join('\n');
}
/** dig / nslookup: a server answering with ICMP Port Unreachable is "connection refused", not a timeout. */
const noServer = (reason: string, timeout: string) => reason.includes('connection refused') ? reason.split('; ').map(l => `;; ${l}`).join('\n') : timeout;
function dig(ctx: Context, t: string[]) {
  let server: string | undefined; let type: DnsType = 'A'; let name = ''; const plus = new Set<string>(); let reverse = false;
  for (let i = 0; i < t.length; i++) {
    const x = t[i];
    if (x.startsWith('@')) { server = x.slice(1); ipv4(server); }
    else if (x.startsWith('+')) plus.add(x);
    else if (x === '-x') { reverse = true; name = reverseName(t[++i] ?? ''); type = 'PTR'; }
    else if (x === '-t') { type = (t[++i] ?? '').toUpperCase() as DnsType; if (!dnsTypes.includes(type)) throw new Error(`dig: 未対応のタイプです: ${t[i] ?? ''}`); }
    else if (dnsTypes.includes(x.toUpperCase() as DnsType) && name) type = x.toUpperCase() as DnsType;
    else if (!name) name = x;
    else throw new Error(`dig: 解釈できない引数です: ${x}`);
  }
  if (!name) throw new Error('使い方: dig [@server] <name> [type] [+short] [+trace]');
  const r = ctx.network.dnsLookup(ctx.id, name, type, { server, trace: plus.has('+trace'), recurse: !plus.has('+norecurse') && !plus.has('+norec') });
  ctx.cli.record(r, `dig ${name} ${type}`);
  const m = r.message;
  if (plus.has('+trace')) {
    return [`; <<>> DiG (PATH simulator) <<>> ${name} ${type} +trace`, ...r.steps.map(s => `;; ${s.result === 'referral' ? 'Referral' : s.result === 'answer' ? 'Answer' : s.result.toUpperCase()} from ${s.server}（${s.zone ?? '.'} の権威）: ${s.detail}`),
      ...(m?.answer ?? []).map(a => formatRecord(a)), r.success ? '' : `;; 解決できませんでした: ${r.reason}`].join('\n');
  }
  if (!m) return `${noServer(r.reason, ';; communications error: timed out\n;; no servers could be reached')}${note(ctx, r.reason)}`;
  if (plus.has('+short')) return m.answer.map(a => a.type === 'TXT' ? `"${a.value}"` : a.value).join('\n');
  const flags = ['qr', m.aa && 'aa', m.rd && 'rd', m.ra && 'ra'].filter(Boolean).join(' ');
  const section = (title: string, list: typeof m.answer) => list.length ? ['', `;; ${title} SECTION:`, ...list.map(a => formatRecord(a))] : [];
  return [`; <<>> DiG (PATH simulator) <<>> ${server ? `@${server} ` : ''}${reverse ? `-x ${t[t.indexOf('-x') + 1]}` : `${name} ${type}`}`, ';; Got answer:',
    `;; ->>HEADER<<- opcode: QUERY, status: ${m.rcode}, id: ${m.id}`, `;; flags: ${flags}; QUERY: 1, ANSWER: ${m.answer.length}, AUTHORITY: ${m.authority.length}, ADDITIONAL: ${m.additional.length}`,
    ...(m.rd && !m.ra ? [';; WARNING: recursion requested but not available'] : []),
    '', ';; QUESTION SECTION:', `;${m.question.name.padEnd(23)}         IN  ${m.question.type}`,
    ...section('ANSWER', m.answer), ...section('AUTHORITY', m.authority), ...section('ADDITIONAL', m.additional),
    '', `;; Query time: ${r.elapsed} msec（仮想時間）`, `;; SERVER: ${r.server}#53(${r.server}) (UDP)`].join('\n');
}
function nslookup(ctx: Context, t: string[]) {
  const [name, server] = t;
  if (!name) throw new Error('使い方: nslookup <name> [server]');
  const ptr = isIpv4(name);
  const r = ctx.network.dnsLookup(ctx.id, ptr ? reverseName(name) : name, ptr ? 'PTR' : 'A', { server });
  ctx.cli.record(r, `nslookup ${name}`);
  const m = r.message;
  if (!m) return `${noServer(r.reason, ';; connection timed out; no servers could be reached')}${note(ctx, r.reason)}`;
  const head = [`Server:\t\t${r.server}`, `Address:\t${r.server}#53`, ''];
  if (m.rcode !== 'NOERROR') return [...head, `** server can't find ${name}: ${m.rcode}`].join('\n');
  if (!m.answer.length) return [...head, `*** Can't find ${name}: No answer`].join('\n');
  return [...head, ...(m.aa ? [] : ['Non-authoritative answer:']), ...m.answer.map(a => a.type === 'A' ? `Name:\t${a.name.replace(/\.$/, '')}\nAddress: ${a.value}` : a.type === 'CNAME' ? `${a.name.replace(/\.$/, '')}\tcanonical name = ${a.value}` : `${a.name}\t${a.type.toLowerCase()} = ${a.value}`)].join('\n');
}
function curl(ctx: Context, t: string[]) {
  const { flags, values, rest } = options(t, ['-X', '--request']);
  const url = rest[0];
  if (!url) throw new Error('使い方: curl [-v] [-I] [-k] <URL>');
  const method = (values.get('-X') ?? values.get('--request') ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') throw new Error(`curl: 教育用サブセットでは GET / HEAD のみ対応です（-X ${method}）`);
  const head = flags.has('-I') || flags.has('--head') || method === 'HEAD';
  const r = ctx.network.http(ctx.id, url.includes('://') ? url : `http://${url}`, { insecure: flags.has('-k') || flags.has('--insecure'), head });
  ctx.cli.record(r, `curl ${url}`);
  const verbose = flags.has('-v') || flags.has('--verbose');
  const trace = verbose ? r.stages.map(s => `* [${s.layer}] ${s.ok ? '' : '失敗: '}${s.detail}`) : [];
  if (!r.status) {
    const code = r.reason.startsWith('Could not resolve') ? 6 : r.reason.includes('timed out') ? 28 : r.reason.startsWith('Failed to connect') ? 7 : r.reason.startsWith('SSL certificate') ? 60 : r.reason.startsWith('SSL') || r.reason.startsWith('TLS') ? 35 : 52;
    return [...trace, `curl: (${code}) ${r.reason}`].join('\n');
  }
  if (head) return [...trace, r.headers ?? ''].join('\n');
  return [...trace, ...(verbose ? (r.headers ?? '').split('\r\n').map(h => `< ${h}`) : []), r.body ?? ''].join('\n');
}
function ss(ctx: Context, t: string[]) {
  const { flags } = options(t, []);
  const all = ctx.network.sockets(ctx.id);
  const wantT = flags.has('-t'); const wantU = flags.has('-u');
  const rows = all.filter(s => (!wantT && !wantU) || (wantT && s.protocol === 'tcp') || (wantU && s.protocol === 'udp')).filter(s => !flags.has('-l') || s.state === 'LISTEN' || s.state === 'UNCONN');
  return ['Netid State      Local Address:Port        Peer Address:Port    Process', ...rows.map(s => `${pad(s.protocol, 5)} ${pad(s.state, 10)} ${pad(s.local, 25)} ${pad(s.remote, 20)} ${flags.has('-p') && s.process ? `users:(("${s.process}"))` : ''}`)].join('\n');
}
function systemctl(ctx: Context, t: string[]) {
  const [action, raw] = t;
  const services = ctx.device.services ?? [];
  if (action === 'list-units' || !action) return services.map(s => `${pad(`${s.name}.service`, 24)} loaded ${s.running ? 'active   running' : 'inactive dead   '}  ${s.app} ${s.protocol}/${s.port}`).join('\n') || 'サービスはありません';
  if (!raw) throw new Error('使い方: systemctl status|start|stop|restart <service>（systemctl list-units で一覧を表示）');
  const name = raw.replace(/\.service$/, '');
  const svc = services.find(s => s.name === name);
  if (!svc) throw new Error(`Unit ${raw}.service could not be found.`);
  if (action === 'status') return [`● ${svc.name}.service - ${svc.app} (PATH simulated service)`, '     Loaded: loaded', `     Active: ${svc.running ? 'active (running)' : 'inactive (dead)'}`, `     Listen: ${svc.bind}:${svc.port}/${svc.protocol}`].join('\n');
  if (!['start', 'stop', 'restart'].includes(action)) throw new Error('systemctl status|start|stop|restart <service>');
  ctx.network.update(ctx.id, d => { d.services!.find(s => s.name === name)!.running = action !== 'stop'; });
  return '';
}

export function linuxCommand(ctx: Context): string {
  const { tokens: t, network, id, device } = ctx;
  const cmd = t.join(' ');
  const ipCmd = t[0] === 'ip' ? t.filter(x => x !== '-4').slice(1) : [];
  if (t[0] === 'ip') {
    const brief = ipCmd[0] === '-br'; const args = brief ? ipCmd.slice(1) : ipCmd;
    const [obj = '', verb = 'show', ...more] = args;
    const is = (o: string, ...names: string[]) => names.includes(o);
    if (is(obj, 'a', 'addr', 'address') && is(verb, 'show', 'list')) return ipAddr(ctx, brief);
    if (is(obj, 'l', 'link') && is(verb, 'show', 'list')) return ipAddr(ctx, brief, true);
    if (is(obj, 'r', 'route') && is(verb, 'show', 'list')) return ipRoute(ctx);
    if (is(obj, 'n', 'neigh', 'neighbor') && is(verb, 'show', 'list')) return device.arp.map(a => `${a.ip} dev ${a.interfaceId} lladdr ${a.mac} REACHABLE`).join('\n');
    if (is(obj, 'r', 'route') && verb === 'get') {
      const dst = more[0]; if (!dst) throw new Error('使い方: ip route get <IP>'); ipv4(dst);
      const r = resolveRoute(device, dst);
      if (!r) return 'RTNETLINK answers: Network is unreachable';
      return `${dst} ${r.route.kind === 'connected' ? '' : `via ${r.nextHop} `}dev ${r.iface.id} src ${ipOf(r.iface.address)}\n    （一致した経路: ${r.route.destination === ANY ? 'default' : r.route.destination}）`;
    }
    if (is(obj, 'a', 'addr', 'address') && (verb === 'add' || verb === 'del') && more[1] === 'dev') {
      const iface = device.interfaces.find(i => i.id === more[2]);
      if (!iface) throw new Error(`Cannot find device "${more[2]}"`);
      if (verb === 'add') { if (iface.address) throw new Error('RTNETLINK answers: File exists（教育用: 1ポート1アドレス。先に ip addr del）'); network.configureInterface(id, iface.id, more[0], iface.up); }
      else { if (iface.address !== more[0]) throw new Error('RTNETLINK answers: Cannot assign requested address'); network.configureInterface(id, iface.id, undefined, iface.up); }
      return '';
    }
    if (is(obj, 'a', 'addr', 'address') && verb === 'flush' && more[0] === 'dev') { const i = device.interfaces.find(x => x.id === more[1]); if (!i) throw new Error(`Cannot find device "${more[1]}"`); network.configureInterface(id, i.id, undefined, i.up); return ''; }
    const link = more[0] === 'dev' ? more.slice(1) : more;
    if (is(obj, 'l', 'link') && verb === 'set' && (link[1] === 'up' || link[1] === 'down')) {
      const iface = device.interfaces.find(i => i.id === link[0]);
      if (!iface) throw new Error(`Cannot find device "${link[0]}"`);
      network.configureInterface(id, iface.id, iface.address, link[1] === 'up'); return '';
    }
    // `default` is 0.0.0.0/0; a host keeps its one default route as the gateway.
    const dest = (x: string) => x === 'default' ? ANY : cidr(x).canonical;
    if (is(obj, 'r', 'route') && (verb === 'add' || verb === 'replace') && more[1] === 'via') {
      const to = dest(more[0]); ipv4(more[2] ?? ''); // validate before replace removes anything
      if (to === ANY) { if (verb === 'add' && (device.gateway || device.routes.some(r => r.destination === ANY))) throw new Error('RTNETLINK answers: File exists（既存のdefault routeは ip route replace default via <IP> で置き換え）'); network.deleteRoute(id, ANY); network.setGateway(id, more[2]); }
      else { if (verb === 'replace') network.deleteRoute(id, to); network.addRoute(id, { destination: to, nextHop: more[2], preference: 1, metric: 0 }); }
      return '';
    }
    if (is(obj, 'r', 'route') && (verb === 'del' || verb === 'delete') && more[0]) {
      const to = dest(more[0]); const via = more[1] === 'via' ? more[2] : undefined;
      if (to === ANY && device.gateway && (!via || via === device.gateway)) network.setGateway(id, '');
      else if (!network.deleteRoute(id, to, via)) throw new Error('RTNETLINK answers: No such process');
      return '';
    }
    throw new Error('対応: ip addr|link|route|neigh [show], ip route get, ip addr add|del, ip link set, ip route add|del（help 参照）');
  }
  if (t[0] === 'ifconfig') {
    const [port, a, ...opts] = t.slice(1);
    if (!a || port === '-a') return ipAddr(ctx, false);
    const iface = device.interfaces.find(i => i.id === port);
    if (!iface) throw new Error(`${port}: error fetching interface information: Device not found`);
    let address = iface.address; const m = opts.indexOf('netmask');
    if (a !== 'up' && a !== 'down') {
      if (!a.includes('/') && m < 0) throw new Error('使い方: ifconfig <IF> <IP> netmask <マスク> [up|down] / ifconfig <IF> up|down');
      address = `${ipOf(a)}/${cidr(a.includes('/') ? a : toCidr(a, opts[m + 1])).prefix}`;
    }
    const updown = [a, ...opts].filter(x => x === 'up' || x === 'down');
    network.configureInterface(id, iface.id, address, updown.length ? updown.at(-1) === 'up' : true); return '';
  }
  if (t[0] === 'ping') {
    const { values, rest } = options(t.slice(1), ['-c', '-t', '-W', '-i']);
    if (!rest[0]) throw new Error('使い方: ping [-c 回数] [-t TTL] <IP|名前>');
    return ping(ctx, rest[0], Number(values.get('-c') ?? 1), Number(values.get('-t') ?? 64), 'linux');
  }
  if (t[0] === 'traceroute' || t[0] === 'tracepath') {
    const { flags, values, rest } = options(t.slice(1), ['-p', '-m']);
    if (!rest[0]) throw new Error('使い方: traceroute [-I|-T -p port] <IP|名前>');
    const mode = flags.has('-I') ? 'icmp' : flags.has('-T') ? 'tcp' : 'udp';
    return traceroute(ctx, rest[0], t[0] === 'tracepath' ? 'udp' : mode, Number(values.get('-p') ?? 80), Number(values.get('-m') ?? 16), 'linux');
  }
  if (t[0] === 'arp') return ['Address                  HWtype  HWaddress           Iface', ...device.arp.map(a => `${pad(a.ip, 24)} ether   ${a.mac}   ${a.interfaceId}`)].join('\n');
  if (t[0] === 'hostname') return t[1] === '-I' ? device.interfaces.filter(i => l3Up(device, i)).map(i => ipOf(i.address)).join(' ') : id;
  if (t[0] === 'dig') return dig(ctx, t.slice(1));
  if (t[0] === 'nslookup') return nslookup(ctx, t.slice(1));
  if (t[0] === 'host' && t[1]) { const ip = resolveName(ctx, t[1], 'host'); return `${t[1]} has address ${ip}`; }
  if (t[0] === 'curl' || t[0] === 'wget') return curl(ctx, t.slice(1));
  if (t[0] === 'nc' || t[0] === 'ncat' || t[0] === 'telnet') {
    const { rest } = options(t.slice(1), ['-w']);
    const [host, port] = rest;
    if (!host || !port) throw new Error('使い方: nc -zv <host> <port>');
    const r = network.tcpConnect(id, host, Number(port));
    ctx.cli.record(r, `nc ${host} ${port}`);
    return r.success ? r.reason : `nc: connect to ${host} port ${port} (tcp) failed: ${r.refused ? 'Connection refused' : r.reason.includes('timed out') ? 'Connection timed out' : r.reason.includes('prohibited') || r.reason.includes('route') ? 'No route to host' : r.reason}${note(ctx, r.reason)}`;
  }
  if (t[0] === 'ss' || t[0] === 'netstat') return ss(ctx, t.slice(1));
  if (t[0] === 'iperf3' || t[0] === 'iperf') return iperf3(ctx, t.slice(1));
  if (t[0] === 'ethtool') return ethtool(ctx, t[1]);
  if (t[0] === 'iptables') return iptables(ctx, t.slice(1));
  if (cmd === 'nft list ruleset' || cmd === 'nft list table inet filter') return nft(ctx);
  if (t[0] === 'systemctl' || t[0] === 'service') return systemctl(ctx, t[0] === 'service' ? [t[2], t[1]] : t.slice(1));
  if (cmd === 'cat /etc/resolv.conf') return (device.dnsServers ?? []).map(s => `nameserver ${s}`).join('\n') || '# nameserver が設定されていません';
  if (cmd === 'cat /etc/hosts') return `127.0.0.1\tlocalhost\n${device.interfaces.filter(i => i.address).map(i => `${ipOf(i.address)}\t${id.toLowerCase()}`).join('\n')}`;
  if (t[0] === 'echo' && (t[2] === '>' || t[2] === '>>') && t[3] === '/etc/resolv.conf') {
    const m = /^nameserver\s+(\S+)$/.exec(t[1]);
    if (!m) throw new Error('教育用サブセット: echo "nameserver <IP>" > /etc/resolv.conf の形式のみ対応です');
    ipv4(m[1]);
    network.update(id, d => { d.dnsServers = t[2] === '>' ? [m[1]] : [...(d.dnsServers ?? []), m[1]].slice(0, 3); });
    return '';
  }
  if (cmd === 'rndc flush') { if (!device.dnsServer) throw new Error('rndc: このサーバーはDNSサーバーではありません'); network.clearDnsCache(id); return 'DNSキャッシュを消去しました'; }
  if (cmd === 'rndc dumpdb -cache' || cmd === 'rndc dump') return (device.dnsCache ?? []).map(e => `${e.name} ${e.type} ${e.negative ?? e.records.map(r => r.value).join(', ')} (残り ${Math.max(0, Math.ceil((e.expiresAt - network.now()) / 1000))}秒)`).join('\n') || 'キャッシュは空です';
  if (t[0] === 'sleep') {
    const s = Number(t[1]);
    if (!Number.isFinite(s) || s < 0 || s > 86400) throw new Error('sleep 0〜86400（秒）');
    network.advanceTime(s * 1000); return `（仮想時間を ${s} 秒進めました。キャッシュのTTLやARPの有効期限が進みます）`;
  }
  if (t[0] === 'exit' || t[0] === 'logout') return '（教育用Terminalのため終了しません）';
  if (t[0] === 'enable' || t[0] === 'configure') throw new Error(`${t[0]}: command not found（Linuxホストです。設定は ip / iptables コマンドを使います）`);
  throw new Error(`${t[0]}: command not found（教育用サブセット。help で一覧を表示）`);
}
