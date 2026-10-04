import { tunnel } from '../../simulator/scenarios/build';
import { vpnScenario } from '../../simulator/scenarios/chapters';
import { resolveRoute } from '../../simulator/l3/RoutingTable';
import type { NetworkSimulator } from '../../simulator/core/NetworkSimulator';
import type { DeviceState } from '../../simulator/core/types';
import { net, networkSimulation } from '../simulation';

const tunnelTo = (n: NetworkSimulator, id: string, destination: string) => n.device(id).interfaces.find(i => i.kind === 'tunnel' && i.tunnel?.destination === destination);
const tunnelUp = (n: NetworkSimulator, id: string, destination: string) => { const t = tunnelTo(n, id, destination); return !!t && !!n.device(id).tunnelStatus?.[t.id]?.up; };
const via = (n: NetworkSimulator, id: string, destination: string) => resolveRoute(n.device(id), destination);
const established = (n: NetworkSimulator, id: string, neighbor: string) => !!n.bgp()?.sessions.some(s => s.device === id && s.neighbor === neighbor && s.state === 'Established');
const best = (n: NetworkSimulator, id: string, prefix: string) => n.bgp()?.tables.get(id)?.find(p => p.prefix === prefix && p.best);
const bgpPeer = (d: DeviceState, ip: string, remoteAs: number) => { d.bgp!.neighbors.push({ ip, remoteAs }); };
/** AWS keeps the two tunnel endpoints in step with each other (here: iBGP between VGW1 and VGW2, already configured). */
const awsInside = (peer: string) => (d: DeviceState) => { d.bgp = { asn: 64512, networks: [], neighbors: [{ ip: peer, remoteAs: 64512, nextHopSelf: true }] }; };

