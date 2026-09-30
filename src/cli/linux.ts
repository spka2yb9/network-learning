import type { Context } from './CliEngine';
import { note, pad, ping, resolveName, traceroute } from './common';
import { options } from './CommandParser';
import type { DnsType, FilterRule } from '../simulator/core/types';
import { cidr, dotted, ipOf, ipv4, isIpv4 } from '../simulator/l3/ipv4';
import { installedRoutes, l3Up, resolveRoute } from '../simulator/l3/RoutingTable';
import { dnsTypes, formatRecord, reverseName } from '../simulator/services/Dns';
import { formatIptables } from '../simulator/services/FirewallEngine';

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
  const routes = installedRoutes(ctx.device);
  if (!routes.length) return '';
  return routes.sort((a, b) => cidr(b.destination).prefix - cidr(a.destination).prefix).map(r => {
    const dest = r.destination === ANY ? 'default' : r.destination;
    if (r.kind === 'connected') { const i = ctx.device.interfaces.find(x => x.id === r.interfaceId)!; return `${dest} dev ${i.id} proto kernel scope link src ${ipOf(i.address)}`; }
    const via = resolveRoute(ctx.device, r.nextHop ?? '0.0.0.0');
    return `${dest} via ${r.nextHop}${via ? ` dev ${via.iface.id}` : ''}${r.nextHop && !via ? ' （Next Hopに到達できません）' : ''}`;
  }).join('\n');
}
function iptables(ctx: Context, t: string[]): string {
  const { flags, values, rest } = options(t, ['-A', '-I', '-D', '-P', '-p', '-s', '-d', '--dport', '--sport', '-i', '-j', '-m', '--ctstate', '--state', '-t']);
  const policy = ctx.device.firewall ?? { stateful: false, defaultAction: 'permit' as const, rules: [] };
  if (values.get('-t') && values.get('-t') !== 'filter') throw new Error('iptables: 教育用サブセットでは filter テーブル（INPUT）のみ対応です。NATはルータで設定します');
  const chainArg = values.get('-A') ?? values.get('-I') ?? values.get('-D') ?? values.get('-P') ?? (flags.has('-F') ? rest[0] : undefined);
  if (chainArg && chainArg !== 'INPUT') throw new Error(`iptables: 教育用サブセットでは INPUT チェーンのみ対応です（${chainArg}）`);
  if (flags.has('-L') || flags.has('-S') || t.length === 0) {
    if (flags.has('-S')) return ['-P INPUT ' + (policy.defaultAction === 'permit' ? 'ACCEPT' : 'DROP'), ...policy.rules.map(r => formatIptables(r))].join('\n');
    return [`Chain INPUT (policy ${policy.defaultAction === 'permit' ? 'ACCEPT' : 'DROP'})`, 'num  target     prot  source               destination',
      ...policy.rules.map((r, i) => `${pad(i + 1, 4)} ${pad(r.action === 'permit' ? 'ACCEPT' : r.action === 'deny' ? 'DROP' : 'REJECT', 10)} ${pad(r.protocol === 'ip' ? 'all' : r.protocol, 5)} ${pad(r.source, 20)} ${pad(r.destination, 20)}${r.destinationPort ? ` ${r.protocol} dpt:${r.destinationPort.join(':').replace(/^(\d+):\1$/, '$1')}` : ''}${r.ctState ? ` ctstate ${r.ctState.join(',').toUpperCase()}` : ''}`)].join('\n');
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
  const dp = port(values.get('--dport')); const sp = port(values.get('--sport'));
  if ((dp || sp) && rule.protocol !== 'tcp' && rule.protocol !== 'udp') throw new Error('iptables: --dport / --sport には -p tcp|udp が必要です');
  if (dp) rule.destinationPort = dp; if (sp) rule.sourcePort = sp;
  if (values.has('-i')) rule.inInterface = values.get('-i');
  const state = values.get('--ctstate') ?? values.get('--state');
  if (state) rule.ctState = state.toLowerCase().split(',') as FilterRule['ctState'];
  if (values.has('-A')) commit([...policy.rules, rule]);
  else { const at = Math.max(0, Math.min(policy.rules.length, (Number(rest[0]) || 1) - 1)); commit([...policy.rules.slice(0, at), rule, ...policy.rules.slice(at)]); }
  return '';
}
function nft(ctx: Context) {
  const p = ctx.device.firewall;
  if (!p) return 'table inet filter {\n  chain input {\n    type filter hook input priority filter; policy accept;\n  }\n}';
  const line = (r: FilterRule) => [r.protocol !== 'ip' ? `meta l4proto ${r.protocol}` : '', r.source !== ANY ? `ip saddr ${r.source}` : '', r.destination !== ANY ? `ip daddr ${r.destination}` : '',
    r.destinationPort ? `${r.protocol} dport ${r.destinationPort[0] === r.destinationPort[1] ? r.destinationPort[0] : r.destinationPort.join('-')}` : '',
    r.ctState ? `ct state ${r.ctState.join(',')}` : '', r.action === 'permit' ? 'accept' : r.action === 'deny' ? 'drop' : 'reject'].filter(Boolean).join(' ');
  return ['table inet filter {', '  chain input {', `    type filter hook input priority filter; policy ${p.defaultAction === 'permit' ? 'accept' : 'drop'};`, ...p.rules.map(r => `    ${line(r)}`), '  }', '}'].join('\n');
}
function dig(ctx: Context, t: string[]) {
  let server: string | undefined; let type: DnsType = 'A'; let name = ''; const plus = new Set<string>(); let reverse = false;
  for (let i = 0; i < t.length; i++) {
    const x = t[i];
    if (x.startsWith('@')) { server = x.slice(1); ipv4(server); }
    else if (x.startsWith('+')) plus.add(x);
    else if (x === '-x') { reverse = true; name = reverseName(t[++i] ?? ''); type = 'PTR'; }
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
  if (!m) return `;; communications error: timed out\n;; no servers could be reached${note(ctx, r.reason)}`;
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
  if (!m) return `;; connection timed out; no servers could be reached${note(ctx, r.reason)}`;
  const head = [`Server:\t\t${r.server}`, `Address:\t${r.server}#53`, ''];
  if (m.rcode !== 'NOERROR') return [...head, `** server can't find ${name}: ${m.rcode}`].join('\n');
  if (!m.answer.length) return [...head, `*** Can't find ${name}: No answer`].join('\n');
  return [...head, ...(m.aa ? [] : ['Non-authoritative answer:']), ...m.answer.map(a => a.type === 'A' ? `Name:\t${a.name.replace(/\.$/, '')}\nAddress: ${a.value}` : a.type === 'CNAME' ? `${a.name.replace(/\.$/, '')}\tcanonical name = ${a.value}` : `${a.name}\t${a.type.toLowerCase()} = ${a.value}`)].join('\n');
}
function curl(ctx: Context, t: string[]) {
  const { flags, rest } = options(t, []);
  const url = rest[0];
  if (!url) throw new Error('使い方: curl [-v] [-I] [-k] <URL>');
  const r = ctx.network.http(ctx.id, url.includes('://') ? url : `http://${url}`, { insecure: flags.has('-k') || flags.has('--insecure'), head: flags.has('-I') || flags.has('--head') });
  ctx.cli.record(r, `curl ${url}`);
  const verbose = flags.has('-v') || flags.has('--verbose');
  const trace = verbose ? r.stages.map(s => `* [${s.layer}] ${s.ok ? '' : '失敗: '}${s.detail}`) : [];
  if (!r.status) {
    const code = r.reason.startsWith('Could not resolve') ? 6 : r.reason.includes('timed out') ? 28 : r.reason.startsWith('Failed to connect') ? 7 : r.reason.startsWith('SSL certificate') ? 60 : r.reason.startsWith('SSL') || r.reason.startsWith('TLS') ? 35 : 52;
    return [...trace, `curl: (${code}) ${r.reason}`].join('\n');
  }
  if (flags.has('-I') || flags.has('--head')) return [...trace, r.headers ?? ''].join('\n');
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
      const dst = more[0]; ipv4(dst);
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
    if (is(obj, 'l', 'link') && verb === 'set' && (more[1] === 'up' || more[1] === 'down')) {
      const iface = device.interfaces.find(i => i.id === more[0]);
      if (!iface) throw new Error(`Cannot find device "${more[0]}"`);
      network.configureInterface(id, iface.id, iface.address, more[1] === 'up'); return '';
    }
    if (is(obj, 'r', 'route') && (verb === 'add' || verb === 'replace') && more[1] === 'via') {
      if (more[0] === 'default') { if (device.gateway && verb === 'add') throw new Error('RTNETLINK answers: File exists（既存のdefault routeは ip route replace default via <IP> で置き換え）'); network.setGateway(id, more[2]); }
      else { if (verb === 'replace') network.deleteRoute(id, more[0]); network.addRoute(id, { destination: more[0], nextHop: more[2], preference: 1, metric: 0 }); }
      return '';
    }
    if (is(obj, 'r', 'route') && (verb === 'del' || verb === 'delete') && more[0]) {
      if (more[0] === 'default') { if (!device.gateway) throw new Error('RTNETLINK answers: No such process'); network.setGateway(id, ''); }
      else if (!network.deleteRoute(id, more[0])) throw new Error('RTNETLINK answers: No such process');
      return '';
    }
    throw new Error('対応: ip addr|link|route|neigh [show], ip route get, ip addr add|del, ip link set, ip route add|del（help 参照）');
  }
  if (t[0] === 'ifconfig') return ipAddr(ctx, false);
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
