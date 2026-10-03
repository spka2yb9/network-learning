import type { NetworkSimulator } from '../simulator/core/NetworkSimulator';
import type { DeviceState, DnsRecord } from '../simulator/core/types';
import { cidr, ipOf } from '../simulator/l3/ipv4';
import { resolveRoute } from '../simulator/l3/RoutingTable';
import { parseRule } from '../simulator/services/FirewallEngine';
import { access, addPorts, build, dnsService, https, lag, svi, trunk, vlans, web } from '../simulator/scenarios/build';
import { exampleZone, vpnScenario } from '../simulator/scenarios/chapters';
import { grader } from './grade';
import type { NetworkLab } from './types';

const HOSTS = ['SALES1', 'SALES2', 'DEV1', 'DEV2', 'GUEST1', 'DNS1', 'INTRA'] as const;
/** Company LAN: cabled, Internet side ready, internal side unconfigured (Capstone 1 starting point). */
export function campusScenario() {
  const zone = exampleZone();
  for (const r of zone.records) if (r.value.startsWith('203.0.113.80')) r.value = '203.0.113.180';
  const dnsRoot = (d: DeviceState, origin: string, records: DnsRecord[]) => { d.services = [dnsService()]; d.dnsServer = { recursive: false, rootHints: [], zones: [{ origin, records }] }; };
  const soa = (o: string) => ({ name: o, type: 'SOA' as const, ttl: 3600, value: `ns.${o === '.' ? 'root.' : o} admin.${o === '.' ? 'root.' : o} 1 7200 3600 1209600 300` });
  return build([
    ...HOSTS.map((id, i) => ({ id, kind: (id === 'DNS1' || id === 'INTRA' ? 'server' : 'pc') as 'pc' | 'server', at: [0, i * 110] as [number, number], set: (d: DeviceState) => {
      if (id === 'DNS1') { d.services = [dnsService()]; d.dnsServer = { recursive: true, rootHints: ['198.51.100.10'], zones: [{ origin: 'corp.example.', records: [soa('corp.example.'), { name: 'corp.example.', type: 'NS', ttl: 3600, value: 'dns1.corp.example.' }] }] }; }
      if (id === 'INTRA') d.services = [web('intranet', '<h1>社内ポータル</h1>')];
    } })),
    { id: 'SW1', kind: 'switch', at: [260, 330], set: d => addPorts(d, 9) },
    { id: 'CORE', kind: 'l3switch', at: [500, 330] },
    { id: 'FW', kind: 'firewall', at: [740, 330], ip: { 'g0/0': '203.0.113.2/30' }, routes: [['0.0.0.0/0', '203.0.113.1']], set: d => { d.interfaces[0].description = 'outside'; d.interfaces[0].nat = 'outside'; d.interfaces[1].description = 'inside'; } },
    { id: 'ISP', kind: 'internet', at: [980, 330], ip: { 'g0/0': '203.0.113.1/30', 'g0/1': '198.51.100.1/24', 'g0/2': '203.0.113.129/25' } },
    { id: 'NET', kind: 'switch', at: [1200, 200] },
    { id: 'ROOT', kind: 'server', at: [1420, 60], ip: { eth0: '198.51.100.10/24' }, gw: '198.51.100.1', set: d => dnsRoot(d, '.', [soa('.'), { name: '.', type: 'NS', ttl: 518400, value: 'a.root-servers.net.' }, { name: 'a.root-servers.net.', type: 'A', ttl: 518400, value: '198.51.100.10' }, { name: 'com.', type: 'NS', ttl: 172800, value: 'a.gtld-servers.net.' }, { name: 'a.gtld-servers.net.', type: 'A', ttl: 172800, value: '198.51.100.20' }]) },
    { id: 'TLD', kind: 'server', at: [1420, 180], ip: { eth0: '198.51.100.20/24' }, gw: '198.51.100.1', set: d => dnsRoot(d, 'com.', [soa('com.'), { name: 'com.', type: 'NS', ttl: 172800, value: 'a.gtld-servers.net.' }, { name: 'example.com.', type: 'NS', ttl: 172800, value: 'ns1.example.com.' }, { name: 'ns1.example.com.', type: 'A', ttl: 172800, value: '198.51.100.30' }]) },
    { id: 'AUTH', kind: 'server', at: [1420, 300], ip: { eth0: '198.51.100.30/24' }, gw: '198.51.100.1', set: d => dnsRoot(d, 'example.com.', zone.records) },
    { id: 'EXT', kind: 'pc', at: [1420, 420], ip: { eth0: '198.51.100.50/24' }, gw: '198.51.100.1' },
    { id: 'WEB', kind: 'server', at: [1200, 520], ip: { eth0: '203.0.113.180/25' }, gw: '203.0.113.129', set: d => { d.services = [https(['www.example.com'])]; } },
  ], [...HOSTS.map((id, i) => [id, 'eth0', 'SW1', `g0/${i + 1}`] as [string, string, string, string]), ['SW1', 'g0/8', 'CORE', 'g0/1'], ['SW1', 'g0/9', 'CORE', 'g0/2'], ['CORE', 'g0/8', 'FW', 'g0/1'], ['CORE', 'g0/7', 'FW', 'g0/2'], ['FW', 'g0/0', 'ISP', 'g0/0'],
    ['ISP', 'g0/1', 'NET', 'g0/8'], ['NET', 'g0/1', 'ROOT', 'eth0'], ['NET', 'g0/2', 'TLD', 'eth0'], ['NET', 'g0/3', 'AUTH', 'eth0'], ['NET', 'g0/4', 'EXT', 'eth0'], ['ISP', 'g0/2', 'WEB', 'eth0']]);
}
/**
 * One valid solution: VLAN 10 Sales /26, 20 Dev /25, 30 Guest /27, 40 Servers /28. SW1–CORE: two cables bundled by LACP (L2 trunk).
 * CORE–FW: two routed /30 links used together by equal-cost static routes (ECMP). An L3 port-channel would do as well.
 */