/** Chapter 11: the office (AS 65000) and AWS (AS 64512) over the Internet: one tunnel with static routes, then BGP, then a second tunnel. */
export const vpnBgpSimulation = networkSimulation({
  id: 'sim-vpn-bgp', chapter: 'vpn-bgp', minutes: 45,
  title: '拠点とAWSを、2本のIPsecトンネルとBGPでつなぐ',
  mission: 'CGWとVGW1・VGW2の間にIPsecトンネルを張り、BGPで経路を交換して、トンネル1が止まってもPC1からEC2へ通信が続くようにする',
  brief: [
    'Theoryの「例のネットワーク」です。インターネット（INET）までの配線とアドレス、各ルータのDefault Route（アンダーレイ）は設定済みです。トンネルとBGPは、まだありません。',
    '```text\n  PC1 ──── CGW ──── INET ──── VGW1 ──┐\n                      │               ├── VPCSW ──── EC2\n                      └────── VGW2 ──┘\n\n  tunnel1:  CGW 169.254.10.1/30 ════ VGW1 169.254.10.2/30\n  tunnel2:  CGW 169.254.20.1/30 ════ VGW2 169.254.20.2/30\n```',
    '| 機器 | アドレス |\n| --- | --- |\n| PC1 | 192.168.10.10/24（Default Gateway 192.168.10.1） |\n| CGW（拠点 AS 65000） | g0/0 192.168.10.1/24、g0/1 198.51.100.2/30 |\n| VGW1（AWS AS 64512） | g0/0 203.0.113.2/30、g0/1 10.0.1.1/24 |\n| VGW2（AWS AS 64512） | g0/0 203.0.113.6/30、g0/1 10.0.1.2/24 |\n| EC2 | 10.0.1.10/24（Default Gateway 10.0.1.1） |',
    'VGW1・VGW2は、AWSが用意する2つのトンネルの終端です（Theory「トンネル2本で、止まらない接続にする」）。2台のあいだで経路を共有する iBGP（`neighbor 10.0.1.x remote-as 64512` と `next-hop-self`）は、AWSの内部の設定として最初から入っています（Theory「経路に付いてくる情報：AS_PATHとNEXT_HOP」）。',
    'Theoryと同じ順に、①トンネルを1本張る → ②静的ルートで通す → ③BGPに置き換える → ④2本目のトンネルを足す → ⑤LOCAL_PREFとAS_PATH prependで平常時の道を決める → ⑥トンネル1を止めて切り替わりを確かめる、と進めます。トンネルとBGPの設定は、各ルータのTerminal（CLI）で行います。',
  ].join('\n\n'),
  source: 'PC1', target: '10.0.1.10',
  build: () => {
    const n = vpnScenario('none');
    n.update('VGW1', awsInside('10.0.1.2'));
    n.update('VGW2', awsInside('10.0.1.1'));
    return n;
  },
  sim: [
    { title: 'アンダーレイがつながっていることを確かめる',
      body: 'トンネルは、インターネット（アンダーレイ）の上に作ります。まず、CGWのTerminalで相手の外側のアドレスに ping を送ります。\n\n```text\nenable\nping 203.0.113.2\n```\n\n次に、SEND バーで PC1 → `10.0.1.10` に ping を送り、Debuggerでどこで止まったかを確かめます（Theory「拠点とクラウドを、どうつなぐ？」）。',
      quiz: { question: 'CGW → 203.0.113.2 は届き、PC1 → 10.0.1.10 は届きませんでした。PC1のEcho Requestを捨てたのはどの機器ですか？', options: ['CGW（Default Routeがない）', 'INET（10.0.1.0/24 への経路を持っていない）', 'VGW1（EC2への経路がない）'], answer: 1, explanation: 'CGWはDefault RouteでINETへ渡しますが、インターネットのルータは 10.0.1.0/24 のようなプライベートアドレスへの経路を持ちません。外側のアドレス（203.0.113.2）どうしなら届くので、その上にトンネルを作ります。' } },
    { title: 'CGWに、トンネル1を作る',
      body: 'CGWに、VGW1（203.0.113.2）へ向かうIPsecトンネルを作ります。トンネルの内側のアドレスは `169.254.10.1/30`、PSK（事前共有鍵）は両端で同じ値にします（例: `path-demo-psk`）。\n\n```text\nconfigure terminal\ninterface tunnel1\nip address 169.254.10.1/30\ntunnel source g0/1\ntunnel destination 203.0.113.2\ntunnel mode ipsec\ntunnel protection psk path-demo-psk\nend\nshow crypto session\n```\n\nGUIの「インターフェース」で Tunnel を追加することもできますが、送信元・宛先・PSKはCLIで設定します。相手がまだいないので、`Session status: DOWN` のままで正しい状態です（Theory「鍵を決める：IKEとPSK」「トンネルを経路表の出口にする」）。',
      hints: ['`tunnel source` には、インターネット側のポート名（g0/1）か、そのアドレス 198.51.100.2 を書きます。', '`show crypto session` の最後の行に、DOWNの理由が表示されます。'],
      check: n => { const t = tunnelTo(n, 'CGW', '203.0.113.2'); return !!t && t.address === '169.254.10.1/30' && t.tunnel?.source === '198.51.100.2' && t.tunnel.mode === 'ipsec' && !!t.tunnel.psk; },
      solve: n => n.update('CGW', d => tunnel(d, 1, '169.254.10.1/30', '198.51.100.2', '203.0.113.2')) },
    { title: 'VGW1に、対になるトンネル1を作る',
      body: 'VGW1側に、CGWと「逆向き」のトンネルを作ります。送信元と宛先を入れ替え、PSKはCGWと同じ値にします。\n\n```text\nenable\nconfigure terminal\ninterface tunnel1\nip address 169.254.10.2/30\ntunnel source g0/0\ntunnel destination 198.51.100.2\ntunnel mode ipsec\ntunnel protection psk path-demo-psk\nend\n```\n\nCGWで `show crypto session` が `UP-ACTIVE` になり、`ping 169.254.10.2`（トンネルの向こう側）が通れば成功です。DOWNのままなら `show logging` に理由（PSKの不一致など）が出ます。',
      hints: ['VGW1のインターネット側のポートは g0/0（203.0.113.2）です。', 'PSKは1文字でも違うと認証に失敗します。CGWとVGW1の `show running-config` を見比べましょう。'],
      check: n => tunnelUp(n, 'CGW', '203.0.113.2') && net.hasAddress(n, 'VGW1', '169.254.10.2/30'),
      solve: n => n.update('VGW1', d => tunnel(d, 1, '169.254.10.2/30', '203.0.113.2', '198.51.100.2')) },
    { title: 'CGWに、VPC宛ての経路をトンネルへ向ける',
      body: 'トンネルが上がっても、経路がトンネルを向いていなければ通信は入りません（ルートベースVPN）。CGWに「10.0.1.0/24 宛ては tunnel1 へ」という静的ルートを入れます。\n\n```text\nconfigure terminal\nip route 10.0.1.0/24 tunnel1\nend\nshow ip route 10.0.1.10\n```\n\nGUIでは CGW の Routing Table に、宛先 `10.0.1.0/24`・Next Hop `169.254.10.2` でも同じ意味になります。設定したら、もう一度 PC1 → `10.0.1.10` に ping を送り、Debuggerで追いましょう（Theory「行きと帰りを、1ホップずつ追う」）。',
      check: n => { const t = tunnelTo(n, 'CGW', '203.0.113.2'); return !!t && via(n, 'CGW', '10.0.1.10')?.iface.id === t.id; },
      solve: n => n.addRoute('CGW', { destination: '10.0.1.0/24', interfaceId: 'tunnel1', preference: 1, metric: 0 }),
      quiz: { question: 'まだpingは失敗します。Debuggerから読み取れる理由はどれですか？', options: ['Echo RequestがCGWで暗号化に失敗した', 'Echo RequestはEC2に届いたが、VGW1が返事（192.168.10.10 宛て）をDefault Routeでインターネットへ出し、INETで捨てられた', 'EC2がpingに応答しない'], answer: 1, explanation: '行きはトンネルを通ってEC2まで届きます。ところがVGW1は 192.168.10.0/24 がトンネルの向こうにあることを知らないので、返事をDefault RouteでINETへ出し、INETはプライベートアドレス宛てなので捨てます。VPNでも、帰りの経路が要ります。' } },
    { title: 'VGW1に、拠点宛ての帰りの経路を入れる',
      body: 'VGW1に「192.168.10.0/24 宛ては、トンネルの向こうのCGW（169.254.10.1）へ」を入れます。\n\n```text\nconfigure terminal\nip route 192.168.10.0/24 169.254.10.1\nend\n```\n\nPC1 → `10.0.1.10` の ping が成功すれば、拠点とVPCがつながりました。',
      check: n => net.ping(n, 'PC1', '10.0.1.10'),
      solve: n => n.addRoute('VGW1', { destination: '192.168.10.0/24', nextHop: '169.254.10.1', preference: 1, metric: 0 }) },
    { title: 'トンネルの外側と内側のヘッダを見比べる',
      body: 'PC1 → `10.0.1.10` に ping を送り、下の「Packet Capture」タブで見比べます。フィルタに `icmp` と入れると拠点のLANやVPCの中の元のパケットが、`esp` と入れるとインターネット区間を通った包まれたパケットが表示されます（Theory「中身を守る：IPsecとESP」）。',
      quiz: { question: 'インターネット区間を通ったパケット（フィルタ esp）の Source / Destination はどれですか？', options: ['192.168.10.10 → 10.0.1.10', '198.51.100.2 → 203.0.113.2', '169.254.10.1 → 169.254.10.2'], answer: 1, explanation: 'インターネットを通るのは、トンネル両端の外側のアドレス（CGW 198.51.100.2 → VGW1 203.0.113.2）を持つ外側のIPヘッダです。元のパケット（192.168.10.10 → 10.0.1.10）はESPの中で暗号化され、途中からは見えません。169.254.10.x はトンネルインターフェースのアドレスで、パケットのヘッダには現れません。' } },
    { title: 'トンネル1の上に、BGPのセッションを張る',
      body: '静的ルートの代わりに、BGPで経路を伝え合うようにします。まずはセッション（話し合いの回線）を張ります。拠点は AS 65000、AWS側は AS 64512 です。相手のアドレスは、トンネルの向こう側のアドレスです。\n\nCGW:\n\n```text\nconfigure terminal\nrouter bgp 65000\nneighbor 169.254.10.2 remote-as 64512\nend\n```\n\nVGW1（`router bgp 64512` は、AWS内部の設定として既にあります）:\n\n```text\nconfigure terminal\nrouter bgp 64512\nneighbor 169.254.10.1 remote-as 65000\nend\n```\n\nCGWで `show ip bgp summary` を実行し、169.254.10.2 の行の State/PfxRcd が数字（受け取った経路の数）になれば Established です。`Active` のままなら `show logging` を見ます（Theory「BGPのセッションを張る」）。',
      hints: ['remote-as には「相手の」AS番号を書きます。CGWから見た相手（VGW1）は 64512 です。'],
      check: n => established(n, 'CGW', '169.254.10.2'),
      solve: n => { n.update('CGW', d => { d.bgp = { asn: 65000, networks: [], neighbors: [] }; bgpPeer(d, '169.254.10.2', 64512); }); n.update('VGW1', d => bgpPeer(d, '169.254.10.1', 65000)); } },
    { title: 'network文で広告し、静的ルートを外す',
      body: '自分の側のネットワークを広告します。CGWは `network 192.168.10.0/24`、VGW1は `network 10.0.1.0/24` です（`router bgp` の中で入力します）。\n\nこの時点では、経路表は静的ルート（AD 1）のままで、BGPの経路（eBGP は AD 20）は使われません。両側の静的ルートを消すと、BGPの経路に置き換わります（GUIでは Routing Table の行の × でも消せます）。\n\n```text\n! CGW\nconfigure terminal\nno ip route 10.0.1.0/24 tunnel1\nend\n! VGW1\nconfigure terminal\nno ip route 192.168.10.0/24\nend\n```\n\nCGWで `show ip bgp` と `show ip route` を実行し、10.0.1.0/24 の行を読みましょう（Theory「経路を広告する：network文とBGPテーブル」）。',
      hints: ['network文は、経路表に完全に一致するプレフィックスだけを広告します。VGW1のVPC側は 10.0.1.0/24 です。', '`show ip route` で 10.0.1.0/24 の行頭が S のままなら、静的ルートが残っています。'],
      check: n => via(n, 'CGW', '10.0.1.10')?.route.kind === 'bgp' && via(n, 'VGW1', '192.168.10.10')?.route.kind === 'bgp' && net.ping(n, 'PC1', '10.0.1.10'),
      solve: n => { n.update('CGW', d => { d.bgp!.networks.push('192.168.10.0/24'); }); n.update('VGW1', d => { d.bgp!.networks.push('10.0.1.0/24'); }); n.deleteRoute('CGW', '10.0.1.0/24'); n.deleteRoute('VGW1', '192.168.10.0/24'); },
      quiz: { question: 'CGWの show ip bgp で、10.0.1.0/24 の行の Path 列は「64512 i」でした。これは何を表していますか？', options: ['この経路は AS 64512 から届き、その AS で生まれた経路である', 'この経路を通るには64512ホップかかる', 'VGW1のポート番号が64512である'], answer: 0, explanation: 'Path は AS_PATH、つまり経路が通ってきたASの並びです。VGW1（AS 64512）が広告するときに自分のAS番号を付けたので「64512」が入っています。末尾の i は、network文で生まれた経路（ORIGINがIGP）という印です。' } },
    { title: '2本目のトンネルを張り、その上にもBGPを張る',
      body: 'AWSは、1つのVPN接続に2本のトンネルを用意します。トンネル1と同じ手順で、CGW–VGW2 の間にトンネル2（`169.254.20.0/30`）を作り、BGPを張ります。\n\nCGW:\n\n```text\nconfigure terminal\ninterface tunnel2\nip address 169.254.20.1/30\ntunnel source g0/1\ntunnel destination 203.0.113.6\ntunnel mode ipsec\ntunnel protection psk path-demo-psk\nexit\nrouter bgp 65000\nneighbor 169.254.20.2 remote-as 64512\nend\n```\n\nVGW2:\n\n```text\nenable\nconfigure terminal\ninterface tunnel2\nip address 169.254.20.2/30\ntunnel source g0/0\ntunnel destination 198.51.100.2\ntunnel mode ipsec\ntunnel protection psk path-demo-psk\nexit\nrouter bgp 64512\nneighbor 169.254.20.1 remote-as 65000\nnetwork 10.0.1.0/24\nend\n```\n\nCGWで `show ip bgp 10.0.1.0/24` を実行し、2つの経路と「判定」の行を読みます（Theory「ベストパスを選ぶ順番」）。',
      check: n => established(n, 'CGW', '169.254.20.2') && (n.bgp()?.tables.get('CGW')?.filter(p => p.prefix === '10.0.1.0/24').length ?? 0) >= 2,
      solve: n => {
        n.update('CGW', d => { tunnel(d, 2, '169.254.20.1/30', '198.51.100.2', '203.0.113.6'); bgpPeer(d, '169.254.20.2', 64512); });
        n.update('VGW2', d => { tunnel(d, 2, '169.254.20.2/30', '203.0.113.6', '198.51.100.2'); bgpPeer(d, '169.254.20.1', 65000); d.bgp!.networks.push('10.0.1.0/24'); });
      },
      quiz: { question: 'CGWの show ip bgp 10.0.1.0/24 で、トンネル1（VGW1）経由がbestになった判定の理由はどれですか？', options: ['AS_PATHが短い', 'LOCAL_PREFが大きい', '送信元のRouter IDが小さい（それまでの項目がすべて同点）'], answer: 2, explanation: '2つの経路は LOCAL_PREF も AS_PATH（どちらも 64512）も同じなので、最後のほうの「Router IDが小さい」で決まりました。たまたま決まっている状態なので、次のステップで意図をはっきりさせます。' } },
    { title: 'LOCAL_PREFで、行きの出口をトンネル1に決める',
      body: '拠点から出ていく通信の出口は、拠点自身が決められます。VGW1から受け取る経路の LOCAL_PREF を 200 にして、トンネル1を主にします（既定は100で、大きいほうが勝ちます）。\n\n```text\nconfigure terminal\nrouter bgp 65000\nneighbor 169.254.10.2 local-preference 200\nend\nshow ip bgp 10.0.1.0/24\n```\n\n判定が「LOCAL_PREF が大きい（200）」に変われば成功です（Theory「ベストパスを選ぶ順番」）。',
      check: n => { const b = best(n, 'CGW', '10.0.1.0/24'); return b?.nextHop === '169.254.10.2' && /LOCAL_PREF/.test(b.reason ?? ''); },
      solve: n => n.update('CGW', d => { d.bgp!.neighbors.find(x => x.ip === '169.254.10.2')!.localPreference = 200; }) },
    { title: 'AS_PATH prependで、帰りもトンネル1に寄せる',
      body: 'AWSから拠点へ戻る通信の道は、AWS側が決めます。拠点にできるのは「トンネル2は遠回りに見せる」お願いです。CGWがトンネル2で広告する経路のAS_PATHに、自分のAS番号を2回余分に重ねます。\n\n```text\nconfigure terminal\nrouter bgp 65000\nneighbor 169.254.20.2 as-path prepend 2\nend\n```\n\nVGW2で `show ip bgp 192.168.10.0/24` を実行します。トンネル2から届いた経路のAS_PATHが `65000 65000 65000` になり、VGW1経由（iBGP、AS_PATH `65000`）の経路がbestに変われば成功です（Theory「行きと帰りを選ばせる：LOCAL_PREFとAS_PATH prepend」）。',
      hints: ['prependは、広告を受け取る相手側の選択を変える設定です。結果はCGWではなくVGW2で確かめます。'],
      check: n => { const paths = n.bgp()?.tables.get('VGW2')?.filter(p => p.prefix === '192.168.10.0/24') ?? []; return paths.some(p => p.best && p.type === 'iBGP' && p.nextHop === '10.0.1.1') && paths.some(p => p.type === 'eBGP' && p.from === '169.254.20.1'); },
      solve: n => n.update('CGW', d => { d.bgp!.neighbors.find(x => x.ip === '169.254.20.2')!.prepend = 2; }) },
    { title: 'トンネル1を止めて、切り替わりを確かめる',
      body: 'CGWでトンネル1を止め、障害を起こします。\n\n```text\nconfigure terminal\ninterface tunnel1\nshutdown\nend\nshow ip bgp summary\nshow ip bgp\n```\n\nPC1 → `10.0.1.10` に ping を送り、Debuggerで行きと帰りの道を追います。PC1のTerminalで `traceroute 10.0.1.10` も試しましょう。GUIでは、CGWの「インターフェース」で tunnel1 のスイッチを切っても同じです。確かめたら、`interface tunnel1` → `no shutdown`（またはスイッチを入れる）で元に戻します。戻すまでは、前のステップのチェックが外れます（Theory「トンネル2本で、止まらない接続にする」）。',
      quiz: { question: 'トンネル1を止めたとき、EC2からPC1への返事はどう戻りましたか？', options: ['VGW1 → トンネル1 → CGW', 'VGW1 → VGW2（iBGPで学んだ経路） → トンネル2 → CGW', 'VGW1 → INET（Default Route）で捨てられた'], answer: 1, explanation: 'トンネル1上のBGPセッションが切れ、そこで学んだ経路は取り消されました。VGW2のベストパスはトンネル2経由に変わり、VGW2はそれをiBGPでVGW1に伝えます。EC2のDefault GatewayであるVGW1は、その経路（Next Hop 10.0.1.2）でVGW2へ渡し、VGW2がトンネル2へ送ります。誰も経路を書き換えていないのに、BGPが道を付け替えました。' } },
  ],
  debrief: 'トンネルは外側のヘッダで包んでインターネットを渡り、どの通信を入れるかは経路表が決める。BGPは経路を広告し合い、属性の比較でベストパスを1つ選び、セッションが切れればその経路を取り消す——この3つがそろうと、拠点とクラウドの接続は「止まっても自動で迂回する」ものになります。',
});
