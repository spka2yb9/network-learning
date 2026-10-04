import { createDevice, type NetworkSimulator } from '../../simulator/core/NetworkSimulator';
import type { DeviceKind } from '../../simulator/core/types';
import { resolveRoute } from '../../simulator/l3/RoutingTable';
import { access, build, lag, subinterface, trunk, vlans, web } from '../../simulator/scenarios/build';
import { net, networkSimulation } from '../simulation';

type N = NetworkSimulator;
const WEB = '198.51.100.10';
const SRV1 = '192.168.20.10';
/** Like the palette (LabController.addDevice): next ordinal for unique MACs. */
const place = (n: N, id: string, kind: DeviceKind, x: number, y: number) => n.addDevice(createDevice(id, kind, n.snapshot().devices.length + 1, { x, y }));
const wire = (n: N, a: string, pa: string, b: string, pb: string) => n.connect({ id: `${a}-${pa}-${b}-${pb}`, sourceDevice: a, sourceInterface: pa, targetDevice: b, targetInterface: pb, up: true, bandwidth: 1000, latency: 1 });
const cables = (n: N, a: string, b: string) => n.snapshot().links.filter(l => (l.sourceDevice === a && l.targetDevice === b) || (l.sourceDevice === b && l.targetDevice === a));
/** L2 settings of a port; a bundled member uses its Port-channel's settings (as the switch does). */
function switchport(n: N, a: string, port: string | undefined) {
  const d = n.device(a); const i = d.interfaces.find(x => x.id === port); const group = i?.channelGroup?.group;
  return group ? d.interfaces.find(x => x.id === `po${group}`)?.switchport : i?.switchport;
}
const carries = (vlan: number, allowed: 'all' | number[]) => allowed === 'all' || allowed.includes(vlan);
const isTrunk = (n: N, a: string, port: string | undefined) => { const sp = switchport(n, a, port); return sp?.mode === 'trunk' && carries(10, sp.allowedVlans) && carries(20, sp.allowedVlans); };
const isAccess = (n: N, a: string, toward: string, vlan: number) => { const sp = switchport(n, a, net.port(n, a, toward)); return sp?.mode === 'access' && sp.accessVlan === vlan; };
const hasVlans = (n: N, id: string) => [10, 20].every(v => n.device(id).vlans?.some(x => x.id === v));
const gateway = (n: N, vlan: number, address: string) => { const p = net.port(n, 'R1', 'SW2'); return !!p && n.device('R1').interfaces.some(i => i.kind === 'subinterface' && i.parent === p && i.vlan === vlan && i.address === address); };
const lacp = (n: N, id: string) => Object.values(n.lagState()[id] ?? {}).some(l => l.protocol === 'LACP' && l.members.filter(m => m.flag === 'P').length >= 2);

