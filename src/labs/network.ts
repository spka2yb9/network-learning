import { createDevice, NetworkSimulator } from '../simulator/core/NetworkSimulator';
import type { DeviceState } from '../simulator/core/types';
import { resolveRoute } from '../simulator/l3/RoutingTable';
import { parseRule } from '../simulator/services/FirewallEngine';
import { routingScenario } from '../simulator/scenarios/routing';
import { access, build, subinterface, trunk, tunnel } from '../simulator/scenarios/build';
import { bgpScenario, dnsScenario, firewallScenario, natScenario, ospfScenario, stpScenario, vlanScenario, vpnScenario } from '../simulator/scenarios/chapters';
import { gradeRouting } from '../challenges/routing';
import { grader } from './grade';
import type { Diagnosis, NetworkLab } from './types';

export const LAYERS = ['リンク（NIC・ケーブル・インターフェース）', 'IPアドレス・サブネットマスク', 'ARP / L2（スイッチ・VLAN）', 'ルーティング（経路・Default Gateway）', 'NAT', 'Firewall / ACL', 'DNS（名前解決）', 'TCP（待ち受けポート）', 'TLS（証明書）', 'アプリケーション（HTTP応答）'];
const layer = (answer: number, explanation: string): Diagnosis => ({ question: '原因はどの層にありましたか？', options: LAYERS, answer, explanation });
const route = (d: DeviceState, destination: string, nextHop: string) => d.routes.push({ destination, nextHop, preference: 1, metric: 0, kind: 'static' });
const ts = (text: string) => `通信できません。原因を特定して直してください。${text}`;

/** PC1 – R1 – R2 – R3 – PC3 */
export function chainScenario() {
  return build([
    { id: 'PC1', kind: 'pc', at: [0, 140], ip: { eth0: '192.168.1.10/24' }, gw: '192.168.1.1' },
    { id: 'R1', kind: 'router', at: [220, 140], ip: { 'g0/0': '192.168.1.1/24', 'g0/1': '10.0.12.1/30' } },
    { id: 'R2', kind: 'router', at: [440, 140], ip: { 'g0/0': '10.0.12.2/30', 'g0/1': '10.0.23.1/30' } },
    { id: 'R3', kind: 'router', at: [660, 140], ip: { 'g0/0': '10.0.23.2/30', 'g0/1': '192.168.3.1/24' } },
    { id: 'PC3', kind: 'pc', at: [880, 140], ip: { eth0: '192.168.3.10/24' }, gw: '192.168.3.1' },
  ], [['PC1', 'eth0', 'R1', 'g0/0'], ['R1', 'g0/1', 'R2', 'g0/0'], ['R2', 'g0/1', 'R3', 'g0/0'], ['R3', 'g0/1', 'PC3', 'eth0']]);
}
function chainSolved(n: NetworkSimulator) {
  n.update('R1', d => { d.routes = []; route(d, '0.0.0.0/0', '10.0.12.2'); });
  n.update('R3', d => { d.routes = []; route(d, '0.0.0.0/0', '10.0.23.1'); });
  n.update('R2', d => { d.routes = []; route(d, '192.168.1.0/24', '10.0.12.1'); route(d, '192.168.3.0/24', '10.0.23.2'); });
}
const webChecks = (g: ReturnType<typeof grader>) => {
  g.http('PC1 から https://www.example.com/ が表示できる', 'PC1', 'https://www.example.com/');
  g.dns('PC1 で www.example.com が 203.0.113.80 に名前解決される', 'PC1', 'www.example.com', '203.0.113.80');
};
const LINE_BRIEF = 'PC1 – R1 – R2 – R3 – PC3 が一列につながった構成です。R1とR3は両端の拠点のルータ、R2は間を中継するルータです。';