export function solveCampus(n: NetworkSimulator) {
  const plan: Record<string, [string, number, string, string]> = {
    SALES1: ['10.10.10.10/26', 10, '10.10.10.1', 'g0/1'], SALES2: ['10.10.10.11/26', 10, '10.10.10.1', 'g0/2'],
    DEV1: ['10.10.20.10/25', 20, '10.10.20.1', 'g0/3'], DEV2: ['10.10.20.11/25', 20, '10.10.20.1', 'g0/4'],
    GUEST1: ['10.10.30.10/27', 30, '10.10.30.1', 'g0/5'], DNS1: ['10.10.40.10/28', 40, '10.10.40.1', 'g0/6'], INTRA: ['10.10.40.11/28', 40, '10.10.40.1', 'g0/7'],
  };
  for (const [id, [ip, , gw]] of Object.entries(plan)) { n.configureInterface(id, 'eth0', ip, true); n.setGateway(id, gw); if (id !== 'DNS1') n.update(id, d => { d.dnsServers = ['10.10.40.10']; }); }
  n.update('DNS1', d => { d.dnsServer!.zones[0].records.push({ name: 'dns1.corp.example.', type: 'A', ttl: 3600, value: '10.10.40.10' }, { name: 'intranet.corp.example.', type: 'A', ttl: 300, value: '10.10.40.11' }); d.dnsServer!.allowRecursion = ['10.10.0.0/16']; });
  n.update('SW1', d => { vlans(d, [10, 'SALES'], [20, 'DEV'], [30, 'GUEST'], [40, 'SERVERS']); for (const [, vlan, , port] of Object.values(plan)) access(d, vlan, port); trunk(d, 'g0/8', [10, 20, 30, 40]); trunk(d, 'g0/9', [10, 20, 30, 40]); lag(d, 1, 'active', 'g0/8', 'g0/9'); });
  n.update('CORE', d => {
    vlans(d, [10, 'SALES'], [20, 'DEV'], [30, 'GUEST'], [40, 'SERVERS']);
    trunk(d, 'g0/1', [10, 20, 30, 40]); trunk(d, 'g0/2', [10, 20, 30, 40]); lag(d, 1, 'active', 'g0/1', 'g0/2');
    svi(d, 10, '10.10.10.1/26'); svi(d, 20, '10.10.20.1/25'); svi(d, 30, '10.10.30.1/27'); svi(d, 40, '10.10.40.1/28');
    for (const [port, address] of [['g0/8', '10.255.0.1/30'], ['g0/7', '10.255.0.5/30']]) { const up = d.interfaces.find(i => i.id === port)!; delete up.switchport; up.address = address; }
    d.routes.push(...coreDefaults());
    // Guest: DNS only inside, nothing else internal, Internet allowed.
    d.acls = [{ name: 'GUEST-IN', rules: ['permit udp 10.10.30.0/27 host 10.10.40.10 eq 53', 'deny ip any 10.0.0.0/8', 'permit ip any any'].map((r, i) => parseRule((i + 1) * 10, r.split(' '))) }];
    d.interfaces.find(i => i.id === 'vlan30')!.acl = { in: 'GUEST-IN' };
  });
  n.update('FW', d => {
    for (const [port, address] of [['g0/1', '10.255.0.2/30'], ['g0/2', '10.255.0.6/30']]) { const inside = d.interfaces.find(i => i.id === port)!; inside.address = address; inside.nat = 'inside'; }
    // Interface + next hop: if that cable fails the route goes away instead of resolving 10.255.0.x through the default route to the ISP.
    d.routes.push(...[['g0/1', '10.255.0.1'], ['g0/2', '10.255.0.5']].map(([interfaceId, nextHop]) => ({ destination: '10.10.0.0/16', nextHop, interfaceId, preference: 1, metric: 0, kind: 'static' as const })));
    d.nat = [{ id: 'pat', type: 'pat', source: '10.10.0.0/16', outInterface: 'g0/0' }];
    d.firewall!.rules = [parseRule(10, 'permit ip 10.10.0.0/16 any out g0/0'.split(' '))];
  });
}
const coreDefaults = () => [['g0/8', '10.255.0.2'], ['g0/7', '10.255.0.6']].map(([interfaceId, nextHop]) => ({ destination: '0.0.0.0/0', nextHop, interfaceId, preference: 1, metric: 0, kind: 'static' as const }));
const ipOfHost = (n: NetworkSimulator, id: string) => ipOf(n.device(id).interfaces[0].address) ?? '0.0.0.0';
const cables = (n: NetworkSimulator, a: string, b: string) => n.snapshot().links.filter(l => (l.sourceDevice === a && l.targetDevice === b) || (l.sourceDevice === b && l.targetDevice === a));
/** Traffic from every department reaches the Internet web server and other departments. */
const campusUp = (n: NetworkSimulator) => n.ping('SALES1', ipOfHost(n, 'DEV2')).success && ['SALES2', 'DEV1', 'GUEST1'].every(id => n.ping(id, '203.0.113.180').success);
/** Ten connections from five hosts to the web server: both parallel cables must carry some of them. */
const bothUsed = (n: NetworkSimulator, a: string, b: string) => {
  const r = n.throughput(['SALES1', 'SALES2', 'DEV1', 'DEV2', 'GUEST1'].flatMap(from => [{ from, to: '203.0.113.180', port: 443 }, { from, to: '203.0.113.180', port: 443 }]));
  const used = new Set(r.streams.flatMap(s => s.hops.map(h => h.linkId)));
  return r.success && cables(n, a, b).length >= 2 && cables(n, a, b).every(l => used.has(l.id));
};
function campusChecks(g: ReturnType<typeof grader>, sizing: boolean) {
  const dom = (n: NetworkSimulator, id: string) => n.broadcastDomain(id, 'eth0').map(r => r.device);
  g.check('営業・開発・ゲスト・サーバーが別々のブロードキャストドメイン（VLAN）', n => {
    const s = dom(n, 'SALES1'); const d = dom(n, 'DEV1'); const gu = dom(n, 'GUEST1');
    return s.includes('SALES2') && !s.some(x => ['DEV1', 'DEV2', 'GUEST1', 'DNS1', 'INTRA'].includes(x)) && d.includes('DEV2') && !d.some(x => ['SALES1', 'GUEST1', 'DNS1'].includes(x)) && !gu.some(x => HOSTS.includes(x as typeof HOSTS[number]));
  });
  if (sizing) g.check('必要台数を満たす最小のサブネット（営業50台 /26・開発100台 /25・ゲスト20台 /27）', n => {
    const p = (id: string) => cidr(n.device(id).interfaces[0].address!).prefix;
    return p('SALES1') === 26 && p('DEV1') === 25 && p('GUEST1') === 27 && cidr(n.device('SALES1').interfaces[0].address!).canonical === cidr(n.device('SALES2').interfaces[0].address!).canonical;
  });
  g.check('営業 ↔ 開発 がVLAN間ルーティングで通信できる', n => n.ping('SALES1', ipOfHost(n, 'DEV2')).success && n.ping('DEV1', ipOfHost(n, 'SALES2')).success);
  g.check('営業・開発から http://intranet.corp.example/ が表示できる（社内DNS）', n => ['SALES2', 'DEV1'].every(id => (n.http(id, 'http://intranet.corp.example/').body ?? '').includes('社内ポータル')));
  g.check('全部署から https://www.example.com/ が表示できる（DNS・NAT・Firewall）', n => ['SALES1', 'DEV2', 'GUEST1'].every(id => n.http(id, 'https://www.example.com/').success));
  g.check('ゲストから社内（営業・開発のPC・社内ポータル）へは到達できない', n => ['SALES1', 'DEV1', 'INTRA'].every(id => !n.ping('GUEST1', ipOfHost(n, id)).success) && !n.tcpConnect('GUEST1', ipOfHost(n, 'INTRA'), 80).success);
  g.check('インターネットから社内へは到達できない', n => !n.ping('EXT', ipOfHost(n, 'SALES1')).success && !n.tcpConnect('EXT', ipOfHost(n, 'INTRA'), 80).success && !n.tcpConnect('EXT', '203.0.113.2', 80).success);
  g.check('ISPにプライベートアドレスの経路を追加していない', n => !n.table('ISP').some(r => r.destination.startsWith('10.') || r.destination.startsWith('192.168.') || r.destination.startsWith('172.')));
  g.check('Firewallはステートフル・既定拒否のまま', n => n.device('FW').firewall!.stateful && n.device('FW').firewall!.defaultAction === 'deny');
  for (const [a, b, what] of [['SW1', 'CORE', '全部署の通信'], ['CORE', 'FW', '社内とインターネットの通信']]) {
    g.check(`${a}–${b} 間のケーブルが1本故障しても、${what}が続く`, n => cables(n, a, b).length >= 2 && cables(n, a, b).every(l => { n.setLinkState(l.id, false); const ok = campusUp(n); n.setLinkState(l.id, true); return ok; }));
    g.check(`平常時は ${a}–${b} 間の2本とも通信に使われている（片方を待機させない）`, n => bothUsed(n, a, b));
  }
  g.check('スイッチのSTPは有効のまま', n => ['SW1', 'CORE'].every(id => n.device(id).stp?.enabled !== false));
}