/** Chapter 9: the Theory's office, built from an empty room. Only the ISP's side (ISP and a web server on the Internet) is there. */
export const topologySimulation = networkSimulation({
  id: 'sim-topology', chapter: 'topology', minutes: 50,
  title: '小さな営業所のネットワークを、ゼロから組み立てる',
  mission: '要件と設計表どおりに機器を置いて配線・設定し、社員PC → 社内サーバー → インターネットの通信を1ホップずつ確かめ、幹線を2本にして束ねる',
  brief: [
    'Theoryで設計した営業所のネットワークを、空の部屋から組み立てます。最初にあるのは、プロバイダ（ISP）の機器と、インターネット上のWebサーバー WEB（198.51.100.10）だけです。この2台はISPの持ち物なので、設定を変えません。',
    '```text\n 執務室                     サーバーラック\n PC1 ─┐                      ┌─ SRV1 (VLAN 20)\n PC2 ─┤ SW1 ═══(幹線)═══ SW2 ┤\n(VLAN 10)                    └─ R1 ──── ISP ── WEB\n                                 203.0.113.2/30   198.51.100.10\n```',
    '| 用途 | VLAN | ネットワーク | Gateway（R1） | 機器 |\n| --- | --- | --- | --- | --- |\n| 社員LAN | 10 | 192.168.10.0/24 | 192.168.10.1 | PC1 .11、PC2 .12 |\n| サーバーLAN | 20 | 192.168.20.0/24 | 192.168.20.1 | SRV1 .10 |\n| ISP接続 | - | 203.0.113.0/30 | （ISP .1） | R1 .2 |',
    'Theoryの順に、①置く → ②つなぐ → ③VLAN → ④トランク → ⑤Gateway → ⑥端末 → ⑦1ホップずつ確かめる → ⑧⑨インターネットへの出口とNAT → ⑩traceroute → ⑪⑫幹線の冗長化、と進めます。機器名はパレットが自動で付けます（種類ごとに空いている最小の番号: PC1、PC2、SW1 …）。',
  ].join('\n\n'),
  source: 'PC1', target: SRV1,
  build: () => build([
    { id: 'ISP', kind: 'internet', at: [860, 300], ip: { 'g0/0': '203.0.113.1/30', 'g0/1': '198.51.100.1/24' } },
    { id: 'WEB', kind: 'server', at: [1060, 300], ip: { eth0: `${WEB}/24` }, gw: '198.51.100.1', set: d => { d.services = [web('nginx', '<h1>Welcome to example.com</h1>')]; } },
  ], [['ISP', 'g0/1', 'WEB', 'eth0']]),
  sim: [
    { title: '機器を6台置く',
      body: '設計の機器表どおりに、左の DEVICES パレットから **PC を2台、L2 Switch を2台、Router を1台、Server を1台** 置きます（ボタンをクリックするか、構成図へドラッグ）。名前は自動で PC1・PC2・SW1・SW2・R1・SRV1 になります。\n\n執務室側（左）に PC1・PC2・SW1、サーバーラック側（右）に SW2・R1・SRV1 と並べておくと、あとで図と見比べやすくなります。',
      hints: ['間違えて置いた機器は、選んで右パネルの「この機器を削除」（または Delete キー）で消せます。消すと番号が空くので、次に置いた同じ種類の機器がその番号になります。'],
      check: n => ([['PC1', 'pc'], ['PC2', 'pc'], ['SW1', 'switch'], ['SW2', 'switch'], ['R1', 'router'], ['SRV1', 'server']] as const).every(([id, kind]) => net.has(n, id, kind)),
      solve: n => { place(n, 'PC1', 'pc', 0, 60); place(n, 'PC2', 'pc', 0, 240); place(n, 'SW1', 'switch', 200, 150); place(n, 'SW2', 'switch', 460, 150); place(n, 'R1', 'router', 660, 300); place(n, 'SRV1', 'server', 660, 20); } },
    { title: '配線表どおりにケーブルをつなぐ',
      body: '構成図で、ポートからポートへドラッグしてケーブルを6本つなぎます。Theoryの配線表のポート番号に合わせると、あとの手順がそのまま使えます。\n\n| ケーブル | 片側 | もう片側 |\n| --- | --- | --- |\n| PC1 | PC1 eth0 | SW1 g0/1 |\n| PC2 | PC2 eth0 | SW1 g0/2 |\n| 幹線 | SW1 g0/8 | SW2 g0/8 |\n| SRV1 | SRV1 eth0 | SW2 g0/1 |\n| R1（LAN側） | R1 g0/0 | SW2 g0/2 |\n| R1（ISP側） | R1 g0/1 | ISP g0/0 |\n\nつないだら、ケーブルをクリックして両端のポート名を確かめます（右パネルに「SW1 g0/8 ⇄ SW2 g0/8」のように出ます）。',
      hints: ['ISP の g0/0 は、ISP がこの営業所のために用意したポートです（203.0.113.1/30 が設定済み）。', 'ポート番号が表と違っても判定は通りますが、以降の手順のポート名を読み替える必要があります。'],
      check: n => ([['PC1', 'SW1'], ['PC2', 'SW1'], ['SW1', 'SW2'], ['SRV1', 'SW2'], ['R1', 'SW2'], ['R1', 'ISP']] as const).every(([a, b]) => net.linked(n, a, b)),
      solve: n => { wire(n, 'PC1', 'eth0', 'SW1', 'g0/1'); wire(n, 'PC2', 'eth0', 'SW1', 'g0/2'); wire(n, 'SW1', 'g0/8', 'SW2', 'g0/8'); wire(n, 'SRV1', 'eth0', 'SW2', 'g0/1'); wire(n, 'R1', 'g0/0', 'SW2', 'g0/2'); wire(n, 'R1', 'g0/1', 'ISP', 'g0/0'); } },
    { title: 'VLANを作り、端末のポートに割り当てる',
      body: '両方のスイッチに VLAN 10（STAFF）と VLAN 20（SERVER）を作り、端末がつながるポートをアクセスポートにします。SW2 には VLAN 10 の端末がいませんが、VLAN 10 のフレームが SW2 を通って R1 へ行くので、VLAN 10 も作っておきます（作っていないVLANのフレームは捨てられます）。\n\n- GUI: スイッチを選び「VLAN / STP」で VLAN ID と名前を入れて「VLANを作成」。「インターフェース」で端末のポートのモードを access、VLAN を 10（SRV1 のポートは 20）に\n- CLI: SW1 では\n\n```text\nenable\nconfigure terminal\nvlan 10\nname STAFF\nexit\nvlan 20\nname SERVER\nexit\ninterface range g0/1-2\nswitchport mode access\nswitchport access vlan 10\nend\n```\n\nSW2 でも `vlan 10` と `vlan 20` を作り、`interface g0/1` → `switchport mode access` → `switchport access vlan 20` とします。`show vlan brief` で、ポートが正しいVLANの行に並んでいれば完了です。',
      hints: ['show vlan brief の行に、VLAN 10 と 20 が両方のスイッチで表示されているか確かめます。', 'アクセスポートの設定は「端末がつながっているポート」だけに入れます。幹線（g0/8）とR1向け（SW2 g0/2）は次のステップでトランクにします。'],
      check: n => hasVlans(n, 'SW1') && hasVlans(n, 'SW2') && isAccess(n, 'SW1', 'PC1', 10) && isAccess(n, 'SW1', 'PC2', 10) && isAccess(n, 'SW2', 'SRV1', 20),
      solve: n => {
        n.update('SW1', d => { vlans(d, [10, 'STAFF'], [20, 'SERVER']); access(d, 10, 'g0/1', 'g0/2'); });
        n.update('SW2', d => { vlans(d, [10, 'STAFF'], [20, 'SERVER']); access(d, 20, 'g0/1'); });
      } },
    { title: '幹線とR1向けのポートをトランクにする',
      body: '2つのVLANを1本のケーブルで運ぶポートをトランクにします。対象は、幹線の両端（SW1 g0/8 と SW2 g0/8）と、R1 につながる SW2 g0/2 の3つです。許可するVLANは 10 と 20 だけにします。\n\n- GUI: そのポートのモードを trunk にし、許可VLAN に `10,20`\n- CLI（SW1 の例。SW2 は g0/8 と g0/2 の両方に）\n\n```text\nconfigure terminal\ninterface g0/8\nswitchport mode trunk\nswitchport trunk allowed vlan 10,20\nend\n```\n\n`show interfaces trunk` で、3つのポートが trunking、許可VLANが 10,20 と出れば完了です（SW2 g0/2 は、R1 のポートがまだ何も話さなくても trunking と表示されます）。',
      hints: ['幹線は両端の設定がそろって初めて、両方のVLANを運べます。SW1 だけでなく SW2 の g0/8 も確かめます。'],
      check: n => isTrunk(n, 'SW1', net.port(n, 'SW1', 'SW2')) && isTrunk(n, 'SW2', net.port(n, 'SW2', 'SW1')) && isTrunk(n, 'SW2', net.port(n, 'SW2', 'R1')),
      solve: n => { n.update('SW1', d => trunk(d, 'g0/8', [10, 20])); n.update('SW2', d => { trunk(d, 'g0/8', [10, 20]); trunk(d, 'g0/2', [10, 20]); }); } },
    { title: 'R1に、VLANごとのGatewayを作る',
      body: 'R1 の g0/0 は、VLAN 10 と 20 のタグ付きフレームを受け取ります。VLANごとに **サブインターフェース**（1つのポートの中に作る、VLANごとの仮想ポート）を作り、それぞれに Gateway のアドレスを付けます。\n\n- GUI: R1 の「インターフェース」の下で「サブインターフェース」を選び、VLAN ID `10`・親ポート `g0/0` で追加。できた g0/0.10 に `192.168.10.1/24`。同じように g0/0.20 に `192.168.20.1/24`\n- CLI:\n\n```text\nenable\nconfigure terminal\ninterface g0/0.10\nencapsulation dot1q 10\nip address 192.168.10.1 255.255.255.0\nexit\ninterface g0/0.20\nencapsulation dot1q 20\nip address 192.168.20.1 255.255.255.0\nend\n```\n\n`show ip route` に、C（Connected）の 192.168.10.0/24 と 192.168.20.0/24 が並べば完了です。',
      hints: ['encapsulation dot1q の番号は、そのサブインターフェースが受け持つVLAN（スイッチのトランクで付くタグ）と同じにします。', 'サブインターフェースは、SW2 につながっている R1 のポート（配線表どおりなら g0/0）に作ります。'],
      check: n => gateway(n, 10, '192.168.10.1/24') && gateway(n, 20, '192.168.20.1/24'),
      solve: n => n.update('R1', d => { subinterface(d, 'g0/0', 10, '192.168.10.1/24'); subinterface(d, 'g0/0', 20, '192.168.20.1/24'); }) },
    { title: '端末にアドレスとDefault Gatewayを設定する',
      body: 'アドレス計画どおりに、3台の端末に IPアドレスと Default Gateway を設定します。\n\n| 端末 | アドレス | Default Gateway |\n| --- | --- | --- |\n| PC1 | 192.168.10.11/24 | 192.168.10.1 |\n| PC2 | 192.168.10.12/24 | 192.168.10.1 |\n| SRV1 | 192.168.20.10/24 | 192.168.20.1 |\n\n- GUI: 端末を選び、eth0 にアドレス、「Routing Table」の Default Gateway に Gateway を入れて適用\n- CLI（PC1 の例）:\n\n```text\nip addr add 192.168.10.11/24 dev eth0\nip route add default via 192.168.10.1\n```\n\n設定できたら、PC1 で `ping 192.168.20.10` を実行します。VLAN をまたぐので、R1 を経由して届きます。',
      hints: ['PC1 → PC2（同じVLAN）は通るのに SRV1 へ届かないなら、Gateway の設定と、SW2 g0/2 のトランク、R1 のサブインターフェースを順に確かめます。', 'SRV1 の Gateway を忘れると、行きは届いても返事が戻れません。'],
      check: n => net.hasAddress(n, 'PC1', '192.168.10.11/24') && net.hasAddress(n, 'PC2', '192.168.10.12/24') && net.hasAddress(n, 'SRV1', `${SRV1}/24`) && net.ping(n, 'PC1', SRV1) && net.ping(n, 'PC2', SRV1),
      solve: n => {
        for (const [id, address, gw] of [['PC1', '192.168.10.11/24', '192.168.10.1'], ['PC2', '192.168.10.12/24', '192.168.10.1'], ['SRV1', `${SRV1}/24`, '192.168.20.1']]) { n.configureInterface(id, 'eth0', address, true); n.setGateway(id, gw); }
      } },
    { title: 'PC1からSRV1へのpingを、1ホップずつ追う',
      body: '画面下の SEND バーで、送信元 PC1・宛先 `192.168.20.10` の ping を送ります。右パネルの「Debugger」を開き「Hop」表示に切り替えると、1行が「1本のケーブルを通った1回の送信」です。Echo Request の行だけを上から読み、送信元/宛先MAC・VLAN・TTL がどこで変わるかを確かめます（色の付いたセルが、前のホップから変わった値です）。',
      hints: ['Echo Request は PC1 → SW1 → SW2 → R1 → SW2 → SRV1 と進みます。SW2–R1 のケーブルを、行きと戻りで2回通ります。', 'TTL を減らすのはルータだけです。'],
      quiz: { question: 'R1 が SW2 へ送り返す Echo Request（R1 → SW2 の行）について、正しいものはどれですか？', options: ['VLANタグは 10 のまま、TTL は 64 のまま', 'VLANタグは 20 に変わり、TTL は 63、送信元MACは R1 のもの', 'VLANタグは外れ、送信元IPが R1 の 192.168.20.1 に変わる'], answer: 1, explanation: 'R1 は VLAN 10 のサブインターフェースで受け取り、経路表で 192.168.20.0/24（g0/0.20）へ転送します。出ていくフレームには VLAN 20 のタグが付き、MAC は R1 → SRV1 に付け替えられ、TTL が1減ります。送信元・宛先IP（192.168.10.11 → 192.168.20.10）は変わりません。' } },
    { title: 'インターネットへの出口を作る',
      body: 'R1 の ISP 側のポート（g0/1）に、ISP から指定されたアドレス `203.0.113.2/30` を付け、「社内以外の宛先はすべて ISP（203.0.113.1）へ」という Default Route を入れます。\n\n- GUI: R1 の g0/1 に `203.0.113.2/30`。「Routing Table」で Destination `0.0.0.0/0`、Next Hop `203.0.113.1` を追加\n- CLI:\n\n```text\nconfigure terminal\ninterface g0/1\nip address 203.0.113.2 255.255.255.252\nexit\nip route 0.0.0.0/0 203.0.113.1\nend\n```\n\n`show ip route` に `S*  0.0.0.0/0 [1/0] via 203.0.113.1` が出れば完了です。この時点で PC1 から `ping 198.51.100.10` を送っても、まだ返事は戻りません。',
      check: n => net.address(n, 'R1', 'ISP') === '203.0.113.2/30' && resolveRoute(n.device('R1'), WEB)?.nextHop === '203.0.113.1',
      solve: n => { n.configureInterface('R1', 'g0/1', '203.0.113.2/30', true); n.addRoute('R1', { destination: '0.0.0.0/0', nextHop: '203.0.113.1', preference: 1, metric: 0 }); } },
    { title: 'NATで、社内のアドレスをISPのアドレスに変える',
      body: '社内の 192.168.x.x はプライベートアドレスなので、ISP もインターネットも、そこへの帰り道を知りません。R1 で送信元を自分の g0/1 のアドレス（203.0.113.2）に書き換える NAT（PAT）を設定します。社内のネットワークはすべて 192.168.0.0/16 の中に計画したので、1行で両方のVLANを対象にできます。\n\n- GUI: R1 の g0/0.10 と g0/0.20 の「NAT」を inside、g0/1 を outside に。「NAT」で PAT、内側 `192.168.0.0/16`、出口 `g0/1` を追加\n- CLI:\n\n```text\nconfigure terminal\ninterface g0/0.10\nip nat inside\nexit\ninterface g0/0.20\nip nat inside\nexit\ninterface g0/1\nip nat outside\nexit\nip nat inside source 192.168.0.0/16 interface g0/1 overload\nend\n```\n\nPC1 と SRV1 から `ping 198.51.100.10` が通れば完了です。ISP の機器には経路を足しません（実際のISPは、お客さんのプライベートアドレスへの経路を持ちません）。',
      hints: ['inside / outside の付け忘れが多い原因です。R1 で show running-config を見て、3つのインターフェースに ip nat inside / outside が入っているか確かめます。', 'ping の後に R1 で show ip nat translations を実行すると、変換表に 192.168.10.11 → 203.0.113.2 の行ができています。'],
      check: n => n.device('ISP').routes.length === 0 && net.ping(n, 'PC1', WEB) && net.ping(n, 'SRV1', WEB),
      solve: n => n.update('R1', d => {
        for (const i of d.interfaces) { if (i.kind === 'subinterface') i.nat = 'inside'; if (i.id === 'g0/1') i.nat = 'outside'; }
        d.nat = [{ id: 'pat-office', type: 'pat', source: '192.168.0.0/16', outInterface: 'g0/1' }];
      }) },
    { title: 'tracerouteで、インターネットまでの道を確かめる',
      body: 'PC1 の Terminal で `traceroute 198.51.100.10` を実行し、通過するルータを確かめます。続けて Debugger で、WEB に届いた Echo Request（ISP → WEB の行）の送信元IPを見ます。余裕があれば `curl http://198.51.100.10/` で、Webページの中身まで届くことも確かめましょう。',
      quiz: { question: 'WEB（198.51.100.10）に届いたパケットの送信元IPアドレスはどれですか？', options: ['192.168.10.11（PC1）', '203.0.113.2（R1 の ISP 側）', '192.168.10.1（R1 の VLAN 10 側）'], answer: 1, explanation: 'R1 の NAT（PAT）が、送信元を 192.168.10.11 から 203.0.113.2 に書き換えています。WEB の返事は 203.0.113.2 宛てに戻り、R1 が変換表を見て 192.168.10.11 に戻します。NATがなければ途中でIPアドレスは変わらない、という原則の例外がここです。' } },
    { title: '幹線に2本目のケーブルを足す',
      body: 'SW1–SW2 の幹線は、社員の通信がすべて通る **単一障害点** です。2本目のケーブルを SW1 g0/7 ⇄ SW2 g0/7 につなぎ、両端を1本目と同じトランク（許可VLAN 10,20）にします。\n\nつないだら SW1 と SW2 で `show spanning-tree` を実行し、幹線の2つのポートの状態（FWD / BLK）を見ます。',
      hints: ['2本目のポートを1本目と同じ設定にしないと、STPがどちらを止めるかによっては VLAN 10・20 が運べなくなります。', 'BLK は、STP がループを防ぐために止めているポートです。'],
      check: n => cables(n, 'SW1', 'SW2').length >= 2 && cables(n, 'SW1', 'SW2').every(l => isTrunk(n, l.sourceDevice, l.sourceInterface) && isTrunk(n, l.targetDevice, l.targetInterface)) && net.ping(n, 'PC1', SRV1),
      solve: n => { n.update('SW1', d => trunk(d, 'g0/7', [10, 20])); n.update('SW2', d => trunk(d, 'g0/7', [10, 20])); wire(n, 'SW1', 'g0/7', 'SW2', 'g0/7'); },
      quiz: { question: '2本目を足しただけの状態で、幹線について正しいものはどれですか？', options: ['2本とも使われ、容量が 2 Gbps になった', 'STP が片方を BLK にしている。容量は1本分のままだが、使っている1本が切れると、もう1本に切り替わる', 'ループになり、ブロードキャストストームが起きている'], answer: 1, explanation: 'スイッチ間の2本はループを作るので、STP が片方を止めます。障害への備え（冗長）にはなりますが、容量は増えません。両方を使うには、次のステップで LACP で束ねます。' } },
    { title: '2本の幹線をLACPで束ねる',
      body: '2本を1つの論理リンク（po1）に束ねて、両方を使えるようにします。両方のスイッチで設定します。\n\n- GUI: スイッチの「Link Aggregation」でグループ `1`、モード active、g0/7 と g0/8 にチェックして「選んだポートを束ねる」。できた po1 のモードを trunk、許可VLANを `10,20` に\n- CLI（SW1・SW2 とも）:\n\n```text\nconfigure terminal\ninterface range g0/7-8\nchannel-group 1 mode active\nexit\ninterface po1\nswitchport mode trunk\nswitchport trunk allowed vlan 10,20\nend\n```\n\n`show etherchannel summary` で po1 が (SU)、g0/7・g0/8 が (P) になれば束ねられています。最後に、幹線のケーブルを1本ダブルクリックして Down にし、PC1 → SRV1 の ping が続くことを確かめてから Up に戻します。続けて SRV1 で `iperf3 -s`、PC1 で `iperf3 -c 192.168.20.10 -P 4` を実行し、合計（SUM）を見ます。',
      hints: ['po1 が (SD) のままなら、両方のスイッチで束ねたか、show logging で理由を確かめます。', 'VLANの設定は、メンバー（g0/7・g0/8）ではなく po1 に入れます。'],
      check: n => lacp(n, 'SW1') && lacp(n, 'SW2') && net.ping(n, 'PC1', SRV1) && cables(n, 'SW1', 'SW2').every(l => { n.setLinkState(l.id, false); const ok = net.ping(n, 'PC1', SRV1); n.setLinkState(l.id, true); return ok; }),
      solve: n => { for (const id of ['SW1', 'SW2']) n.update(id, d => lag(d, 1, 'active', 'g0/7', 'g0/8')); },
      quiz: { question: 'PC1 の `iperf3 -c 192.168.20.10 -P 4` の合計（SUM）が 1 Gbps のままなのはなぜですか？', options: ['LACP がまだ片方しか使っていないから', 'PC1 のケーブルや SW2–R1 のケーブル（どれも 1 Gbps）が、この通り道でいちばん遅いリンクだから', 'NAT が速度を半分にしているから'], answer: 1, explanation: '1つの通信の速さは、通り道でいちばん遅いリンクで決まります。幹線を 2 Gbps にしても、PC1 自身のケーブルと R1 への1本は 1 Gbps のままです。LAGが効くのは、多くの端末の通信が重なる区間（幹線）の合計容量と、1本が切れたときの継続です。' } },
  ],
  debrief: '要件 → 設計（アドレス計画・配線表）→ 配置・配線 → 設定 → 1ホップずつの確認 → 壊れたときの備え、という順番は、実際のネットワーク構築でもそのまま使えます。残っている単一障害点（SW1・SW2・R1・ISP回線）を、費用と影響の大きさで比べて次に何を二重化するか考えてみましょう。',
});