export const networkLabs: NetworkLab[] = [
  // ---------------------------------------------------------------- ② subnet
  { id: 'subnet-ts-01', chapter: 'subnet', kind: 'troubleshooting', workspace: 'network', minutes: 10, explain: false, title: 'マスクが1つ違うだけで', mission: ts('PC1からPC2（192.168.2.10）へpingが届きません。'),
    brief: 'PC1（192.168.1.10）とPC2（192.168.2.10）は、ルータR1・R2を挟んだ別々のLANにいます。R1・R2の経路は設定済みです。\n\nPC1からPC2へのpingが往復すれば完了です。まずPC1のTerminalで、PC1自身の設定から確かめましょう。',
    hints: ['PC1で ip addr と ip route get 192.168.2.10 を実行します。PC1は 192.168.2.10 へ、どの経路で送ろうとしていますか？', 'ip route get の結果に via（Gateway経由）が出ていなければ、PC1は宛先を「同じLANにいる」と判断しています。Debuggerでは、PC1がARP（IPアドレスからMACアドレスを調べる問い合わせ）で誰を探しているかを見ます。', 'PC1のプレフィックス長（/ の後ろの数字）を、同じLANにいるR1の g0/0（192.168.1.1/24）と比べます。'],
    build: () => { const n = routingScenario(true); n.configureInterface('PC1', 'eth0', '192.168.1.10/16', true); return n; },
    solve: n => n.configureInterface('PC1', 'eth0', '192.168.1.10/24', true),
    grade: s => { const g = grader(s); g.ping('PC1 から PC2 へ ping が往復する', 'PC1', '192.168.2.10'); g.check('PC1 が 192.168.2.10 を自分とは別のネットワークと判断する', n => resolveRoute(n.device('PC1'), '192.168.2.10')?.route.kind !== 'connected'); return g.done(); },
    diagnosis: layer(1, 'PC1のマスクが /16 だったため、192.168.2.10 も自分と同じネットワークに見えていました。PC1はGatewayに渡さず宛先そのものをARPで探し、誰も応答しませんでした（ip route get に via が出ないことと、DebuggerのARPで確認できます）。'),
    debrief: 'プレフィックス長は「どこまでが自分のネットワークか」を決めます。1台だけマスクが違うと「一部の宛先にだけ届かない」という分かりにくい症状になるため、実務でも ip addr では / の後ろの数字まで確認しましょう。', source: 'PC1', target: '192.168.2.10' },
  { id: 'subnet-ts-02', chapter: 'subnet', kind: 'troubleshooting', workspace: 'network', minutes: 10, explain: false, title: 'Gatewayに届かないアドレス', mission: ts('PC1がどこにも通信できません。'),
    brief: 'PC1は、R1を出口のルータ（Default Gateway：別のネットワークへ送るときにパケットを預けるルータ）として使う端末です。\n\nPC1からGateway（192.168.1.1）と、別のLANのPC2（192.168.2.10）へpingが届けば完了です。まずPC1のTerminalで ip addr と ip route を確認しましょう。',
    hints: ['PC1で ip addr と ip route を実行します。default via の行に、注意書きが出ていませんか？', 'PC1のIPアドレスと、Default Gateway 192.168.1.1 は同じネットワークにありますか？ /24 なら、先頭から3つ目までの数字が同じである必要があります。', 'Gatewayは、自分と同じLANにいないと直接渡せません。R1の g0/0（192.168.1.1/24）と同じ 192.168.1.0/24 のアドレスになっているか確認します。'],
    build: () => { const n = routingScenario(true); n.configureInterface('PC1', 'eth0', '192.168.10.10/24', true); return n; },
    solve: n => n.configureInterface('PC1', 'eth0', '192.168.1.10/24', true),
    grade: s => { const g = grader(s); g.ping('PC1 から Gateway（192.168.1.1）へ ping が届く', 'PC1', '192.168.1.1'); g.ping('PC1 から PC2 へ ping が届く', 'PC1', '192.168.2.10'); return g.done(); },
    diagnosis: layer(1, 'PC1のアドレスが 192.168.10.10/24 になっていて、Default Gateway 192.168.1.1 が自分のネットワークの外にありました。ip route の default via に「Next Hopに到達できません」と出ることで確認できます。'),
    debrief: 'Default Gatewayは、必ず自分と同じネットワークにある必要があります。実務では、IPアドレスを手で入力したときの打ち間違い（1.10 と 10.10 など）でよく起きます。' },

  // ---------------------------------------------------------------- ③ routing
  { id: 'routing-01', chapter: 'routing', kind: 'mastery', workspace: 'network', minutes: 25, title: 'ふたつのLANを、静的ルートでつなぐ', mission: 'R1とR2に経路を追加し、PC1とPC2が双方向に通信できるようにする',
    brief: 'PC1（192.168.1.0/24）とPC2（192.168.2.0/24）は、R1とR2を挟んだ別々のLANにいます。ルータは、直接つながっていないLANへの行き方を知りません。そのため、今はpingが届きません。\n\nR1・R2に、必要な静的ルート（Static Route：宛先のネットワークと、Next Hop＝次に渡すルータを手で書いた経路）を設定してください。設定はTerminal（CLI）でも、右パネルの「機器設定」（GUI）でもかまいません。PC1とPC2の間でpingが往復すれば完了です。',
    steps: ['PC1で ping 192.168.2.10 を実行し、失敗することを確認します（Terminalでも、画面の SEND バーでも実行できます）。', 'R1で show ip route を実行します。C（直結）の経路だけで、192.168.2.0/24 がないことを確認します。', 'R1で enable → configure terminal と入力して設定モードに入り、ip route 192.168.2.0/24 10.0.0.2 を設定します（10.0.0.2 は隣のR2のアドレスです）。', 'もう一度PC1からpingします。まだ失敗します。Debuggerで、Echo RequestはPC2に届くのに、Echo Replyが戻れないこと（帰りの経路がない）を確認します。', 'R2で enable → configure terminal → ip route 192.168.1.0/24 10.0.0.1 を設定します。', 'PC1で ping と traceroute 192.168.2.10、PC2で ping 192.168.1.10 を実行し、どちら向きも成功することを確認します。最後に「到達度を確認」を押します。'],
    hints: ['まずは調査から。PC1でpingを実行し、R1で show ip route を見ます。192.168.2.0/24 の行はありますか？', 'R1には「192.168.2.0/24 はR2（10.0.0.2）へ渡す」という経路が必要です。', 'pingは往復です。R1を直したら、R2にも「192.168.1.0/24 はR1（10.0.0.1）へ渡す」という帰りの経路を入れます。'],
    build: () => routingScenario(), solve: n => { n.addRoute('R1', { destination: '192.168.2.0/24', nextHop: '10.0.0.2', preference: 1, metric: 0 }); n.addRoute('R2', { destination: '192.168.1.0/24', nextHop: '10.0.0.1', preference: 1, metric: 0 }); },
    grade: s => gradeRouting(s),
    debrief: '通信には、行きと帰りの両方の経路が必要です。「片方向だけ経路を追加して、応答が返らない」は実務でも典型的なミスなので、設定のあとは必ず逆方向からも確かめましょう。', source: 'PC1', target: '192.168.2.10' },
  { id: 'routing-02', chapter: 'routing', kind: 'challenge', workspace: 'network', minutes: 25, title: 'Default Routeとループしない設計', mission: 'R1とR3はDefault Routeだけを使い、PC1とPC3が双方向に通信できるようにする',
    brief: `${LINE_BRIEF}今はどのルータにも静的ルートがありません。次の条件で経路を設定してください。\n\n- R1・R3の静的ルートは、Default Route（0.0.0.0/0：どの宛先にも一致する「その他すべて」の経路）1本だけにする\n- 中継のR2には、両端のLANへの具体的な経路を設定する\n- 存在しない宛先（例: 8.8.8.8）へのパケットが、ルータの間を行ったり来たり（ループ）しない\n\nPC1とPC3の間でpingが往復し、上の条件を満たせば完了です。`,
    hints: ['まず各ルータで show ip route を実行し、R1・R2・R3がそれぞれどのネットワークを直結（C）で知っているかを整理します。', 'R1とR3のDefault RouteはR2へ向けます。R2は、192.168.1.0/24 と 192.168.3.0/24 をそれぞれどちらのルータへ渡すかを、具体的な経路で知る必要があります。', 'R2にもDefault Routeを入れると、存在しない宛先のパケットがルータの間を往復します。traceroute 8.8.8.8 で、同じアドレスが繰り返し出ないか確かめます。'],
    build: () => chainScenario(), solve: chainSolved,
    grade: s => { const g = grader(s);
      g.ping('PC1 から PC3 へ ping が届く', 'PC1', '192.168.3.10'); g.ping('PC3 から PC1 へ ping が届く', 'PC3', '192.168.1.10');
      for (const id of ['R1', 'R3']) g.check(`${id} の静的ルートは Default Route（0.0.0.0/0）1本だけ`, n => { const r = n.device(id).routes; return r.length === 1 && r[0].destination === '0.0.0.0/0'; });
      g.check('存在しない宛先 8.8.8.8 へのパケットがループしない（TTL exceeded にならない）', n => { const r = n.ping('PC1', '8.8.8.8'); return !r.success && !r.events.some(e => e.message.includes('TTL exceeded')); });
      return g.done(); },
    debrief: 'Default Routeは1行で済む反面、知らない宛先まで送ってしまいます。「拠点のルータはDefault Route、中心のルータは具体的な経路」という役割分担は、実務のネットワークでもよく使う形です。', source: 'PC1', target: '192.168.3.10' },
  { id: 'routing-ts-01', chapter: 'routing', kind: 'troubleshooting', workspace: 'network', minutes: 15, explain: false, title: '行ったり来たりするパケット', mission: ts('PC1からPC3へ届きません。'),
    brief: `${LINE_BRIEF}R1とR3はDefault RouteでR2へ、R2は両端のLANへの具体的な経路を持つ設計です。\n\nPC1からPC3（192.168.3.10）へpingが届けば完了です。まずPC1から traceroute 192.168.3.10 を実行してみましょう。`,
    hints: ['PC1で traceroute 192.168.3.10 を実行します。同じアドレスが交互に繰り返し表示されていませんか？', '繰り返し出てくる2台のルータで show ip route 192.168.3.10 を実行し、それぞれのNext Hop（次に渡すルータ）をたどります。', 'R2は 192.168.3.0/24 をR3（10.0.23.2）へ渡すべきです。R2の経路のNext Hopがどこを向いているか確認します。'],
    build: () => { const n = chainScenario(); chainSolved(n); n.update('R2', d => { d.routes.find(r => r.destination === '192.168.3.0/24')!.nextHop = '10.0.12.1'; }); return n; },
    solve: n => n.update('R2', d => { d.routes.find(r => r.destination === '192.168.3.0/24')!.nextHop = '10.0.23.2'; }),
    grade: s => { const g = grader(s); g.ping('PC1 から PC3 へ ping が届く', 'PC1', '192.168.3.10'); g.check('R2 が 192.168.3.0/24 宛てをR3（10.0.23.2）へ転送する', n => resolveRoute(n.device('R2'), '192.168.3.10')?.nextHop === '10.0.23.2'); return g.done(); },
    diagnosis: layer(3, 'R2の 192.168.3.0/24 のNext HopがR1を向いていて、R1はDefault RouteでR2へ戻すため、パケットがTTLが尽きるまで往復していました。traceroute で 10.0.12.2 と 10.0.12.1 が交互に出ることと、R2の show ip route 192.168.3.10 で確認できます。'),
    debrief: 'tracerouteで同じアドレスが交互に出たら、ルーティングループを疑います。実務では、経路を手で変更したあとにループが起きやすいため、変更後は traceroute で道筋を確かめるのが定番です。', source: 'PC1', target: '192.168.3.10' },
  { id: 'routing-ts-02', chapter: 'routing', kind: 'troubleshooting', workspace: 'network', minutes: 15, explain: false, title: '届くのに、返ってこない', mission: ts('PC1からPC2へのpingが失敗します。ルータの経路は正しいはずです。'),
    brief: 'PC1（192.168.1.10）とPC2（192.168.2.10）は、R1・R2を挟んだ別々のLANにいます。R1・R2の経路は設定済みです。\n\nPC1からPC2へ、PC2からPC1へのpingがどちらも成功すれば完了です。PC1からpingを実行し、Debuggerでパケットの動きを追ってみましょう。',
    hints: ['PC1からpingを実行し、Debuggerを見ます。Echo Request（pingの要求）はPC2まで届いていますか？', '届いているなら、問題は帰り道です。PC2はEcho Reply（pingの応答）を、どのルータに渡そうとしていますか？ PC2で ip route を確認します。', 'PC2の default via のアドレスを、PC2のLANにいるR2の g0/1（192.168.2.1）と比べます。'],
    build: () => { const n = routingScenario(true); n.setGateway('PC2', '192.168.2.254'); return n; }, solve: n => n.setGateway('PC2', '192.168.2.1'),
    grade: s => { const g = grader(s); g.ping('PC1 から PC2 へ ping が届く', 'PC1', '192.168.2.10'); g.ping('PC2 から PC1 へ ping が届く', 'PC2', '192.168.1.10'); return g.done(); },
    diagnosis: layer(3, 'PC2のDefault Gatewayが、存在しない 192.168.2.254 になっていました。PC2は応答をルータに渡せず（ARPに誰も答えない）、Echo Requestは届くのにEcho Replyが返りませんでした。'),
    debrief: '「宛先まで届いた」と「通信が成立した」は別のことです。実務でも、サーバー側のDefault Gatewayの設定ミスで「リクエストは届いているのに応答がない」ことがあり、帰り道の確認が欠かせません。', source: 'PC1', target: '192.168.2.10' },
  { id: 'ospf-01', chapter: 'routing', kind: 'guided', workspace: 'network', minutes: 25, title: 'リンクステートで経路を自動計算する', mission: '4台のルータでOSPFを有効にし、リンク障害時も通信が続くネットワークにする',
    brief: 'R1〜R4の4台のルータが四角形につながり、R1の先にPC1、R3の先にPC3のLANがあります。静的ルートは使わず、OSPF（ルータどうしが経路情報を交換し、最短経路を自動で計算するプロトコル）で経路を作ります。\n\nPC1からPC3へ通信でき、R1–R2 または R1–R4 のどちらかのリンクが切れても通信が続けば完了です。',
    steps: ['R1で enable → configure terminal → router ospf 1 と入力し、OSPFの設定モードに入ります。', 'R1で network 10.0.0.0/16 area 0 と network 192.168.1.0/24 area 0 を設定します（ルータ間のリンクと、LAN側の両方でOSPFを動かす指定です）。R3も同じように設定し、LAN側は 192.168.3.0/24 を指定します。', 'R2・R4はルータ間のリンクだけなので、network 10.0.0.0/16 area 0 だけで十分です。', '各ルータで show ip ospf neighbor を実行し、隣のルータと隣接（状態 FULL）していることを確認します。R1で show ip route を実行し、O（OSPFで学習した経路）が出ることを確認します。', 'R1–R2のリンクをダブルクリックしてDownにし、PC1からPC3へのpingがR4経由に切り替わって続くことを確かめます。確かめたら、もう一度ダブルクリックしてUpに戻します。'],
    hints: ['経路が出ないときは、まず show ip ospf neighbor で隣接（FULL）ができているか確認します。', '隣接しない場合は show logging を見ます。エリア番号やサブネットの不一致がここに表示されます。', 'PCしかいないLAN側（R1・R3の g0/2）は passive-interface g0/2 にすると、Hello（OSPFの挨拶）を送らずに、LANのサブネットの広告だけを続けます。採点の条件ではありませんが、実務では定番の設定です。'],
    build: () => ospfScenario(false), solve: n => { const o = ospfScenario(true); for (const id of ['R1', 'R2', 'R3', 'R4']) n.update(id, d => { d.ospf = o.device(id).ospf; }); },
    grade: s => { const g = grader(s);
      g.ping('PC1 から PC3 へ ping が届く', 'PC1', '192.168.3.10');
      g.check('静的ルートを使っていない', n => ['R1', 'R2', 'R3', 'R4'].every(id => n.device(id).routes.length === 0));
      g.check('R1 が 192.168.3.0/24 をOSPFで学習している', n => resolveRoute(n.device('R1'), '192.168.3.10')?.route.kind === 'ospf');
      for (const [a, b] of [['R1', 'R2'], ['R1', 'R4']]) g.check(`${a}–${b} のリンクが切れても、PC1 から PC3 へ通信できる（冗長化）`, n => { const l = n.snapshot().links.find(x => (x.sourceDevice === a && x.targetDevice === b) || (x.sourceDevice === b && x.targetDevice === a))!; n.setLinkState(l.id, false); return n.ping('PC1', '192.168.3.10').success; });
      return g.done(); },
    debrief: 'OSPFでは、リンクが切れると各ルータがネットワークの地図（LSDB）を更新し、自動で迂回路に切り替わります。実務で障害に強いネットワークを作るときは、このように経路を二重化し、動的ルーティングを使います。', source: 'PC1', target: '192.168.3.10' },
  { id: 'ospf-ts-01', chapter: 'routing', kind: 'troubleshooting', workspace: 'network', minutes: 15, explain: false, title: '隣接しないルータ', mission: ts('PC1からPC3（192.168.3.10）へ届きません。OSPFは全ルータで設定済みです。'),
    brief: 'R1〜R4の4台が四角形につながり、OSPFで経路を交換する構成です。\n\nPC1からPC3へpingが届き、すべてのルータが隣の2台と隣接（FULL）すれば完了です。まず各ルータで show ip ospf neighbor を実行しましょう。',
    hints: ['各ルータで show ip ospf neighbor を実行します。隣接（FULL）の数が足りないルータはどれですか？', '隣接できていないルータで show logging を見ます。OSPFの設定の食い違いが表示されます。', 'OSPFは、同じリンクの両端でエリア番号が一致しないと隣接しません。R3の show running-config で network 文のエリア番号を確認し、隣のR2・R4と比べます。直すときは no network ... area 1 で消してから、area 0 で入れ直します。'],
    build: () => { const n = ospfScenario(true); n.update('R3', d => { d.ospf!.networks = d.ospf!.networks.map(x => ({ ...x, area: 1 })); }); return n; },
    solve: n => n.update('R3', d => { d.ospf!.networks = d.ospf!.networks.map(x => ({ ...x, area: 0 })); }),
    grade: s => { const g = grader(s); g.ping('PC1 から PC3 へ ping が届く', 'PC1', '192.168.3.10'); g.check('すべてのルータが、隣の2台と隣接（FULL）している', n => ['R1', 'R2', 'R3', 'R4'].every(id => n.ospf()!.neighbors.filter(x => x.device === id).length === 2)); return g.done(); },
    diagnosis: layer(3, 'R3のOSPFがエリア1、隣のR2・R4はエリア0だったため隣接できず、経路が交換されませんでした。show ip ospf neighbor で隣接が足りないことと、show logging の「エリア番号が異なります」で確認できます。'),
    debrief: 'OSPFで「設定したのに経路が来ない」ときは、まず隣接を疑います。実務でも、エリア番号やサブネットマスクの食い違いは、show ip ospf neighbor とログで最初に確認する項目です。' },

  // ---------------------------------------------------------------- ④ Ethernet / VLAN
  { id: 'vlan-01', chapter: 'ethernet-vlan', kind: 'guided', workspace: 'network', minutes: 25, title: 'VLANでLANを分割する', mission: 'SW2にVLAN 10 / 20 を作り、アクセスポートとトランクを設定する',
    brief: 'SW1とSW2の2台のスイッチに、営業部（VLAN 10：PC1・PC3）と開発部（VLAN 20：PC2・PC4）の端末がつながっています。SW1とR1は設定済みですが、SW2はVLANが作られておらず、すべてのポートがVLAN 1のままです。\n\nSW2を設定して、同じVLANどうし（PC1とPC3、PC2とPC4）が通信でき、R1経由でVLAN間も通信でき、VLAN 10とVLAN 20のブロードキャストが混ざらなければ完了です。',
    steps: ['SW2で enable → configure terminal → vlan 10 → name SALES → exit → vlan 20 → name DEV → exit と入力し、VLANを作成します。', 'interface g0/1 → switchport mode access → switchport access vlan 10 → exit。PC3のポートを、VLAN 10のアクセスポート（1つのVLANだけを運ぶポート）にします。', 'interface g0/2 → switchport access vlan 20 → exit。PC4のポートをVLAN 20にします。', 'interface g0/3 → switchport mode trunk → switchport trunk allowed vlan 10,20 → end。SW1へのポートを、複数のVLANを運ぶトランクにします。', 'PC1 → PC3（同じVLAN）、PC2 → PC4 のpingを確認します。Debuggerの「Hop」表示で、トランク上のフレームにVLAN番号（802.1Qタグ）が付いていることを見ます。', 'SW2で show vlan brief / show interfaces trunk / show mac address-table を実行し、設定と、スイッチが学習したMACアドレスを確認します。'],
    hints: ['pingが通らないときは、SW2で show vlan brief を実行し、PC3（g0/1）とPC4（g0/2）が正しいVLANに入っているか確認します。', 'show interfaces trunk で、g0/3 がトランクになっていて、VLAN 10・20 が許可されているか確認します。', 'VLANを作成していないと、ポートに割り当てても、そのVLANのフレームはスイッチで破棄されます。先に vlan 10 / vlan 20 を作ります。'],
    build: () => { const n = vlanScenario(); n.update('SW2', d => { d.vlans = []; d.interfaces.forEach(i => { if (i.switchport) i.switchport = { mode: 'access', accessVlan: 1, allowedVlans: 'all', nativeVlan: 1 }; }); }); return n; },
    solve: n => { const ref = vlanScenario(); n.update('SW2', d => { const r = ref.device('SW2'); d.vlans = r.vlans; d.interfaces = r.interfaces.map(i => ({ ...i })); }); },
    grade: s => { const g = grader(s);
      g.ping('PC1 から PC3 へ ping が届く（VLAN 10）', 'PC1', '192.168.10.13'); g.ping('PC2 から PC4 へ ping が届く（VLAN 20）', 'PC2', '192.168.20.14');
      g.ping('PC1 から PC4 へ ping が届く（R1経由のVLAN間ルーティング）', 'PC1', '192.168.20.14');
      g.check('VLAN 10 のブロードキャストが VLAN 20 に届かない', n => !n.broadcastDomain('PC1', 'eth0').some(r => r.device === 'PC2' || r.device === 'PC4'));
      return g.done(); },
    debrief: 'VLANを使うと、1台のスイッチを設定だけで複数のLANに分けられます。実務では部署や用途ごとにVLANを分け、スイッチの間はトランクで複数のVLANをまとめて運ぶのが基本の形です。', source: 'PC1', target: '192.168.10.13' },
  { id: 'vlan-02', chapter: 'ethernet-vlan', kind: 'mastery', workspace: 'network', minutes: 30, title: 'Router on a Stick を組み立てる', mission: 'R1のサブインターフェースとSW1のトランクで、VLAN 10 と VLAN 20 を相互に通信させる',
    brief: 'VLAN 10（PC1・PC3）とVLAN 20（PC2・PC4）は、スイッチの設定で別々のLANに分かれています。別のVLANへ通信するにはルータが必要ですが、今はR1にVLANごとの入口がありません。R1へつながるSW1の g0/8 も、1つのVLANしか運べないアクセスポートです。\n\nR1の1本の物理ポート（g0/0）で2つのVLANを中継する「Router on a Stick」を構成してください。各VLANのGatewayは 192.168.10.1 / 192.168.20.1 です。VLAN間でpingが通り、VLANの分離（ブロードキャストが混ざらないこと）が保たれていれば完了です。',
    hints: ['R1で show ip interface brief、SW1で show interfaces trunk を実行します。R1にGatewayのアドレスはありますか？ SW1の g0/8 はトランクになっていますか？', 'R1には、VLANごとにサブインターフェース（1つの物理ポートを論理的に分けたもの。例: g0/0.10）を作り、VLAN番号とGatewayのアドレスを設定します。SW1の g0/8 は、VLAN番号のタグが付いたフレームを運べるトランクにします。', 'R1: interface g0/0.10 → encapsulation dot1q 10 → ip address 192.168.10.1/24 → exit（g0/0.20 も同様）。SW1: interface g0/8 → switchport mode trunk'],
    build: () => { const n = vlanScenario(); n.update('R1', d => { d.interfaces = d.interfaces.filter(i => i.kind !== 'subinterface'); }); n.update('SW1', d => access(d, 1, 'g0/8')); return n; },
    solve: n => { n.update('R1', d => { subinterface(d, 'g0/0', 10, '192.168.10.1/24'); subinterface(d, 'g0/0', 20, '192.168.20.1/24'); }); n.update('SW1', d => trunk(d, 'g0/8')); },
    grade: s => { const g = grader(s);
      g.ping('PC1（VLAN 10）から PC2（VLAN 20）へ ping が届く', 'PC1', '192.168.20.12'); g.ping('PC4（VLAN 20）から PC3（VLAN 10）へ ping が届く', 'PC4', '192.168.10.13');
      g.check('VLANごとのブロードキャストドメイン（ブロードキャストが届く範囲）が分かれたまま', n => !n.broadcastDomain('PC1', 'eth0').some(r => r.device === 'PC2' || r.device === 'PC4'));
      g.check('R1 が802.1Qのサブインターフェース（2つ以上）でVLAN間をルーティングしている', n => n.device('R1').interfaces.filter(i => i.kind === 'subinterface' && i.vlan && i.address).length >= 2);
      return g.done(); },
    debrief: 'Router on a Stickは、ルータの1つのポートで複数のVLANを中継する構成です。実務ではL3スイッチのSVIで同じことをする場合も多いですが、「VLANごとにGatewayがあり、トランクでタグ付きのフレームを運ぶ」という考え方は共通です。', source: 'PC1', target: '192.168.20.12' },
  { id: 'vlan-ts-01', chapter: 'ethernet-vlan', kind: 'troubleshooting', workspace: 'network', minutes: 12, explain: false, title: '同じVLANのはずなのに', mission: ts('営業部のPC1からPC3へ通信できません。'),
    brief: '営業部（VLAN 10）はPC1・PC3、開発部（VLAN 20）はPC2・PC4です。PC1はSW1に、PC3はSW2につながり、2台のスイッチはトランクで結ばれています。\n\nPC1からPC3（192.168.10.13）へpingが届けば完了です。まずPC1からpingを実行し、Debuggerでフレームがどこまで届くかを確かめましょう。',
    hints: ['PC1からpingを実行し、Debuggerを見ます。PC1のARP（相手のMACアドレスを調べる問い合わせ）は、PC3まで届いていますか？', 'ARPは同じVLANの中にしか届きません。SW1とSW2で show vlan brief を実行し、PC1とPC3がつながるポートのVLANを比べます。', 'PC3がつながっているのは、SW2の g0/1 です。このポートが営業部のVLAN 10に入っているか確認します。'],
    build: () => { const n = vlanScenario(); n.update('SW2', d => access(d, 20, 'g0/1')); return n; }, solve: n => n.update('SW2', d => access(d, 10, 'g0/1')),
    grade: s => { const g = grader(s); g.ping('PC1 から PC3 へ ping が届く', 'PC1', '192.168.10.13'); g.check('PC3 が VLAN 10 のブロードキャストドメインにいる', n => n.broadcastDomain('PC1', 'eth0').some(r => r.device === 'PC3')); return g.done(); },
    diagnosis: layer(2, 'SW2のPC3のポート（g0/1）がVLAN 20に入っていたため、VLAN 10のARPがPC3に届きませんでした。SW2の show vlan brief で、g0/1 がVLAN 20の行に表示されることで確認できます。'),
    debrief: '同じサブネットのIPアドレスを設定していても、VLANが違えばARPが届かず通信できません。実務では、機器の移設やケーブルの差し替えのあとに、アクセスポートのVLAN設定漏れがよく起きます。', source: 'PC1', target: '192.168.10.13' },
  { id: 'vlan-ts-02', chapter: 'ethernet-vlan', kind: 'troubleshooting', workspace: 'network', minutes: 12, explain: false, title: 'トランクを通れないVLAN', mission: ts('開発部のPC2からPC4へ通信できません。営業部は問題ありません。'),
    brief: '営業部（VLAN 10）はPC1・PC3、開発部（VLAN 20）はPC2・PC4です。PC1・PC2はSW1に、PC3・PC4はSW2につながり、SW1とSW2はトランク（複数のVLANを運ぶポート）で結ばれています。\n\nPC2からPC4へ、PC1からPC3へのpingがどちらも届けば完了です。まずPC2からpingを実行し、Debuggerでフレームがどこで止まるかを確かめましょう。',
    hints: ['PC2からpingを実行し、Debuggerを見ます。VLAN 20のフレームは、どのスイッチのどのポートで止まっていますか？', 'SW1とSW2で show interfaces trunk を実行し、「Vlans allowed on trunk」（そのトランクで通してよいVLAN）を比べます。', 'SW1の g0/3 でVLAN 20が許可されているか確認します。許可リストへの追加は switchport trunk allowed vlan add 20 です。'],
    build: () => { const n = vlanScenario(); n.update('SW1', d => trunk(d, 'g0/3', [10])); return n; }, solve: n => n.update('SW1', d => trunk(d, 'g0/3', [10, 20])),
    grade: s => { const g = grader(s); g.ping('PC2 から PC4 へ ping が届く（VLAN 20）', 'PC2', '192.168.20.14'); g.ping('PC1 から PC3 へ ping が届く（VLAN 10）', 'PC1', '192.168.10.13'); return g.done(); },
    diagnosis: layer(2, 'SW1のトランク（g0/3）で許可されたVLANが10だけになっていて、VLAN 20のフレームが破棄されていました。SW1の show interfaces trunk の「Vlans allowed on trunk」で確認できます。'),
    debrief: 'トランクで通すVLANは、必要なものだけに絞るのが実務の定石です。その反面、VLANを新しく追加したときに許可リストへの追加を忘れると、「そのVLANだけ通らない」障害になります。', source: 'PC2', target: '192.168.20.14' },
  { id: 'vlan-ts-03', chapter: 'ethernet-vlan', kind: 'troubleshooting', workspace: 'network', minutes: 12, explain: false, title: 'Gatewayに届かないVLAN', mission: ts('同じVLAN内は通信できますが、別のVLANへは通信できません。'),
    brief: 'VLAN 10（PC1・PC3）とVLAN 20（PC2・PC4）の間は、R1が中継する構成（Router on a Stick）です。R1には、VLANごとのサブインターフェースとGateway（192.168.10.1 / 192.168.20.1）が設定済みです。\n\nPC1から別のVLANのPC2へ、同じVLANのPC3へのpingがどちらも届けば完了です。',
    hints: ['PC1から、自分のGateway 192.168.10.1 へpingしてみます。届きますか？', 'Gatewayに届かないなら、PC1とR1の間にあるSW1を調べます。SW1で show interfaces trunk と show vlan brief を実行し、R1へつながる g0/8 の状態を見ます。', 'R1のサブインターフェースは、VLAN番号のタグ（802.1Q）が付いたフレームを受け取ります。SW1の g0/8 は、タグ付きのフレームを運べるトランクになっていますか？'],
    build: () => vlanScenario(false), solve: n => n.update('SW1', d => trunk(d, 'g0/8')),
    grade: s => { const g = grader(s); g.ping('PC1 から PC2 へ ping が届く（VLAN間）', 'PC1', '192.168.20.12'); g.ping('PC1 から PC3 へ ping が届く（同じVLAN）', 'PC1', '192.168.10.13'); return g.done(); },
    diagnosis: layer(2, 'R1へつながるSW1の g0/8 がアクセスポート（VLAN 1）だったため、VLAN 10・20のフレームがR1へ送られず、GatewayへのARPが届きませんでした。SW1の show interfaces trunk に g0/8 が表示されないことで確認できます。'),
    debrief: '「同じVLANは通るのに、別のVLANだけ通らない」なら、Gatewayまでの区間を疑います。実務でも、ルータやL3スイッチへつながるポートがトランクになっていない設定漏れはよくあります。' },
  { id: 'stp-01', chapter: 'ethernet-vlan', kind: 'guided', workspace: 'network', minutes: 20, title: 'ループとSpanning Tree', mission: 'コアスイッチSW3をRoot Bridgeにし、ループを安全に遮断する',
    brief: 'SW1・SW2・SW3の3台が三角形につながっていて、物理的なループがあります。STP（Spanning Tree Protocol：一部のポートをブロックして、ループのない木の形にする仕組み）は有効ですが、今はMACアドレスの大小でRoot Bridge（木の根になるスイッチ）が決まっています。\n\nコアスイッチのSW3をRoot Bridgeにし、すべてのスイッチでSTPを有効にしたまま、PC1からPC2へブロードキャストストームなしで通信できれば完了です。',
    steps: ['各スイッチで show spanning-tree を実行し、今のRoot Bridge（Root ID）と、ブロックされているポート（Sts が BLK）を確認します。', 'SW3で enable → configure terminal → spanning-tree priority 4096 と入力します（priorityは小さいほど優先されます。既定値は32768）。', 'もう一度各スイッチで show spanning-tree を実行し、SW3がRoot Bridgeになり、ブロックされるポートが変わったことを確認します。', '（実験）すべてのスイッチで no spanning-tree を設定してPC1からpingすると、Event Logでブロードキャストストームを観察できます。最後に、各スイッチの設定モードで spanning-tree と入力し、STPを有効に戻してください。'],
    hints: ['show spanning-tree の Root ID が自分の Bridge ID と同じスイッチ（This bridge is the root と表示される）が、Root Bridgeです。', 'Bridge ID は「priority＋MACアドレス」で、値が小さいスイッチがRoot Bridgeになります。MACアドレスは変えられないので、priorityを下げます。', 'priorityは4096の倍数で指定します。SW3で spanning-tree priority 4096 を設定します。'],
    build: () => stpScenario(true), solve: n => n.update('SW3', d => { d.stp = { enabled: true, priority: 4096 }; }),
    grade: s => { const g = grader(s); g.check('SW3 がRoot Bridgeになっている', n => n.stpState().bridges.get('SW3')?.isRoot === true); g.check('すべてのスイッチでSTPが有効', n => ['SW1', 'SW2', 'SW3'].every(id => n.device(id).stp?.enabled !== false));
      g.check('PC1 から PC2 へ、ブロードキャストストームなしで ping が届く', n => { const r = n.ping('PC1', '192.168.1.12'); return r.success && !r.events.some(e => e.type === 'BROADCAST_STORM'); }); return g.done(); },
    debrief: 'Root Bridgeは、MACアドレスの大小に任せず、意図して決めるものです。実務ではコアスイッチのpriorityを下げておき、古い機器や末端のスイッチがRootにならないようにします。', source: 'PC1', target: '192.168.1.12' },

  // ---------------------------------------------------------------- ⑤ DNS
  { id: 'dns-01', chapter: 'dns', kind: 'guided', workspace: 'network', minutes: 20, title: '名前解決を、たどる', mission: 'AUTHサーバーに api.example.com（203.0.113.81）を登録し、PC1から名前解決できるようにする',
    brief: 'PC1は、社内の再帰リゾルバ RESOLVER（PCの代わりに、ほかのDNSサーバーへ聞いて回るサーバー）に名前解決を頼みます。RESOLVERは、Root → TLD（com.）→ 権威DNSサーバー AUTH の順に問い合わせて答えを見つけます。\n\nexample.com ゾーンを管理するAUTHに、新しいAレコード（名前とIPv4アドレスの対応）api.example.com → 203.0.113.81 を追加してください。PC1で api.example.com が 203.0.113.81 に解決でき、既存の www.example.com も表示できれば完了です。',
    steps: ['PC1で dig www.example.com +trace を実行し、Root → TLD → 権威サーバーの順に「次に聞く相手」を案内される様子（委任）を確認します。', 'PC1で dig www.example.com を2回実行します。2回目はRESOLVERのキャッシュから答えが返るため、Query time が短くなることを確認します。', 'AUTHを選択し、右パネルの「機器設定」にあるDNSサーバー（ゾーン）の設定で、名前 api・型 A・値 203.0.113.81 のレコードを追加します。', 'PC1で dig api.example.com を実行し、203.0.113.81 が返ることを確認します。', '（観察）PC1で sleep 60（仮想時間を60秒進める）を実行してから、もう一度 dig www.example.com を実行します。ANSWER SECTION のTTLはどう変わりましたか？'],
    hints: ['レコードの名前の欄に api と入力すると、ゾーン名が補われて api.example.com.（末尾のドット付き）として登録されます。', 'dig api.example.com で答えが返らないときは、AUTHのレコード一覧に api.example.com. の A レコードがあり、値のIPアドレスが正しいか確認します。', '追加する前に dig api.example.com を実行していた場合、RESOLVERは「その名前はない（NXDOMAIN）」という答えをしばらくキャッシュしています。RESOLVERのTerminalで rndc flush を実行するか、sleep 300 で時間を進めてから確かめます。'],
    build: () => dnsScenario(), solve: n => n.update('AUTH', d => { d.dnsServer!.zones[0].records.push({ name: 'api.example.com.', type: 'A', ttl: 300, value: '203.0.113.81' }); }),
    grade: s => { const g = grader(s); g.dns('PC1 で api.example.com が 203.0.113.81 に名前解決される', 'PC1', 'api.example.com', '203.0.113.81'); webChecks(g); return g.done(); },
    debrief: 'DNSは、権威サーバーに登録した内容をリゾルバがたどって見つけ、TTLの間キャッシュする仕組みです。実務でレコードを追加・変更したときは、キャッシュが残っている間は古い答えが返ることを前提に作業します。', source: 'PC1', target: '203.0.113.80' },
  { id: 'dns-ts-01', chapter: 'dns', kind: 'troubleshooting', workspace: 'network', minutes: 12, explain: false, title: '聞く相手を間違えている', mission: ts('PC1で https://www.example.com/ が開けません。http://203.0.113.80/ のようにIPアドレスを直接指定すると表示できます。'),
    brief: 'PC1から https://www.example.com/ が表示でき、www.example.com が 203.0.113.80 に名前解決されれば完了です。\n\nIPアドレスなら届くことから、どの層を調べるべきかを考え、PC1のTerminalから調査を始めましょう。',
    hints: ['PC1で dig www.example.com を実行します。status、ANSWER SECTION に答えがあるか、WARNING の行を読みます。', 'PC1が問い合わせるDNSサーバーは、cat /etc/resolv.conf の nameserver 行で確認できます。そのIPアドレスは、構成図のどの機器ですか？ その機器は、名前解決を代わりにたどってくれる再帰リゾルバですか？', 'ROOT（198.51.100.10）は権威サーバーなので、再帰の問い合わせには答えず、次に聞く相手（com. のNS）を案内するだけです。PCが問い合わせるのは再帰リゾルバ RESOLVER（192.168.1.53）です。変更は echo "nameserver <IP>" > /etc/resolv.conf か、「機器設定」のDNSクライアントの設定で行います。'],
    build: () => { const n = dnsScenario(); n.update('PC1', d => { d.dnsServers = ['198.51.100.10']; }); return n; }, solve: n => n.update('PC1', d => { d.dnsServers = ['192.168.1.53']; }),
    grade: s => { const g = grader(s); webChecks(g); return g.done(); }, diagnosis: layer(6, 'PC1のDNSサーバー設定（/etc/resolv.conf）が、再帰リゾルバではなくルートサーバー ROOT（198.51.100.10）を指していました。ROOTは再帰の問い合わせに応じない権威サーバーなので、dig に「recursion requested but not available」の警告が出て、答え（ANSWER）が返りません。'),
    debrief: '「IPアドレスなら届くのに、名前だと失敗する」は、DNSを疑う典型的なサインです。PCが問い合わせるのは、名前解決を代わりにたどってくれる再帰リゾルバです。権威サーバー（ルート・TLD・自社ゾーンのサーバー）は、自分の担当範囲しか答えません。実務では、DHCPなどで配るDNSサーバーのアドレスを、権威サーバーと取り違える設定ミスとして起きます。', source: 'PC1', target: '203.0.113.80' },
  { id: 'dns-ts-02', chapter: 'dns', kind: 'troubleshooting', workspace: 'network', minutes: 15, explain: false, title: '名前は引けるのに', mission: ts('PC1で https://www.example.com/ が表示できません。dig www.example.com では答えが返ってきます。'),
    brief: 'PC1は、再帰リゾルバ RESOLVER を通して www.example.com を名前解決し、WebサーバーWEBに接続します。\n\nPC1から https://www.example.com/ が表示でき、www.example.com が 203.0.113.80 に名前解決されれば完了です。まずPC1で dig と curl の結果を見比べましょう。',
    hints: ['PC1で dig www.example.com を実行し、ANSWER SECTION のIPアドレスをメモします。そのIPアドレスは、構成図のWEBのアドレスと同じですか？', '名前とIPアドレスの対応（Aレコード）は、example.com ゾーンを管理する権威DNSサーバー AUTH が持っています。AUTHの「機器設定」で、ゾーンのレコードを確認します。', '修正したあとも、RESOLVERのキャッシュが残っている間（TTL 300秒）は古い答えが返ります。RESOLVERのTerminalで rndc flush を実行するか、sleep 300 で仮想時間を進めてから確かめます。'],
    build: () => { const n = dnsScenario(); n.update('AUTH', d => { d.dnsServer!.zones[0].records.find(r => r.name === 'www.example.com.' && r.type === 'A')!.value = '203.0.113.8'; }); return n; },
    solve: n => n.update('AUTH', d => { d.dnsServer!.zones[0].records.find(r => r.name === 'www.example.com.' && r.type === 'A')!.value = '203.0.113.80'; }),
    grade: s => { const g = grader(s); webChecks(g); return g.done(); }, diagnosis: layer(6, '権威サーバーAUTHの www.example.com のAレコードが 203.0.113.8 と誤っていました。dig の答えがWEBのアドレス（203.0.113.80）と違うことで確認できます。修正後も、リゾルバのキャッシュ（TTL 300秒）が切れるまでは古い値が返ることがあります。'),
    debrief: 'DNSレコードを変更するときは、事前にTTLを短くしておく（例: 300 → 60）と、キャッシュによる切り替えの遅れを小さくできます。実務の切り替え作業では定番の手順です。' },
  { id: 'dns-ts-03', chapter: 'dns', kind: 'troubleshooting', workspace: 'network', minutes: 15, explain: false, title: '委任の糸が切れている', mission: ts('example.com の名前がまったく解決できません（SERVFAIL）。他のドメインには影響しないはずです。'),
    brief: '名前解決は、再帰リゾルバ RESOLVER が Root → TLD（com.）→ example.com の権威サーバー AUTH の順に、案内をたどって行います。\n\nPC1から https://www.example.com/ が表示でき、www.example.com が 203.0.113.80 に名前解決されれば完了です。',
    hints: ['PC1で dig www.example.com +trace を実行します。どのサーバーまで進み、どこで止まりますか？', '止まる直前のサーバーは、次に聞く相手としてどのIPアドレスを案内していますか？ そのアドレスは、実際のAUTH（198.51.100.30）と同じですか？', 'TLDは、委任先の ns1.example.com の住所（glueレコード）も一緒に返します。TLDのゾーンで ns1.example.com. のAレコードを確認します。直したあとも SERVFAIL が返るときは、RESOLVERに古い案内がキャッシュされているので、RESOLVERで rndc flush を実行します。'],
    build: () => { const n = dnsScenario(); n.update('TLD', d => { d.dnsServer!.zones[0].records.find(r => r.name === 'ns1.example.com.')!.value = '198.51.100.31'; }); return n; },
    solve: n => n.update('TLD', d => { d.dnsServer!.zones[0].records.find(r => r.name === 'ns1.example.com.')!.value = '198.51.100.30'; }),
    grade: s => { const g = grader(s); webChecks(g); return g.done(); }, diagnosis: layer(6, 'TLD（com.）が返す ns1.example.com のglueレコードが誤ったIP（198.51.100.31）を指していて、リゾルバが権威サーバーに問い合わせできませんでした。dig +trace で、TLDの案内のあと 198.51.100.31 がタイムアウトすることで確認できます。'),
    debrief: '委任は、親ゾーン（ここでは com.）に子ゾーンのNSレコードとglueを置くことで成り立ちます。実務では、DNSサーバーのIPアドレスを変えたときに、ドメインの登録事業者側のglueの更新を忘れると、このような障害になります。' },
  { id: 'dns-02', chapter: 'dns', kind: 'mastery', workspace: 'network', minutes: 25, title: 'サービス追加のDNS設計', mission: 'blogの別名・メールの受信先の切り替え・所有確認用のTXTを、DNSのレコードで実現する',
    brief: '権威DNSサーバー AUTH の example.com ゾーンを変更し、次の要件を満たしてください。レコードは、AUTHの「機器設定」にあるDNSサーバー（ゾーン）の設定で追加・削除できます。\n\n- blog.example.com を www.example.com の別名にする（CNAMEレコード：名前に別名を付けるレコード）\n- メールの受信先を mail2.example.com に切り替える（MXレコード：メールの配送先を示すレコード）。MXは「優先度 10・mail2.example.com」の1件だけにし、mail2.example.com のAレコード（203.0.113.26）も用意する\n- 所有確認用の TXT レコード `path-verify=7f3a` を example.com に追加する\n- 既存の www.example.com は壊さない\n\nPC1から dig で確かめて、すべての答えが要件どおりなら完了です。',
    hints: ['PC1で dig blog.example.com、dig example.com MX、dig example.com TXT を実行し、今の答えを確認します。', 'CNAMEを置いた名前には、ほかのレコード（AやMXなど）を同時に置けません。そのため、ゾーンの頂点（example.com そのもの）ではなく、blog.example.com にCNAMEを置きます。', 'MXの値は「優先度 ホスト名」の形（例: 10 mail2.example.com.）です。古いMX（10 mail.example.com.）を削除し、mail2.example.com のAレコードも追加します。変更後に古い答えが返るときは、RESOLVERで rndc flush を実行します。'],
    build: () => dnsScenario(),
    solve: n => n.update('AUTH', d => { const z = d.dnsServer!.zones[0]; z.records = z.records.filter(r => r.type !== 'MX'); z.records.push({ name: 'blog.example.com.', type: 'CNAME', ttl: 300, value: 'www.example.com.' }, { name: 'mail2.example.com.', type: 'A', ttl: 3600, value: '203.0.113.26' }, { name: 'example.com.', type: 'MX', ttl: 3600, value: '10 mail2.example.com.' }, { name: 'example.com.', type: 'TXT', ttl: 3600, value: 'path-verify=7f3a' }); }),
    grade: s => { const g = grader(s);
      g.check('blog.example.com が www.example.com のCNAMEで、203.0.113.80 に名前解決される', n => { const a = n.dnsLookup('PC1', 'blog.example.com').message?.answer ?? []; return a.some(r => r.type === 'CNAME' && r.value === 'www.example.com.') && a.some(r => r.value === '203.0.113.80'); });
      g.check('example.com のMXは mail2.example.com（優先度10）の1件だけ', n => { const a = n.dnsLookup('PC1', 'example.com', 'MX').message?.answer ?? []; return a.length === 1 && a[0].value === '10 mail2.example.com.'; });
      g.check('mail2.example.com が 203.0.113.26 に名前解決される', n => !!n.dnsLookup('PC1', 'mail2.example.com').message?.answer.some(r => r.value === '203.0.113.26'));
      g.check('example.com の TXT に path-verify=7f3a がある', n => !!n.dnsLookup('PC1', 'example.com', 'TXT').message?.answer.some(r => r.value === 'path-verify=7f3a'));
      webChecks(g); return g.done(); },
    debrief: 'CNAME・MX・TXTは、Webサービスの追加、メールの移行、外部サービスの所有確認などで日常的に使うレコードです。実務では変更前にTTLを確認し、キャッシュが切れるまでは新旧どちらの答えも返りうることを見込んで作業します。' },

  // ---------------------------------------------------------------- ⑥ NAT / Firewall
  { id: 'nat-01', chapter: 'nat-firewall', kind: 'guided', workspace: 'network', minutes: 20, title: 'プライベートアドレスでインターネットへ', mission: 'R1にPATを設定し、PC1・PC2がインターネットのSRVへアクセスできるようにする',
    brief: 'PC1・PC2は、プライベートアドレス（192.168.1.0/24：組織の中だけで使うアドレス）のLANにいます。インターネット側のISPはこのアドレスへの経路を持たないため、SRV（198.51.100.80）からの応答が戻ってこられません。\n\nR1にPAT（送信元のアドレスとポート番号を書き換えて、多数の端末で1つのグローバルアドレスを共有する仕組み）を設定してください。PC1・PC2から http://198.51.100.80/ が表示でき、インターネット側から見た送信元がR1のグローバルアドレス（203.0.113.2）になっていれば完了です。',
    steps: ['PC1で curl http://198.51.100.80/ を実行します。応答が返りません。Debuggerで、パケットがどこで止まるか確認します（ISPは 192.168.1.0/24 への経路を持ちません）。', 'R1で enable → configure terminal → ip nat inside source 192.168.1.0/24 interface g0/1 overload と入力します（192.168.1.0/24 からの通信を、g0/1 のアドレスに変換するという意味です）。', 'PC1・PC2から curl を実行します。R1で show ip nat translations を実行し、内側のアドレス（Inside local）がすべて同じ 203.0.113.2（Inside global）に変換され、ポート番号で区別されていることを観察します。'],
    hints: ['R1の g0/0 は ip nat inside（内側）、g0/1 は ip nat outside（外側）に設定済みです。show running-config で確認できます。', 'ISPにプライベートアドレスへの経路を追加するのは不正解です（プライベートアドレスは、インターネットではルーティングされません）。', 'PATは、Ciscoの設定では overload と呼びます。ip nat inside source <変換する範囲> interface <外側のポート> overload の形です。'],
    build: () => natScenario(false), solve: n => n.update('R1', d => { d.nat = [{ id: 'pat', type: 'pat', source: '192.168.1.0/24', outInterface: 'g0/1' }]; }),
    grade: s => { const g = grader(s);
      g.http('PC1 から http://198.51.100.80/ が表示できる', 'PC1', 'http://198.51.100.80/'); g.http('PC2 から http://198.51.100.80/ が表示できる', 'PC2', 'http://198.51.100.80/');
      g.check('ISPにプライベートアドレスへの経路を追加していない', n => !n.table('ISP').some(r => r.destination.startsWith('192.168.')));
      g.check('インターネット側から見た送信元が、R1のグローバルアドレス（203.0.113.2）になっている', n => { const r = n.ping('PC1', '198.51.100.80'); const link = n.snapshot().links.find(l => l.sourceDevice === 'R1' && l.targetDevice === 'ISP')!.id; return r.captures.filter(c => c.linkId === link && c.protocol === 'ICMP').every(c => c.source === '203.0.113.2' || c.destination === '203.0.113.2'); });
      return g.done(); },
    debrief: 'PATは、家庭のルータや会社のインターネットの出口で、ほぼ必ず使われている仕組みです。実務の障害調査では、show ip nat translations（NATテーブル）を見て、変換が起きているかを最初に確かめます。', source: 'PC1', target: '198.51.100.80' },
  { id: 'nat-02', chapter: 'nat-firewall', kind: 'challenge', workspace: 'network', minutes: 20, title: '内側のサーバーを必要な分だけ公開する', mission: 'NASのWeb（80番）を、外から http://203.0.113.2:8080 で見られるようにする（ほかのポートは公開しない）',
    brief: '社内LANのNAS（192.168.1.20）は、TCPの80番でWeb画面を提供しています。R1には、社内からインターネットへ出るためのPATが設定済みです。\n\nインターネット側のEXTから http://203.0.113.2:8080/ でNASの画面が見えるようにしてください。公開するのはこの1つのポートだけです。NASを丸ごと外に見せる静的NAT（1対1の変換）は使わず、ポートフォワード（外側の特定のポートを、内側のサーバーの特定のポートへ転送する変換）で実現します。社内PCのインターネット接続も維持してください。まずEXTで curl http://203.0.113.2:8080/ を試してから、R1を設定しましょう。',
    hints: ['R1で show ip nat translations と show running-config を実行し、今どんな変換ルールがあるか確認します。', '必要なのは、「外側のアドレスの8080番に来たTCPを、192.168.1.20 の80番へ転送する」という宛先の変換です。', 'ip nat inside source static tcp <内側IP> <内側ポート> interface g0/1 <外側ポート>'],
    build: () => natScenario(true), solve: n => n.update('R1', d => { d.nat!.push({ id: 'nas', type: 'port-forward', protocol: 'tcp', inside: '192.168.1.20', insidePort: 80, outside: '203.0.113.2', outsidePort: 8080 }); }),
    grade: s => { const g = grader(s);
      g.check('EXT から http://203.0.113.2:8080/ でNASの画面が表示される', n => (n.http('EXT', 'http://203.0.113.2:8080/').body ?? '').includes('NAS'));
      g.tcp('インターネット側から 203.0.113.2 の80番には接続できない（公開していない）', 'EXT', '203.0.113.2', 80, false);
      g.check('NASを1対1の静的NATで丸ごと公開していない', n => !n.device('R1').nat!.some(r => r.type === 'static'));
      g.check('公開しているのは 8080 → NAS:80 の1つだけ', n => n.device('R1').nat!.filter(r => r.type !== 'pat').length === 1);
      g.http('PC1 から http://198.51.100.80/ が表示できる（インターネット接続を維持）', 'PC1', 'http://198.51.100.80/');
      return g.done(); },
    debrief: 'ポートフォワードや静的NATを設定すると、そのポートにはインターネットの誰でも届きます。実務では公開するポートを最小限にし、Firewallの許可ルールとセットで管理します。' },
  { id: 'nat-ts-01', chapter: 'nat-firewall', kind: 'troubleshooting', workspace: 'network', minutes: 12, explain: false, title: '変換されないNAT', mission: ts('社内からインターネットへ出られません。NATルールは設定済みです。'),
    brief: '社内LAN（192.168.1.0/24）の端末は、R1のPATでアドレスを変換してインターネットへ出る構成です。\n\nPC1から http://198.51.100.80/ が表示できれば完了です。まずR1の状態を show コマンドで確認しましょう。',
    hints: ['PC1から curl http://198.51.100.80/ を実行したあと、R1で show ip nat translations を見ます。変換の記録はありますか？', 'NATは、ルールだけでなく「どのインターフェースが内側（inside）・外側（outside）か」の指定があって初めて動きます。R1で show running-config を確認します。', 'LAN側（g0/0）とインターネット側（g0/1）に、それぞれ ip nat inside / ip nat outside が設定されているか比べます。'],
    build: () => { const n = natScenario(true); n.update('R1', d => { delete d.interfaces[0].nat; }); return n; }, solve: n => n.update('R1', d => { d.interfaces[0].nat = 'inside'; }),
    grade: s => { const g = grader(s); g.http('PC1 から http://198.51.100.80/ が表示できる', 'PC1', 'http://198.51.100.80/'); return g.done(); },
    diagnosis: layer(4, 'LAN側のインターフェース（g0/0）に ip nat inside がなかったため、社内からの通信がNATの対象になりませんでした。show ip nat translations が空のままで、show running-config の g0/0 に ip nat inside がないことで確認できます。'),
    debrief: 'NATは「ルール」と「inside / outside の指定」がそろって初めて動きます。実務でも、インターフェースの追加や交換のあとに ip nat inside の付け忘れが起きやすいので、NATテーブルが空なら最初に疑いましょう。' },
  { id: 'fw-01', chapter: 'nat-firewall', kind: 'mastery', workspace: 'network', minutes: 35, title: 'DMZを守るFirewallポリシー', mission: '必要な通信だけを許可するステートフルFirewallポリシーを作る',
    brief: 'FWは、社内（inside：10.0.1.0/24）・DMZ（公開サーバーを置く区画：10.0.2.0/24）・インターネット（outside）の境目にあります。FWは既定ですべて拒否（default deny）で、今は許可ルールが1つもありません。NAT（社内のPATと、公開Webのポートフォワード）は設定済みです。\n\n次を満たすルールを作ってください。\n\n- 社内（10.0.1.0/24）→ DMZのWeb（10.0.2.80）: HTTPS(443) だけ許可\n- インターネット → 公開Web（203.0.113.2:443 → DMZWEB）: 許可\n- 社内 → インターネット: 許可\n- インターネット → 社内: すべて拒否\n- DMZ → 社内: すべて拒否（DMZのサーバーが乗っ取られても、社内へ被害を広げないため）\n- 社内 → DMZ のSSH(22): 拒否\n- FWはステートフル・default deny のまま\n\n社内からの確認は、PC1で curl -k https://10.0.2.80/ を使います（DMZWEBの証明書の名前が 10.0.2.80 ではないため、-k で証明書の検証を省きます）。',
    hints: ['FWで show firewall を実行し、モード・既定の動作・今あるルールを確認します。', 'ステートフル（行きの通信を記録し、その戻りを自動で許可する方式）なので、戻りの通信のためのルールは不要です。インターネットからの公開Webは、宛先をDNAT（宛先の変換）後の内側アドレス 10.0.2.80 で書きます。', '例: firewall rule 10 permit tcp 10.0.1.0/24 host 10.0.2.80 eq 443。社内 → インターネットを permit ip 10.0.1.0/24 any だけで書くと、DMZへのSSHまで許可されます。out g0/0（出口のインターフェース）で限定します。'],
    build: () => firewallScenario(false), solve: n => n.update('FW', d => { d.firewall!.rules = firewallScenario(true).device('FW').firewall!.rules; }),
    grade: s => { const g = grader(s);
      g.http('社内（PC1）から DMZのWeb に HTTPS で接続できる', 'PC1', 'https://10.0.2.80/', true, true);
      g.http('インターネット（EXT）から公開Web https://203.0.113.2/ が表示できる', 'EXT', 'https://203.0.113.2/');
      g.ping('社内（PC1）からインターネット（198.51.100.50）へ ping が届く', 'PC1', '198.51.100.50');
      g.ping('インターネット（EXT）から社内へは ping が届かない（拒否）', 'EXT', '10.0.1.10', false);
      g.ping('DMZ（DMZWEB）から社内へは ping が届かない（拒否）', 'DMZWEB', '10.0.1.10', false);
      g.check('DMZ（DMZWEB）から社内へは TCP も届かない（拒否）', n => { const r = n.tcpConnect('DMZWEB', '10.0.1.10', 445); return !r.success && !r.refused; });
      g.tcp('社内（PC1）から DMZ の SSH(22) には接続できない（拒否）', 'PC1', '10.0.2.80', 22, false);
      g.tcp('社内（PC1）から DMZ の HTTP(80) には接続できない（HTTPSだけ許可）', 'PC1', '10.0.2.80', 80, false);
      g.check('FWはステートフル・default deny のまま', n => n.device('FW').firewall!.stateful && n.device('FW').firewall!.defaultAction === 'deny');
      return g.done(); },
    debrief: 'Firewallのポリシーは、「誰から・誰へ・どのポートを」許可するかを先に表にしてから書くと、漏れや許可のしすぎに気づきやすくなります。実務のDMZ設計でも、DMZ → 社内は原則拒否にして、被害の範囲を限定します。' },
  { id: 'fw-ts-01', chapter: 'nat-firewall', kind: 'troubleshooting', workspace: 'network', minutes: 15, explain: false, title: '行きは許可、帰りは？', mission: ts('社内からDMZのWebに接続できなくなりました。ルールは変えていないそうです。'),
    brief: '社内（PC1：10.0.1.10）から DMZのWeb（DMZWEB：10.0.2.80）へのHTTPS接続は、FWのルールで許可されているはずです。\n\nPC1から curl -k https://10.0.2.80/ が成功し、インターネットから社内へは拒否されたまま、FWの既定の動作（default deny）も変えずに直せたら完了です（-k は、証明書の名前が 10.0.2.80 と一致しないため付けます）。',
    hints: ['FWで show firewall を実行します。ルールだけでなく、1行目のモード（mode）も確認します。', 'PC1から curl -k https://10.0.2.80/ を実行し、Debuggerを見ます。SYN（接続の要求）はDMZWEBに届いていますか？ SYN-ACK（応答）はどこで止まりますか？', 'ステートレスなFirewallでは、戻りの通信（DMZWEB → PC1 のSYN-ACK）にも許可ルールが必要です。ステートフルなら戻りは自動で許可されます。モードは firewall mode stateful|stateless で切り替えます。'],
    build: () => { const n = firewallScenario(true); n.update('FW', d => { d.firewall!.stateful = false; }); return n; }, solve: n => n.update('FW', d => { d.firewall!.stateful = true; }),
    grade: s => { const g = grader(s); g.http('社内（PC1）から DMZのWeb に HTTPS で接続できる', 'PC1', 'https://10.0.2.80/', true, true); g.ping('インターネット（EXT）から社内へは ping が届かないまま（拒否）', 'EXT', '10.0.1.10', false); g.check('FWの既定の動作は default deny のまま', n => n.device('FW').firewall!.defaultAction === 'deny'); g.ping('DMZ（DMZWEB）から社内へは ping が届かないまま（拒否）', 'DMZWEB', '10.0.1.10', false); return g.done(); },
    diagnosis: layer(5, 'FWがステートレスに変更されていて、戻りの通信（SYN-ACK）を許可するルールがないため破棄されていました。show firewall の mode stateless と、DebuggerでSYNは届くのにSYN-ACKがFWで止まることで確認できます。'),
    debrief: '「ルールは変えていない」のに通らないときは、ルール以外の設定（モードや既定の動作）も確かめます。ステートフルかどうかで必要なルールの数が大きく変わるため、実務でもFirewallの動作モードは最初に確認する項目です。' },
  { id: 'fw-ts-02', chapter: 'nat-firewall', kind: 'troubleshooting', workspace: 'network', minutes: 12, explain: false, title: '上から順に', mission: ts('新しいルールを追加したら、社内から何も通らなくなりました。'),
    brief: '社内（10.0.1.0/24）からは、DMZのWeb（HTTPS）とインターネットへの通信が許可されているはずです。\n\nPC1から curl -k https://10.0.2.80/ が成功し、インターネット（198.51.100.50）へpingが届けば完了です。FWはステートフル・既定拒否（default deny）のまま、DMZから社内へは拒否のままにします。まずFWで show firewall を実行し、ルールを確認しましょう。',
    hints: ['FWで show firewall を実行し、ルールを番号の小さい順に読みます。', 'ルールは上（番号の小さい順）から評価され、最初に一致したもので結果が決まります。社内からの通信に最初に一致するルールはどれですか？', '社内の通信をまとめて拒否するルールが許可ルールより前にあると、それより後の許可ルールは使われません。不要なルールは no firewall rule <番号> で削除します。'],
    build: () => { const n = firewallScenario(true); n.update('FW', d => { d.firewall!.rules.unshift(parseRule(5, 'deny ip 10.0.1.0/24 any'.split(' '))); }); return n; },
    solve: n => n.update('FW', d => { d.firewall!.rules = d.firewall!.rules.filter(r => r.seq !== 5); }),
    grade: s => { const g = grader(s); g.http('社内（PC1）から DMZのWeb に HTTPS で接続できる', 'PC1', 'https://10.0.2.80/', true, true); g.ping('社内（PC1）からインターネット（198.51.100.50）へ ping が届く', 'PC1', '198.51.100.50'); g.check('FWはステートフル・default deny のまま', n => n.device('FW').firewall!.stateful && n.device('FW').firewall!.defaultAction === 'deny'); g.ping('DMZ（DMZWEB）から社内へは ping が届かないまま（拒否）', 'DMZWEB', '10.0.1.10', false); return g.done(); },
    diagnosis: layer(5, '追加されたルール5の deny ip 10.0.1.0/24 any が、許可ルール（10・30）より先に一致していました。show firewall で、ルール5が先頭にあることで確認できます。'),
    debrief: 'FirewallやACLのルールは「上から順に、最初に一致したもの」で決まります。実務でルールを追加するときは、入れる位置（番号）と、既存のルールとの重なりを必ず確認します。' },

  // ---------------------------------------------------------------- ⑦ Linux troubleshooting (NIC → IP → ARP → Route → DNS → TCP → TLS → App)
  ...linuxLabs(),

  // ---------------------------------------------------------------- ⑨ topology
  { id: 'topology-01', chapter: 'topology', kind: 'challenge', workspace: 'network', minutes: 30, title: 'ゼロからネットワークを組む', mission: '空のラボに、2つのLANとルータを配置して通信させる',
    brief: '空のラボから、次の条件どおりに構成してください（機器名も指定どおりにします）。\n\n- PCA は 172.16.1.0/24、PCB は 172.16.2.0/24 のLANに置く\n- 各LANにL2スイッチ（SWA / SWB）を置き、PCはスイッチ経由で接続する\n- ルータ RTR が2つのLANをつなぐ（各PCのDefault GatewayはRTRのアドレスにする）\n- PCA と PCB が双方向に通信できる\n\n機器は左の DEVICES パレットから追加し、ポートどうしをドラッグで配線します。IPアドレスやGatewayは、右パネルの「機器設定」かTerminalで設定します。',
    hints: ['先にアドレス計画を書きます。例: RTRの2つのポートに 172.16.1.1/24 と 172.16.2.1/24、PCAは 172.16.1.10/24（Gateway 172.16.1.1）、PCBは 172.16.2.10/24（Gateway 172.16.2.1）。', 'RTRは2つのLANに直結するので、静的ルートは不要です（アドレスを設定したポートの Connected Route が自動でできます）。PCにGatewayを設定し忘れると、別のLANへは届きません。', 'パレットから追加した機器には PC1・SW2・R3 のような名前が自動で付き、画面上では変更できません。指定の名前にするには、「書き出し」でJSONを保存し、機器の id と、リンクの sourceDevice / targetDevice を書き換えてから「読み込み」します。'],
    build: () => new NetworkSimulator(),
    solve: n => {
      const add = (id: string, kind: DeviceState['kind'], i: number, x: number, ip?: Record<string, string>, gw?: string) => { const d = createDevice(id, kind, i, { x, y: 100 }); for (const [p, a] of Object.entries(ip ?? {})) d.interfaces.find(q => q.id === p)!.address = a; if (gw) d.gateway = gw; n.addDevice(d); };
      add('PCA', 'pc', 1, 0, { eth0: '172.16.1.10/24' }, '172.16.1.1'); add('SWA', 'switch', 2, 200); add('RTR', 'router', 3, 400, { 'g0/0': '172.16.1.1/24', 'g0/1': '172.16.2.1/24' }); add('SWB', 'switch', 4, 600); add('PCB', 'pc', 5, 800, { eth0: '172.16.2.10/24' }, '172.16.2.1');
      [['PCA', 'eth0', 'SWA', 'g0/1'], ['SWA', 'g0/8', 'RTR', 'g0/0'], ['RTR', 'g0/1', 'SWB', 'g0/8'], ['SWB', 'g0/1', 'PCB', 'eth0']].forEach(([a, pa, b, pb], i) => n.connect({ id: `c${i}`, sourceDevice: a, sourceInterface: pa, targetDevice: b, targetInterface: pb, up: true, bandwidth: 1000, latency: 1 }));
    },
    grade: s => { const g = grader(s);
      g.check('PCA・PCB（PC）、SWA・SWB（L2スイッチ）、RTR（ルータ）がそろっている', n => [['PCA', 'pc'], ['PCB', 'pc'], ['SWA', 'switch'], ['SWB', 'switch'], ['RTR', 'router']].every(([id, kind]) => { try { return n.device(id).kind === kind; } catch { return false; } }));
      g.check('PCAが 172.16.1.0/24、PCBが 172.16.2.0/24 のアドレスを持つ', n => n.device('PCA').interfaces[0].address?.startsWith('172.16.1.') === true && n.device('PCB').interfaces[0].address?.startsWith('172.16.2.') === true);
      g.check('PCはスイッチにつながっている（ルータへ直結しない）', n => ['PCA', 'PCB'].every(id => n.snapshot().links.some(l => (l.sourceDevice === id && l.targetDevice.startsWith('SW')) || (l.targetDevice === id && l.sourceDevice.startsWith('SW')))));
      g.check('PCA ↔ PCB が双方向に通信できる', n => n.ping('PCA', n.device('PCB').interfaces[0].address!.split('/')[0]).success && n.ping('PCB', n.device('PCA').interfaces[0].address!.split('/')[0]).success);
      return g.done(); },
    debrief: 'アドレス計画 → 配置・配線 → 設定 → 疎通確認、という順番は、実際のネットワーク構築でも同じです。作業の前に簡単な表や図を書いておくと、設定ミスに気づきやすくなります。' },
  { id: 'topology-02', chapter: 'topology', kind: 'guided', workspace: 'network', minutes: 20, title: 'Simulation Mode: 1ホップずつ追う', mission: 'PC1からPC4へのpingを1ホップずつ追い、ヘッダがどう変わるかを確かめる',
    brief: 'VLAN 10のPC1（192.168.10.11）から、VLAN 20のPC4（192.168.20.14）へpingを送ります。VLANをまたぐため、パケットはトランクを通り、R1（Router on a Stick）を経由します。設定の変更は必要ありません。\n\nDebuggerで観察した値を、下の欄に記録して一致すれば完了です。',
    steps: ['送信元にPC1を選び、SEND バーで宛先 192.168.20.14 へpingします。', '右パネルの「Debugger」を開き、「Hop」表示に切り替えます。1行が、1本のリンクを通った1回の送信です。リンクごとの送信元/宛先MAC、VLAN、TTLを比べます（色付きのセルは、同じパケットの前のホップから変わった値です）。', 'R1を通過するときに変わるもの（MACアドレス・VLAN・TTL）と、変わらないもの（送信元/宛先IP）を、自分の言葉で説明してみましょう。', '下の質問に、観察した値で答えます。'],
    questions: [{ label: 'PC1からPC4までにEcho Requestが通過したリンク数', answer: '5' }, { label: 'R1がSW1へ送り返すフレームのVLANタグ', answer: '20' }, { label: 'PC4に届いたEcho RequestのTTL', answer: '63' }],
    hints: ['「Hop」表示の「送信機器」の列を上から順に読みます。Echo Request（pingの要求）の行だけを数えます。', '同じトランク（SW1–R1）を、R1へ向かうときと戻るときの2回通ることに注目します。R1から出るフレームのVLAN列を見ます。', 'TTLは、ルータを1台通るたびに1減ります。PC1が送るときのTTLは64です。'],
    build: () => vlanScenario(), solve: () => undefined, grade: s => { const g = grader(s); g.ping('PC1 から PC4 へ ping が届く', 'PC1', '192.168.20.14'); return g.done(); },
    debrief: 'ルータを通るとMACアドレスとTTLが変わり、IPアドレスは（NATがなければ）変わりません。実務でパケットキャプチャを読むときも、「どの区間のフレームか」を意識すると、ヘッダの値の意味が分かります。', source: 'PC1', target: '192.168.20.14' },

  // ---------------------------------------------------------------- ⑪ VPN / BGP
  { id: 'vpn-01', chapter: 'vpn-bgp', kind: 'guided', workspace: 'network', minutes: 30, title: '拠点とクラウドをIPsecでつなぐ', mission: 'CGWとVGW1の間にルートベースのIPsecトンネルを張り、PC1からVPC内のEC2のアプリへ接続する',
    brief: '拠点（PC1：192.168.10.0/24）のルータCGWと、クラウドのVPC（EC2：10.0.1.0/24）側のゲートウェイVGW1は、インターネット（INET）を挟んでつながっています。INETはプライベートアドレスへの経路を持たないため、今はPC1からEC2に届きません。\n\nCGWとVGW1の間にIPsecトンネル（パケットを暗号化して別のパケットで包み、相手まで運ぶ仮想の通り道）を作り、トンネルへ向かう経路を設定してください（ルートベースVPN：トンネルを経路表の出口の1つとして扱う方式）。PC1から http://10.0.1.10/ が表示でき、インターネット区間の通信が暗号化（ESP）されていれば完了です。',
    steps: ['CGWで enable → configure terminal → interface tunnel1 → ip address 169.254.10.1/30 → tunnel source g0/1 → tunnel destination 203.0.113.2 → tunnel mode ipsec → tunnel protection psk s3cret → exit', 'VGW1で enable → configure terminal → interface tunnel1 → ip address 169.254.10.2/30 → tunnel source 203.0.113.2 → tunnel destination 198.51.100.2 → tunnel mode ipsec → tunnel protection psk s3cret → exit（PSK＝事前共有鍵は、両端で同じ値にします）', 'CGWで do show crypto session を実行し（設定モードの中では show の前に do を付けます）、Session status が UP-ACTIVE（トンネル確立）になっていることを確認します。', 'CGWで ip route 10.0.1.0/24 tunnel1、VGW1で ip route 192.168.10.0/24 169.254.10.1 を設定します（VPC宛て・拠点宛ての通信を、それぞれトンネルへ向ける経路です）。', 'PC1で curl http://10.0.1.10/ を実行します。Packet Captureで、インターネット上の区間（CGW–INET）がESP（暗号化されたIPsecのパケット）だけになっていることを確認します。'],
    hints: ['show crypto session が DOWN のときは、show logging で理由を確認します。PSKや、tunnel source / destination が両端で対応しているかを見ます。', 'トンネルがUPでも、トンネル経由の経路がないと、パケットはDefault Routeでインターネットへ向かい、プライベートアドレスのまま破棄されます。', '経路は往復で必要です。CGWにはVPC（10.0.1.0/24）宛て、VGW1には拠点（192.168.10.0/24）宛てを、それぞれトンネルへ向けます。'],
    build: () => vpnScenario('none'),
    solve: n => { n.update('CGW', d => { tunnel(d, 1, '169.254.10.1/30', '198.51.100.2', '203.0.113.2'); d.routes.push({ destination: '10.0.1.0/24', interfaceId: 'tunnel1', preference: 1, metric: 0, kind: 'static' }); }); n.update('VGW1', d => { tunnel(d, 1, '169.254.10.2/30', '203.0.113.2', '198.51.100.2'); route(d, '192.168.10.0/24', '169.254.10.1'); }); },
    grade: s => { const g = grader(s);
      g.http('PC1 から http://10.0.1.10/（VPC内のアプリ）が表示できる', 'PC1', 'http://10.0.1.10/');
      g.check('インターネット区間（CGW–INET）の通信がESPで暗号化されている', n => { const r = n.ping('PC1', '10.0.1.10'); const link = n.snapshot().links.find(l => l.sourceDevice === 'CGW' && l.targetDevice === 'INET')!.id; const on = r.captures.filter(c => c.linkId === link && c.protocol !== 'ARP'); return r.success && on.length > 0 && on.every(c => c.protocol === 'ESP'); });
      g.check('INETにプライベートアドレスの経路を追加していない', n => n.device('INET').routes.length === 0);
      return g.done(); },
    debrief: 'ルートベースVPNでは、トンネルは「経路表の出口の1つ」です。実務のクラウド接続（AWS Site-to-Site VPNなど）でも、トンネルが確立しているかと、往復の経路があるかを分けて確認します。', source: 'PC1', target: '10.0.1.10' },
  { id: 'vpn-ts-01', chapter: 'vpn-bgp', kind: 'troubleshooting', workspace: 'network', minutes: 12, explain: false, title: '上がらないトンネル', mission: ts('拠点からVPCへ接続できません。経路は設定済みです。'),
    brief: '拠点のルータCGWと、クラウド側のVGW1の間は、IPsecトンネルでつなぐ構成です。トンネル経由の経路は両側に設定済みです。\n\nPC1から http://10.0.1.10/ が表示できれば完了です。まずCGWで、トンネルの状態を確認しましょう。',
    hints: ['CGWで show crypto session を実行し、Session status を確認します。', 'トンネルがDOWNなら、CGWとVGW1で show logging を見ます。IKE（トンネルを作る前に、両端が互いを認証して暗号の方式を合意する手順）が失敗した理由が表示されます。', 'PSK（事前共有鍵）は、両端で完全に同じ値である必要があります。CGWとVGW1の show running-config で、tunnel protection psk の値を比べます。'],
    build: () => { const n = vpnScenario('static'); n.update('VGW1', d => { d.interfaces.find(i => i.id === 'tunnel1')!.tunnel!.psk = 'typo'; }); return n; },
    solve: n => n.update('VGW1', d => { d.interfaces.find(i => i.id === 'tunnel1')!.tunnel!.psk = 'path-demo-psk'; }),
    grade: s => { const g = grader(s); g.http('PC1 から http://10.0.1.10/ が表示できる', 'PC1', 'http://10.0.1.10/'); return g.done(); },
    diagnosis: { question: '原因は何でしたか？', options: ['IKEの事前共有鍵（PSK）の不一致', 'トンネル経由の経路不足', 'EC2のサービス停止', 'インターネット側の経路不足'], answer: 0, explanation: 'VGW1のPSKがCGWと一致せず、IKEの認証に失敗してトンネルがDOWNのままでした。show crypto session の DOWN と、show logging の「事前共有鍵（PSK）が一致しない」で確認できます。' },
    debrief: 'VPNの障害は、「トンネルが上がらない（IKE / IPsec）」と「トンネルは上がっているのに通らない（経路・フィルタ）」に分けて考えます。実務では、PSKの入力ミスが、トンネルが上がらない原因の定番です。' },
  { id: 'vpn-ts-02', chapter: 'vpn-bgp', kind: 'troubleshooting', workspace: 'network', minutes: 12, explain: false, title: '片道だけのVPN', mission: ts('トンネルはUpなのに、拠点からVPCのアプリに接続できません。'),
    brief: '拠点のルータCGWと、クラウド側のVGW1の間のIPsecトンネルは確立しています（UP-ACTIVE）。\n\nPC1から http://10.0.1.10/ が表示できれば完了です。PC1から接続を試し、Debuggerでパケットの行きと帰りを追ってみましょう。',
    hints: ['PC1から curl http://10.0.1.10/ を実行し、Debuggerを見ます。接続の要求（SYN）はEC2に届いていますか？', 'EC2からの応答は、EC2のDefault GatewayであるVGW1に渡されます。VGW1は、その応答をどこへ送っていますか？', 'VGW1で show ip route 192.168.10.10 を実行し、拠点宛ての経路がトンネルを向いているか確認します。'],
    build: () => { const n = vpnScenario('static'); n.deleteRoute('VGW1', '192.168.10.0/24'); return n; }, solve: n => n.addRoute('VGW1', { destination: '192.168.10.0/24', nextHop: '169.254.10.1', preference: 1, metric: 0 }),
    grade: s => { const g = grader(s); g.http('PC1 から http://10.0.1.10/ が表示できる', 'PC1', 'http://10.0.1.10/'); return g.done(); },
    diagnosis: { question: '原因は何でしたか？', options: ['IKEの事前共有鍵（PSK）の不一致', 'クラウド側に拠点への戻り経路がない（VPN Route不足）', 'EC2のサービス停止', 'NATの設定不足'], answer: 1, explanation: 'VGW1に「192.168.10.0/24 → トンネル」の経路がなく、EC2からの応答がDefault Routeでインターネットへ出て破棄されていました。VGW1の show ip route 192.168.10.10 が 0.0.0.0/0 に一致することで確認できます。' },
    debrief: 'VPNでも、通常のルーティングと同じく往復の経路が必要です。実務のクラウド接続でも、「クラウド側のルートテーブルに拠点宛ての経路がない」は非常によくある原因です。' },
  { id: 'bgp-01', chapter: 'vpn-bgp', kind: 'guided', workspace: 'network', minutes: 30, title: '3つのASをBGPでつなぐ', mission: 'R1(AS65001)・R2(AS65002)・R3(AS65003)でeBGPを設定し、各LANを広告する',
    brief: '3つの組織（AS：1つの組織が共通の方針で運用するネットワークのまとまり）のルータ R1・R2・R3 が、三角形につながっています。静的ルートは使わず、BGP（組織どうしで「このネットワークへは私に送ってください」と伝え合うプロトコル）で経路を交換します。異なるASの間のBGPを eBGP と呼びます。\n\n各ルータで隣の2台とBGPのセッションを張り、自分のLANを広告（相手に知らせること）してください。すべてのセッションが Established（確立）になり、PC1から SRV2・SRV3 に届けば完了です。',
    steps: ['R1で enable → configure terminal → router bgp 65001 → neighbor 10.0.12.2 remote-as 65002 → neighbor 10.0.13.2 remote-as 65003 → network 192.168.1.0/24', 'R2で enable → configure terminal → router bgp 65002 → neighbor 10.0.12.1 remote-as 65001 → neighbor 10.0.23.2 remote-as 65003 → network 172.16.2.0/24', 'R3で enable → configure terminal → router bgp 65003 → neighbor 10.0.13.1 remote-as 65001 → neighbor 10.0.23.1 remote-as 65002 → network 172.16.3.0/24', 'end で設定モードを抜け、show ip bgp summary でセッションの状態を、show ip bgp でBest Path（> の付いた、採用された経路）とAS_PATH（経由するASの並び）を確認します。', 'show ip bgp 172.16.2.0/24 で、なぜその経路が選ばれたか（判定の理由）を読みます。'],
    hints: ['セッションが Established にならないときは、show logging を見ます。neighbor のアドレスや remote-as（相手のAS番号）の食い違いが表示されます。', 'セッションは両側の設定がそろって初めて確立します。R1で設定した相手（例: R2）にも、R1向けの neighbor が必要です。', 'network 文のプレフィックスは、ルーティングテーブルに完全一致で存在する必要があります（例: R2のLANは 172.16.2.0/24）。'],
    build: () => bgpScenario(false), solve: n => { const ref = bgpScenario(true); for (const id of ['R1', 'R2', 'R3']) n.update(id, d => { d.bgp = ref.device(id).bgp; }); },
    grade: s => { const g = grader(s);
      g.check('BGPセッション（3台×2本）がすべて Established', n => { const b = n.bgp(); return !!b && b.sessions.length === 6 && b.sessions.every(x => x.state === 'Established'); });
      g.http('PC1 から http://172.16.2.10/（SRV2）が表示できる', 'PC1', 'http://172.16.2.10/'); g.ping('PC1 から SRV3（172.16.3.10）へ ping が届く', 'PC1', '172.16.3.10');
      g.check('静的ルートを使っていない', n => ['R1', 'R2', 'R3'].every(id => n.device(id).routes.length === 0));
      return g.done(); },
    debrief: 'BGPは「隣とセッションを張り、自分のネットワークを広告する」だけで、経路がASをまたいで伝わっていきます。インターネットも、各組織のASがこの仕組みで経路を交換してつながっています。', source: 'PC1', target: '172.16.2.10' },
  { id: 'bgp-02', chapter: 'vpn-bgp', kind: 'mastery', workspace: 'network', minutes: 30, title: '経路を選ばせる（トラフィックエンジニアリング）', mission: 'R1から172.16.2.0/24への通信は平常時AS65003経由にし、障害時はR2直結に切り替わるようにする',
    brief: 'R1・R2・R3は三角形につながり、eBGPで経路を交換済みです。今、R1から AS65002 のLAN（172.16.2.0/24）への通信は、AS_PATH（経由するASの並び）が短いR2直結の経路を使っています。\n\n回線コストの都合で、平常時はAS65003（R3）を経由させたいとします。R1–R3のリンクが切れたら、R2直結へ自動で切り替わること。静的ルートは使わないでください。R1の 172.16.2.0/24 のBest Path（採用された経路）のAS_PATHが「65003 65002」になり、障害時にR2直結で通信できれば完了です。',
    hints: ['R1で show ip bgp 172.16.2.0/24 を実行し、2つの経路と、今の経路が選ばれている理由を確認します。', 'BGPの経路選択では、AS_PATHの長さより先に LOCAL_PREF（自AS内で使う優先度。大きいほど優先）が比べられます。R3から受け取る経路のLOCAL_PREFを上げると、平常時はR3経由になります。', 'R1で router bgp 65001 → neighbor 10.0.13.2 local-preference 200'],
    build: () => bgpScenario(true), solve: n => n.update('R1', d => { d.bgp!.neighbors.find(x => x.ip === '10.0.13.2')!.localPreference = 200; }),
    grade: s => { const g = grader(s);
      g.check('平常時: R1の 172.16.2.0/24 のBest PathのAS_PATHが「65003 65002」', n => n.bgp()!.tables.get('R1')!.find(p => p.prefix === '172.16.2.0/24' && p.best)?.asPath.join(' ') === '65003 65002');
      g.check('R1–R3のリンク障害時: R2直結に切り替わり、PC1 から SRV2 へ通信できる', n => { const l = n.snapshot().links.find(x => x.sourceDevice === 'R1' && x.targetDevice === 'R3')!; n.setLinkState(l.id, false); return n.ping('PC1', '172.16.2.10').success && resolveRoute(n.device('R1'), '172.16.2.10')?.nextHop === '10.0.12.2'; });
      g.check('R1で静的ルートを使っていない', n => n.device('R1').routes.length === 0);
      g.ping('PC1 から SRV2（172.16.2.10）へ ping が届く', 'PC1', '172.16.2.10');
      return g.done(); },
    debrief: 'LOCAL_PREFは、自分のASから「出ていく」通信の出口を選ぶために使います。実務でも、回線のコストや品質に合わせて、BGPの属性で経路を意図的に選ばせます（トラフィックエンジニアリング）。', source: 'PC1', target: '172.16.2.10' },
  { id: 'bgp-ts-01', chapter: 'vpn-bgp', kind: 'troubleshooting', workspace: 'network', minutes: 15, explain: false, title: '確立しないネイバー', mission: ts('R1–R3間の回線は工事で停止中のため、R1はR2との直結回線だけを使います。ところが、PC1から AS65002 のLAN（SRV2）へ届きません。'),
    brief: 'R1（AS65001）・R2（AS65002）・R3（AS65003）が、eBGPで経路を交換する構成です。今はR1–R3のリンクが工事でDownしています。\n\nR1–R2のBGPセッションが Established（確立）になり、PC1から SRV2（172.16.2.10）へpingが届けば完了です。',
    hints: ['R1で show ip bgp summary を実行し、State列を確認します。R2とのセッションは Established になっていますか？', 'R1とR2で show logging を実行します。セッションが確立しない理由が表示されます。', 'R2の show running-config で、R1向けの neighbor 10.0.12.1 remote-as の値を、R1の実際のAS番号（65001）と比べます。'],
    build: () => { const n = bgpScenario(true); const l = n.snapshot().links.find(x => x.sourceDevice === 'R1' && x.targetDevice === 'R3')!; n.setLinkState(l.id, false); n.update('R2', d => { d.bgp!.neighbors.find(x => x.ip === '10.0.12.1')!.remoteAs = 65010; }); return n; },
    solve: n => n.update('R2', d => { d.bgp!.neighbors.find(x => x.ip === '10.0.12.1')!.remoteAs = 65001; }),
    grade: s => { const g = grader(s); g.check('R1–R2 のBGPセッションが Established', n => n.bgp()!.sessions.some(x => x.device === 'R1' && x.neighbor === '10.0.12.2' && x.state === 'Established')); g.ping('PC1 から SRV2（172.16.2.10）へ ping が届く', 'PC1', '172.16.2.10'); return g.done(); },
    diagnosis: { question: '原因は何でしたか？', options: ['R2のneighbor設定のremote-asが誤っている', 'R1がnetwork文で広告していない', 'AS_PATHのループ防止で破棄', 'ACLでTCP 179が遮断'], answer: 0, explanation: 'R2が R1 を AS65010 として設定していたため、OPENメッセージ（セッション開始時に互いのAS番号を伝えるメッセージ）のAS番号が一致せず、セッションが確立しませんでした。show logging の remote-as 不一致で確認できます。' },
    debrief: 'BGPのセッションは、両側の neighbor の設定（アドレスとAS番号）が一致して初めて確立します。実務で通信事業者やほかの組織とBGPを張るときは、AS番号とアドレスを事前に書面で突き合わせます。' },
  { id: 'bgp-ts-02', chapter: 'vpn-bgp', kind: 'troubleshooting', workspace: 'network', minutes: 15, explain: false, title: '広告されないプレフィックス', mission: ts('BGPセッションはすべてEstablishedですが、172.16.2.0/24 に届きません。'),
    brief: 'R1・R2・R3がeBGPで経路を交換する構成で、BGPセッションはすべて確立しています。\n\nR1が 172.16.2.0/24（R2のLAN）をBGPで学習し、PC1から SRV2（172.16.2.10）へpingが届けば完了です。',
    hints: ['R1で show ip bgp を実行します。172.16.2.0/24 の経路はありますか？', 'R2で show ip bgp を実行します。R2は自分のLAN（172.16.2.0/24）を、そもそも広告していますか？', 'R2の show running-config で、router bgp の network 文のプレフィックスを、R2のLAN（g0/2）のアドレスと比べます。network 文は、経路表に完全一致するプレフィックスだけを広告します。'],
    build: () => { const n = bgpScenario(true); n.update('R2', d => { d.bgp!.networks = ['172.16.0.0/16']; }); return n; }, solve: n => n.update('R2', d => { d.bgp!.networks = ['172.16.2.0/24']; }),
    grade: s => { const g = grader(s); g.check('R1 が 172.16.2.0/24 をBGPで学習している', n => resolveRoute(n.device('R1'), '172.16.2.10')?.route.kind === 'bgp'); g.ping('PC1 から SRV2（172.16.2.10）へ ping が届く', 'PC1', '172.16.2.10'); return g.done(); },
    diagnosis: { question: '原因は何でしたか？', options: ['R2のnetwork文がルーティングテーブルに存在しないプレフィックス（172.16.0.0/16）だった', 'R1のLOCAL_PREFが低い', 'eBGPのNEXT_HOPに到達できない', 'BGP Neighbor Down'], answer: 0, explanation: 'network文は、ルーティングテーブルに完全一致するプレフィックスだけを広告します。R2の network 172.16.0.0/16 は経路表に存在しないため何も広告されず、R2の show ip bgp に自分のLANが出ないことで確認できます。' },
    debrief: 'BGPのnetwork文は「経路表にあるものを広告する」指定で、存在しない範囲を書いても何も広告されません。実務で広い範囲をまとめて広告したいときは、その範囲の経路（集約経路）を経路表に用意してから広告します。' },
];