export const networkCapstones: NetworkLab[] = [
  { id: 'capstone-1', chapter: 'capstone', kind: 'capstone', workspace: 'network', minutes: 120, title: 'Capstone 1: 小規模企業LANをゼロから設計する', mission: '部署ごとのVLAN・アドレス計画・VLAN間ルーティング・DNS・NAT・Firewallを設計して構築する',
    brief: `ある会社のLANを新設します。配線とインターネット側（ISP・DNSのRoot/TLD/権威サーバー・Webサーバー）は用意済みですが、社内側は何も設定されていません。\n\n**要件**\n\n| 部署 | 最大台数 | 接続機器 |\n| --- | --- | --- |\n| 営業 | 50台 | SALES1, SALES2 |\n| 開発 | 100台 | DEV1, DEV2 |\n| ゲスト | 20台 | GUEST1 |\n| サーバー | 10台 | DNS1（社内DNS・再帰リゾルバ）, INTRA（社内ポータル） |\n\n- 部署ごとにVLANとサブネットを分け、必要台数（Gatewayを含む）を満たす**最小**のサブネットにする（アドレス帯は自由。10.0.0.0/8 推奨）\n- CORE（L3スイッチ：VLAN間のルーティングもできるスイッチ）でVLAN間ルーティングを行い、FWとはルーテッドポート（IPアドレスを持ち、ルータのポートのように動くスイッチのポート）で接続する\n- 全員が DNS1 で名前解決し、intranet.corp.example を INTRA に解決できるようにする\n- インターネットへはFWのPATで出る。インターネットから社内へは到達できない\n- ゲストはインターネットとDNSだけを利用でき、社内へは到達できない\n- SW1–CORE 間と CORE–FW 間には、それぞれケーブルが2本あります。どちらの区間も、ケーブル1本の故障で通信を止めないこと。平常時は2本とも通信に使うこと（片方を待機させるだけにしない）。スイッチのSTPは無効にしない\n- FW–ISP 間は契約上1本です（この区間の冗長化は不要）\n\n使う仕組みは指定しません。区間ごとに「L2か、L3か」「相手は同じ1台か」を考えて選んでください。「到達度を確認」で表示される条件がすべて満たされ、下の設問に答えれば完了です。まずアドレス計画を紙（またはメモ）に書き、SW1 → CORE → FW → DNS1 の順に設定すると進めやすくなります。\n\n**DHCPについて**: 実務では、各PCのアドレスはDHCPで配布し、CORE（L3スイッチ）に ip helper-address でDHCPサーバーを指定します。このシミュレータはDHCPを実装していないため、アドレスは手で固定設定します（設計書には、DHCPで配る範囲と予約するアドレスを書きましょう）。\n\n**提出物（自己評価）**: IPアドレス管理表、VLAN表、構成図、Firewallポリシー表、障害時の影響範囲の説明。`,
    hints: ['まずアドレス計画を書きます。使えるホスト数（Gatewayを含む）は、/26 が62台、/25 が126台、/27 が30台です。', '2本のケーブルの区間は、区間ごとに考えます。SW1–CORE はVLANを運ぶL2のトランクです。STPに任せると片方が待機するだけになります。CORE–FW はルーテッドポート（L3）なので、2本の /30 を等コストの経路で同時に使う方法も、L3のPort-channelで束ねる方法もあります。', '静的ルートで2本を使う場合、ケーブルが切れたときにNext Hopが「Default Route経由で」解決されてしまわないかを確かめます。出力インターフェースとNext Hopの両方を書く（ip route 10.10.0.0/16 g0/1 10.255.0.1）と、そのケーブルが切れたときに経路が確実に消えます。', 'SW1: VLANを作成し、各PCのポートをアクセスポートに、CORE向けの g0/8 をトランクにします。CORE: 同じVLANを作成 → SVI（VLANごとのGatewayになる仮想インターフェース。interface vlan10 など）→ SW1向けの g0/1 をトランク → FW向けの g0/8 を no switchport でルーテッドポートに → FWへのDefault Route。', 'FW: inside（g0/1）にIPアドレスと ip nat inside → 社内のアドレスへの戻り経路 → PAT（ip nat inside source ... interface g0/0 overload）→ 社内からインターネットへの firewall rule。DNS1: corp.example ゾーンに intranet.corp.example のAレコードを追加し、各PCの nameserver を DNS1 にします。', 'ゲストの制限は、COREの vlan30 にACLを適用する方法があります（ip access-list extended で作成し、interface vlan30 で ip access-group <名前> in）。DNS1へのDNS（UDP 53）だけを許可し、ほかの社内宛てを拒否します。'],
    questions: [{ label: 'SW1–CORE 間の2本のケーブルは、何のために存在しますか？（あなたの構成で）', answer: '容量を増やすためと、障害に備えるための両方', options: ['容量を増やすためだけ', '障害に備えるためだけ', '容量を増やすためと、障害に備えるための両方'] }],
    build: () => campusScenario(), solve: solveCampus, grade: s => { const g = grader(s); campusChecks(g, true); return g.done(); },
    debrief: '設計の理由（なぜそのプレフィックス長か、なぜゲストをACLで分離したか、障害時に何が止まるか）を言葉で説明できるか、提出物で確かめましょう。実務の設計レビューでも、構成そのものと同じくらい「なぜそうしたか」が問われます。' },
  { id: 'capstone-2', chapter: 'capstone', kind: 'capstone', workspace: 'network', minutes: 60, explain: false, title: 'Capstone 2: 複合障害の原因調査', mission: '「朝から社内のいろいろなところで通信できない」。複数の設定ミスを調査して直す',
    brief: 'Capstone 1と同じ会社のネットワーク（構築済み）で、週末の作業のあとに障害が出ています。利用者からの報告:\n\n- 開発部の一部のPCで、社内のほかの部署に接続できない\n- 営業部のPCで、Webサイトが名前で開けない人がいる\n- 全員がインターネットに出られない\n\n「到達度を確認」で表示される条件がすべて満たされれば完了です。\n\n**進め方**: 症状 → 観測（ping / traceroute / ip route / arp -n / tcpdump / show コマンド）→ 仮説 → 変更 → 再確認 を記録しながら進めてください。直したあとは、何を・なぜ変えたか（変更前との差分）と、元に戻す手順（ロールバック手順）を書き出しましょう。',
    hints: ['影響範囲から絞り込みます。「全員」に出る症状はネットワークの出口付近（CORE・FW）、「一部」だけの症状は、その端末や、端末がつながるスイッチのポート付近が怪しいと考えます。', '報告ごとに、症状が出ている端末から ping・traceroute・dig を実行し、どの層で止まるかを確かめます。1つ直したら、同じコマンドで元の症状が消えたかを再確認します。', '「全員がインターネットに出られない」の原因は、1つとは限りません。経路を直してもHTTPSだけ通らないなら、FWのルールを上から順に確認します。'],
    build: () => { const n = campusScenario(); solveCampus(n);
      n.update('SW1', d => access(d, 10, 'g0/4'));
      n.update('CORE', d => { d.routes = []; });  // both equal-cost default routes
      n.update('SALES1', d => { d.dnsServers = ['10.10.40.100']; });
      n.update('FW', d => { d.firewall!.rules.unshift(parseRule(5, 'deny tcp any any eq 443'.split(' '))); });
      return n; },
    solve: n => { n.update('SW1', d => access(d, 20, 'g0/4')); n.update('CORE', d => { d.routes = coreDefaults(); }); n.update('SALES1', d => { d.dnsServers = ['10.10.40.10']; }); n.update('FW', d => { d.firewall!.rules = d.firewall!.rules.filter(r => r.seq !== 5); }); },
    grade: s => { const g = grader(s); campusChecks(g, false); return g.done(); },
    debrief: '原因は4つでした: ①DEV2のポートのアクセスVLAN（L2）、②COREのDefault Route（L3）、③SALES1のDNSサーバー設定（DNS）、④FWの先頭に追加された443番を拒否するルール（Firewall）。「一部」と「全員」の症状を分けて考えると、早く絞り込めます。実務でも、作業のあとに出た障害は、作業で変えた箇所の差分から調べるのが近道です。' },
  { id: 'capstone-5', chapter: 'capstone', kind: 'capstone', workspace: 'network', minutes: 90, title: 'Capstone 5: Office ↔ AWS のHybrid Network', mission: '冗長化した2本のIPsecトンネルとBGPで、拠点とVPCをつなぐ',
    brief: 'AWS Site-to-Site VPN は、2本のトンネルを提供し、BGPで経路を交換するのが標準的な構成です。このラボでは VGW1 / VGW2 を、AWS側のトンネルの終端（教育用のルータ）として扱います。\n\n**要件**\n\n- CGW（拠点、AS65000）と VGW1・VGW2（AWS側、AS64512）の間に、IPsecトンネルを2本張る（トンネル1: CGW–VGW1 で 169.254.10.0/30、トンネル2: CGW–VGW2 で 169.254.20.0/30）\n- 各トンネルの上でeBGPを動かし、拠点は 192.168.10.0/24、AWS側は 10.0.1.0/24 を広告する\n- 平常時はトンネル1を優先する（VGW2側で AS_PATH prepend：自ASの番号を重ねてAS_PATHを長く見せる設定、などを使う）\n- トンネル1が落ちても通信が続く（VGW1とVGW2の間は iBGP：同じAS内のBGP ＋ next-hop-self：経路を渡すときにNext Hopを自分のアドレスに書き換える設定）\n- 拠点側ではVPC宛ての静的ルートを使わない（インターネット用のDefault Routeは既存のまま）\n\nまずトンネル1を作ってBGPを確立し、次にトンネル2とVGW1–VGW2間のiBGPを追加すると進めやすくなります。',
    hints: ['トンネルは、ラボ「拠点とクラウドをIPsecでつなぐ」と同じ手順で作ります。トンネル2は CGW（198.51.100.2）と VGW2（203.0.113.6）の間です。PSKは両端で一致させます（例: path-demo-psk）。', 'BGP: CGWは router bgp 65000 で 169.254.10.2 と 169.254.20.2 を remote-as 64512 に、VGW1・VGW2は router bgp 64512 でCGW側（169.254.10.1 / 169.254.20.1）を remote-as 65000 にします。それぞれ自分側のLANを network で広告します。', 'VGW1: neighbor 10.0.1.2 remote-as 64512 と neighbor 10.0.1.2 next-hop-self（VGW2では相手が 10.0.1.1）。トンネル1を優先させるには、VGW2で neighbor 169.254.20.1 as-path prepend 2。'],
    build: () => vpnScenario('none'),
    solve: n => { const ref = vpnScenario('bgp'); for (const id of ['CGW', 'VGW1', 'VGW2']) n.update(id, d => { const r = ref.device(id); d.interfaces = r.interfaces; d.bgp = r.bgp; d.routes = r.routes; }); },
    grade: s => { const g = grader(s);
      g.http('PC1 から http://10.0.1.10/（VPCのアプリ）が表示できる', 'PC1', 'http://10.0.1.10/');
      g.check('CGWの2本のBGPセッションがEstablished', n => (n.bgp()?.sessions.filter(x => x.device === 'CGW' && x.state === 'Established').length ?? 0) >= 2);
      g.check('拠点側はVPC宛ての静的ルートを使っていない', n => n.device('CGW').routes.every(r => r.destination === '0.0.0.0/0'));
      g.check('平常時は、CGWからVPCへの通信がトンネル1を使う（Router IDの比較ではなく、prependなどで優先を決めている）', n => { const best = n.bgp()?.tables.get('CGW')?.find(p => p.prefix === '10.0.1.0/24' && p.best); return resolveRoute(n.device('CGW'), '10.0.1.10')?.iface.id === 'tunnel1' && !/Router ID|ネイバーアドレス/.test(best?.reason ?? ''); });
      g.check('トンネル1が落ちても通信が継続する（BGPによるフェイルオーバー）', n => { n.update('CGW', d => { const t = d.interfaces.find(i => i.id === 'tunnel1'); if (t) t.up = false; }); return n.http('PC1', 'http://10.0.1.10/').success; });
      return g.done(); },
    debrief: 'AWS Site-to-Site VPNが2本のトンネルを提供するのは、片方が保守や障害で落ちても通信を続けるためです。実務では、平常時にどちらを使うか（prependやLOCAL_PREF）と、切り替わったときの戻り経路（iBGPとnext-hop-self）をセットで設計します。', source: 'PC1', target: '10.0.1.10' },
];