function linuxLabs(): NetworkLab[] {
  const base = (mutate: (n: NetworkSimulator) => void) => () => { const n = dnsScenario(); mutate(n); return n; };
  const web = (d: DeviceState) => d.services!.find(s => s.port === 443)!;
  const brief = 'PC1から https://www.example.com/ が表示でき、www.example.com が 203.0.113.80 に名前解決されれば完了です。\n\nPC1のTerminalで、下の層から順に確かめましょう。NIC（ip link）→ IP（ip addr）→ ARP（ping・ip neigh）→ 経路（ip route・traceroute）→ DNS（cat /etc/resolv.conf・dig）→ TCP（nc -zv・ss）→ TLS（curl -v）→ アプリ（curl）。原因がPC1以外の機器にあることもあります。';
  const lab = (id: string, title: string, symptom: string, fault: (n: NetworkSimulator) => void, fix: (n: NetworkSimulator) => void, diagnosis: Diagnosis, hints: string[], debrief: string, extra?: (g: ReturnType<typeof grader>) => void): NetworkLab => ({
    id, chapter: 'linux', kind: 'troubleshooting', workspace: 'network', minutes: 12, explain: false, title, mission: ts(symptom), brief, hints, diagnosis, debrief,
    build: base(fault), solve: fix, grade: s => { const g = grader(s); webChecks(g); extra?.(g); return g.done(); }, source: 'PC1', target: '203.0.113.80',
  });
  return [
    lab('linux-ts-01', 'L1: 何も通らない', 'PC1から何も表示できません。', n => n.configureInterface('PC1', 'eth0', '192.168.1.10/24', false), n => n.configureInterface('PC1', 'eth0', '192.168.1.10/24', true),
      layer(0, 'PC1のeth0がDown（ip link set eth0 down の状態）でした。ip link や ip addr で、eth0 が state DOWN と表示されることで確認できます。'),
      ['PC1で ip link を実行し、eth0 の state（状態）を確認します。', 'state DOWN で、< > の中に UP がなければ、インターフェースが設定で無効（down）にされています。', 'インターフェースを有効にするコマンドは ip link set eth0 up です。'],
      '切り分けは、一番下のリンクから確かめます。実務でも「ケーブルが抜けていた」「インターフェースが無効だった」は意外に多く、ip link を最初に見る習慣が時間の節約になります。'),
    lab('linux-ts-02', 'L3: 自分のアドレス', 'PC1から何も表示できません。ケーブルとリンクは正常です。', n => n.configureInterface('PC1', 'eth0', '192.168.100.10/24', true), n => n.configureInterface('PC1', 'eth0', '192.168.1.10/24', true),
      layer(1, 'PC1のIPアドレスが 192.168.100.10/24 になっていて、Gateway 192.168.1.1 と同じネットワークにありませんでした。ip route の default via に「Next Hopに到達できません」と出ることで確認できます。'),
      ['PC1で ip addr を実行し、eth0 のIPアドレスとプレフィックス長を確認します。', 'ip route を実行します。default via のGatewayに、PC1から直接届きますか？', 'PC1のアドレスとGateway 192.168.1.1 が同じネットワーク（/24 なら先頭から3つ目までの数字が同じ）か比べます。変更は ip addr del <今のアドレス/24> dev eth0 → ip addr add <正しいアドレス/24> dev eth0 です。'],
      'IPアドレスがGatewayと同じネットワークにないと、LANの外へ出られません。実務では、別の拠点の設定をコピーしたときなどに、アドレスの打ち間違いが起きやすくなります。'),
    lab('linux-ts-03', 'L2: 返事のないARP', 'PC1から何も表示できません。IP設定は正しいようです。', n => n.update('SW1', d => { d.vlans = [{ id: 99, name: 'QUARANTINE' }]; access(d, 99, 'g0/8'); }), n => n.update('SW1', d => { access(d, 1, 'g0/8'); }),
      layer(2, 'ルータR1へつながるSW1のポート（g0/8）がVLAN 99に入っていて、PC1のARPがGatewayへ届きませんでした。ip neigh にGatewayのMACアドレスが出ないことと、SW1の show vlan brief で確認できます。'),
      ['PC1から ping 192.168.1.1（Gateway）を実行したあと、ip neigh を見ます。GatewayのMACアドレスは解決できていますか？', '同じLANのRESOLVER（192.168.1.53）へはpingが届きますか？ 届くなら、PC1自身ではなく、Gatewayまでの区間を疑います。', 'PC1とR1の間にあるSW1で show vlan brief を実行し、R1へつながるポート（g0/8）のVLANを、PC1のポートのVLANと比べます。'],
      'ARPが解決できないときは、同じLANの中（ケーブル・スイッチ・VLAN）に原因があります。実務では、スイッチのポートが隔離用のVLANに入れられていた、というケースもあります。'),
    lab('linux-ts-04', 'L3: 出口を間違えている', 'PC1から社外のサイトが表示できません。社内のRESOLVERにはpingが通ります。', n => n.setGateway('PC1', '192.168.1.254'), n => n.setGateway('PC1', '192.168.1.1'),
      layer(3, 'PC1のDefault Gatewayが、存在しない 192.168.1.254 になっていました。ip route の default via と、そのアドレスへの ping に応答がないことで確認できます。'),
      ['PC1で ip route を実行し、default via（Default Gateway）のアドレスを確認します。', 'そのアドレスにpingは届きますか？ 構成図で、LANの出口のルータR1のアドレスと比べます。', 'Default Gatewayは ip route del default → ip route add default via <IP> で変更できます。'],
      'Default Gatewayが間違っていても、同じLANの中とは通信できます。「社内は通るのに社外に出られない」ときは、まず ip route の default via を確かめましょう。'),
    lab('linux-ts-05', 'L3: ルータの先', '社内のどのPCからも社外に出られません。', n => n.update('R1', d => { d.routes = []; }), n => n.update('R1', d => { route(d, '0.0.0.0/0', '100.64.0.1'); }),
      layer(3, 'R1にDefault Routeがなく、インターネット宛ての通信（RESOLVERが行うDNSの問い合わせも）を転送できませんでした。traceroute が R1 で !N（宛先のネットワークに届けられない）になることと、R1の show ip route で確認できます。'),
      ['PC1で traceroute -I 203.0.113.80 を実行します。どのホップで !N（宛先のネットワークに届けられない）になりますか？', '!N を返したルータで show ip route を実行します。インターネット宛ての経路（Default Route）はありますか？', 'R1のDefault Routeは、インターネット側のISP（100.64.0.1）へ向けます。設定は enable → configure terminal → ip route 0.0.0.0/0 <Next Hop> です。'],
      '「全員が社外に出られない」ときは、端末ではなく共通の出口（ルータやFirewall）を疑います。実務でも、影響範囲の広さから原因の場所を絞り込むのが切り分けの基本です。'),
    lab('linux-ts-06', 'DNS: 名前だけ引けない', 'http://203.0.113.80/ のようにIPアドレスを直接指定するとWebが見えるのに、名前ではつながりません。', n => n.update('PC1', d => { d.dnsServers = ['192.168.1.99']; }), n => n.update('PC1', d => { d.dnsServers = ['192.168.1.53']; }),
      layer(6, '/etc/resolv.conf の nameserver が、存在しない 192.168.1.99 になっていました。dig がタイムアウトすることと、cat /etc/resolv.conf で確認できます。'),
      ['PC1で dig www.example.com を実行します。答えは返ってきますか？', 'cat /etc/resolv.conf で、PC1がどのDNSサーバーに問い合わせているかを確認します。そのIPアドレスの機器は、構成図にありますか？', 'このLANのDNSサーバーは RESOLVER です。変更は echo "nameserver <IP>" > /etc/resolv.conf で行います。'],
      '名前解決の失敗は、ブラウザでは「サイトが見つからない」としか表示されません。実務では dig で「誰に聞いて、何が返ったか」を確かめると、DNSの問題かどうかをすぐに判断できます。'),
    lab('linux-ts-07', 'TCP: 待ち受けていない？', 'www.example.com のHTTPSがつながりません（Connection refused）。', n => n.update('WEB', d => { web(d).bind = '127.0.0.1'; }), n => n.update('WEB', d => { web(d).bind = '0.0.0.0'; }),
      layer(7, 'WEBのHTTPSサービスが 127.0.0.1（自分自身）だけで待ち受けていたため、外部からの接続を受け付けませんでした。WEBで ss -tlnp を実行し、443番の Local Address が 127.0.0.1 になっていることで確認できます。'),
      ['Connection refused は、パケットは相手に届いたが、そのポートで待ち受けているプログラムがいない、という意味です。', 'WEBのTerminalで ss -tlnp を実行し、443番の行の Local Address（待ち受けアドレス）を確認します。80番の行と比べてみましょう。', '127.0.0.1 はループバック（自分自身を表すアドレス）で、外からは届きません。待ち受けアドレスは、WEBの「機器設定」にあるサービスの設定で変更できます。'],
      'Connection refused は「ネットワークは届いているが、アプリが待ち受けていない」サインです。実務では、アプリの設定で待ち受けアドレスが localhost（127.0.0.1）のままになっている、というミスがよくあります。'),
    lab('linux-ts-08', 'TLS: 証明書が合わない', 'https://www.example.com/ で証明書エラーになります。', n => n.update('WEB', d => { web(d).tls!.names = ['example.com']; }), n => n.update('WEB', d => { web(d).tls!.names = ['www.example.com', 'example.com']; }),
      layer(8, '証明書のSAN（証明書に書かれた、有効なサーバー名の一覧）に www.example.com が含まれていませんでした。curl -v の [TLS] 行に、名前が一致しないと表示されることで確認できます。'),
      ['PC1で curl -v https://www.example.com/ を実行し、[DNS]・[TCP]・[TLS] のどの段階で失敗しているかを読みます。', '[TLS] 行のエラーで、証明書に書かれた名前と、接続したい名前を比べます。', '証明書の名前（SAN）に www.example.com を加えます。WEBの「機器設定」にあるサービスの設定で変更できます。curl -k（証明書の検証を無効にする）で成功させても、解決にはなりません。'],
      '証明書エラーを -k や「警告を無視」で回避すると、なりすましを見抜けなくなります。実務では、証明書を発行するときに、SANへ必要な名前（www あり・なし など）がすべて入っているかを確認します。',
      g => g.check('証明書の検証を無効にせず（curl -k なしで）接続できる', n => n.http('PC1', 'https://www.example.com/').success)),
    lab('linux-ts-09', 'App: 通信はできている', 'https://www.example.com/ で 503 が返ります。', n => n.update('WEB', d => { web(d).http = { status: 503, body: 'Service Unavailable' }; }), n => n.update('WEB', d => { web(d).http = { status: 200, body: '<h1>www.example.com (TLS)</h1>' }; }),
      layer(9, 'DNS・TCP・TLSはすべて成功しており、アプリケーションが503（Service Unavailable：一時的に処理できない）を返していました。curl -v で [TLS] までが成功し、[HTTP] で503が返ることで確認できます。'),
      ['PC1で curl -v https://www.example.com/ を実行し、どの段階まで成功しているかを読みます。', 'HTTPのステータスコードが返っているなら、ネットワーク・TCP・TLSは成立しています。503 は、サーバーのアプリが「今は処理できない」と答えた状態です。', 'WEBの「機器設定」にあるサービスの設定で、HTTPSサービスの応答（HTTPステータス）を確認します。'],
      '層を下から確かめると、「ネットワークは正常で、アプリ側の問題」と根拠を持って判断できます。実務では、この切り分けの結果を添えてアプリの担当者に引き継ぐと、対応が早くなります。'),
    lab('linux-ts-10', 'Firewall: 443だけ閉じている', 'HTTPは表示できますが、HTTPSがタイムアウトします。', n => n.update('WEB', d => { d.firewall = { stateful: false, defaultAction: 'deny', rules: [parseRule(1, 'permit ip any any ctstate ESTABLISHED,RELATED'.split(' ')), parseRule(2, 'permit tcp any any eq 80'.split(' '))] }; }),
      n => n.update('WEB', d => { d.firewall!.rules.push(parseRule(3, 'permit tcp any any eq 443'.split(' '))); }),
      layer(5, 'WEBのホストFirewall（iptables の INPUT）で443番が許可されておらず、接続の要求（SYN）が応答なしで破棄されていました。WEBで iptables -L -n を実行し、80番だけが ACCEPT になっていることで確認できます。'),
      ['タイムアウト（応答なし）は、途中でパケットが黙って捨てられているサインです。Connection refused（拒否の応答がある）との違いに注目します。', 'WEBのTerminalで iptables -L -n を実行し、INPUT（サーバーに入ってくる通信）のルールを確認します。', '443番を許可するルールを追加します（例: iptables -A INPUT -p tcp --dport 443 -j ACCEPT）。Firewallを無効にする（policy を ACCEPT にする）のや、すべてを許可するルール（-j ACCEPT だけ）を足すのは不正解です。'],
      'タイムアウトならFirewallによる破棄、Connection refused なら待ち受けなし、と症状から当たりを付けられます。実務でも、サーバーのFirewall（iptables・nftables）では必要なポートだけを許可するのが基本です。',
      g => { g.check('WEBのホストFirewallを無効にせず、既定拒否（policy DROP）のまま', n => n.device('WEB').firewall?.defaultAction === 'deny'); g.check('443以外（例: 22番）は破棄されたまま（すべて許可するルールを足していない）', n => { const r = n.tcpConnect('PC1', '203.0.113.80', 22); return !r.success && !r.refused; }); }),
    { id: 'linux-mastery', chapter: 'linux', kind: 'mastery', workspace: 'network', minutes: 30, explain: false, title: '複合障害を層ごとに切り分ける', mission: ts('PC1から https://www.example.com/ が表示できません。原因は1つとは限りません。'),
      brief: 'PC1から https://www.example.com/ が表示でき、www.example.com が 203.0.113.80 に名前解決されれば完了です。\n\nNIC → IP → ARP → 経路 → DNS → TCP → TLS → アプリ の順に、観測した事実を記録しながら切り分けてください。1つ直すと、症状が次の層へ移ることがあります。',
      hints: ['一度に1つだけ直し、直したら同じコマンドで再確認します。', 'PC1で ip route と cat /etc/resolv.conf を見て、Default GatewayとDNSサーバーのアドレスが、構成図の機器（R1・RESOLVER）と一致しているか確認します。', '名前解決と経路が直ってもつながらないときは、WEBで ss -tlnp を実行し、443番の待ち受けアドレスを確認します。'],
      build: base(n => { n.setGateway('PC1', '192.168.1.200'); n.update('PC1', d => { d.dnsServers = ['192.168.1.54']; }); n.update('WEB', d => { web(d).bind = '127.0.0.1'; }); }),
      solve: n => { n.setGateway('PC1', '192.168.1.1'); n.update('PC1', d => { d.dnsServers = ['192.168.1.53']; }); n.update('WEB', d => { web(d).bind = '0.0.0.0'; }); },
      grade: s => { const g = grader(s); webChecks(g); return g.done(); }, source: 'PC1', target: '203.0.113.80',
      debrief: '原因は3つ（Default Gateway・DNSサーバー・サービスの待ち受けアドレス）でした。1つ直すたびに、症状が「次の層」へ移ることを確認できましたか？ 実務の障害でも原因が重なっていることがあり、症状 → 観測 → 仮説 → 変更 → 再確認 を記録しておくと、あとから説明できます。' },
  ];
}
