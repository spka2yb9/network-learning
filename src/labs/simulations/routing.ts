import { build } from '../../simulator/scenarios/build';
import { resolveRoute, routingTable } from '../../simulator/l3/RoutingTable';
import type { NetworkSimulator } from '../../simulator/core/NetworkSimulator';
import { net, networkSimulation } from '../simulation';

const via = (n: NetworkSimulator, id: string, destination: string) => resolveRoute(n.device(id), destination);
/** Cables between R1 and R2 that are up (the second one is added in step 10). */
const r1r2 = (n: NetworkSimulator) => n.snapshot().links.filter(l => l.up && [l.sourceDevice, l.targetDevice].sort().join() === 'R1,R2').length;
const ospf = (lan: string, lanPort: string) => ({ processId: 1, networks: [{ prefix: '10.0.0.0/24', area: 0 }, { prefix: lan, area: 0 }], passive: [lanPort] });

/** Chapter 3: two LANs joined by two routers. Cabled and the PCs addressed (chapter 2); the routers start empty. */
export const routingSimulation = networkSimulation({
  id: 'sim-routing', chapter: 'routing', minutes: 40,
  title: 'ふたつのLANを、2台のルータでつなぐ',
  mission: 'ルータにアドレスと経路を設定して、PC1（192.168.1.0/24）とPC2（192.168.2.0/24）を往復で通信させ、最後はOSPFで2本の道を同時に使う',
  brief: [
    '配線とPCの設定は済んでいます。ルータR1・R2には、まだ何も設定されていません。Theoryで使った「例のネットワーク」そのものです。',
    '```text\nPC1   192.168.1.10/24（Default Gateway 192.168.1.1）\n │        LAN1 192.168.1.0/24\n │  g0/0 192.168.1.1\nR1\n │  g0/1 10.0.0.1\n │        R1とR2の間 10.0.0.0/30\n │  g0/0 10.0.0.2\nR2\n │  g0/1 192.168.2.1\n │        LAN2 192.168.2.0/24\nPC2   192.168.2.10/24（Default Gateway 192.168.2.1）\n\n後半で足す2本目: R1 g0/2 10.0.0.5 ── R2 g0/2 10.0.0.6（10.0.0.4/30）\n```',
    'Theoryの順に、①ルータが自分のネットワークを知る（Connected）→ ②知らないネットワークを教える（静的ルート）→ ③帰り道を作る → ④tracerouteで確かめる → ⑤Default Routeにまとめる、と組み立てます。後半は2本目のケーブルを足し、⑥OSPFに経路を教え合わせて、同じコストの2本の道（ECMP）を使います。',
  ].join('\n\n'),
  source: 'PC1', target: '192.168.2.10',
  build: () => build([
    { id: 'PC1', kind: 'pc', at: [0, 130], ip: { eth0: '192.168.1.10/24' }, gw: '192.168.1.1' },
    { id: 'R1', kind: 'router', at: [240, 130] },
    { id: 'R2', kind: 'router', at: [480, 130] },
    { id: 'PC2', kind: 'pc', at: [720, 130], ip: { eth0: '192.168.2.10/24' }, gw: '192.168.2.1' },
  ], [['PC1', 'eth0', 'R1', 'g0/0'], ['R1', 'g0/1', 'R2', 'g0/0'], ['R2', 'g0/1', 'PC2', 'eth0']]),
  sim: [
    { title: 'R1に、LAN1側のアドレスを付ける',
      body: 'PC1のDefault Gatewayは 192.168.1.1 です。R1の、PC1につながったインターフェース（g0/0）にこのアドレスを付けると、R1がLAN1の出口になります（Theory「ルータは、ネットワークどうしをつなぐ」）。\n\n- GUI: R1を選び、右の「機器設定」で g0/0 に `192.168.1.1/24` を入れて適用\n- CLI: R1のTerminalで\n\n```text\nenable\nconfigure terminal\ninterface g0/0\nip address 192.168.1.1 255.255.255.0\nend\n```\n\nPC1のTerminalで `ping 192.168.1.1` が通れば正しく入っています。',
      hints: ['/24 のマスクは 255.255.255.0 です。', 'PC1の画面で ping 192.168.1.1 が通れば、この設定は正しく入っています。'],
      check: n => net.address(n, 'R1', 'PC1') === '192.168.1.1/24',
      solve: n => n.configureInterface('R1', 'g0/0', '192.168.1.1/24', true) },
    { title: 'ルータ間のリンクにアドレスを付ける',
      body: 'R1とR2の間は、2台だけが使う小さなネットワーク 10.0.0.0/30 です（ホストに使えるのは .1 と .2 の2つだけ）。R1の g0/1 に `10.0.0.1/30`、R2の g0/0 に `10.0.0.2/30` を設定します。\n\nCLIでは `interface g0/1` → `ip address 10.0.0.1 255.255.255.252` です（R2は `interface g0/0` → `ip address 10.0.0.2 255.255.255.252`）。R1のTerminalで `ping 10.0.0.2` が `!!!!!` になれば完了です。',
      hints: ['/30 のマスクは 255.255.255.252 です。', 'R2は別の機器なので、R2のTerminalでも enable → configure terminal から始めます。'],
      check: n => net.address(n, 'R1', 'R2') === '10.0.0.1/30' && net.address(n, 'R2', 'R1') === '10.0.0.2/30',
      solve: n => { n.configureInterface('R1', 'g0/1', '10.0.0.1/30', true); n.configureInterface('R2', 'g0/0', '10.0.0.2/30', true); } },
    { title: 'R2に、LAN2側のアドレスを付ける',
      body: 'PC2のDefault Gateway 192.168.2.1 を、R2のPC2側のインターフェース（g0/1）に設定します。これで3つのネットワークすべてに、ルータの足（インターフェース）がかかりました。\n\n- GUI: R2の「機器設定」で g0/1 に `192.168.2.1/24`\n- CLI: R2で `interface g0/1` → `ip address 192.168.2.1 255.255.255.0`',
      check: n => net.address(n, 'R2', 'PC2') === '192.168.2.1/24',
      solve: n => n.configureInterface('R2', 'g0/1', '192.168.2.1/24', true) },
    { title: 'R1の経路表を読む',
      body: 'R1のTerminalで `show ip route` を実行します（右の「状態」タブでも見られます）。行頭の **C** は Connected、つまり「自分のインターフェースが直接つながっているネットワーク」です。アドレスを付けただけで、ルータはそのネットワークへの行き方を知ります（Theory「Connected：アドレスを付けると載る経路」）。\n\nPC1から `ping 192.168.2.10` も試してみましょう。`From 192.168.1.1 ... Destination Net Unreachable` が返ります。',
      quiz: { question: 'いまのR1の経路表に載っているネットワークはどれですか？', options: ['192.168.1.0/24 と 10.0.0.0/30', '192.168.1.0/24、10.0.0.0/30、192.168.2.0/24', '0.0.0.0/0 だけ'], answer: 0, explanation: 'R1が直接つながっているのは LAN1 と R2とのリンクだけです。192.168.2.0/24 はR2の向こう側にあるので、教えない限りR1は知りません。だからR1は「宛先のネットワークがわからない」というICMP（Destination Net Unreachable）をPC1に返しました。' } },
    { title: 'R1に、LAN2への静的ルートを入れる',
      body: '「192.168.2.0/24 宛ては、R2（10.0.0.2）に渡す」という経路をR1に教えます。これが静的ルートで、10.0.0.2 がNext Hop（次に渡す相手）です（Theory「静的ルート：知らないネットワークを教える」）。\n\n- GUI: R1の「機器設定」→ Routing Table に Destination `192.168.2.0/24`、Next Hop `10.0.0.2` を入れて「静的ルートを追加」\n- CLI: `configure terminal` → `ip route 192.168.2.0 255.255.255.0 10.0.0.2`（このシミュレータでは `ip route 192.168.2.0/24 10.0.0.2` とも書けます）\n\n`show ip route` に `S 192.168.2.0/24 [1/0] via 10.0.0.2` が出れば完了です。',
      hints: ['Next Hopは、R1から直接届くアドレス（同じ 10.0.0.0/30 にいるR2）にします。192.168.2.1 はR1から直接届かないので、Next Hopには使えません。'],
      check: n => via(n, 'R1', '192.168.2.10')?.nextHop === '10.0.0.2',
      solve: n => n.addRoute('R1', { destination: '192.168.2.0/24', nextHop: '10.0.0.2', preference: 1, metric: 0 }) },
    { title: 'pingを送り、どこで止まるかを調べる',
      body: '画面下の SEND バーで PC1 → `192.168.2.10` に ping を送ります。まだ失敗するはずです。右の「Debugger」でイベントを1つずつ進め、Echo Request と Echo Reply がそれぞれどこまで進んだかを確かめましょう（Theory「行きと帰り：pingが成功する条件」）。',
      quiz: { question: 'pingが失敗した理由として、Debuggerから読み取れるものはどれですか？', options: ['Echo RequestがR1で捨てられた', 'Echo RequestはPC2に届いたが、R2がEcho Reply（192.168.1.10宛て）の経路を知らない', 'PC2がpingに応答しない設定になっている'], answer: 1, explanation: '行きの経路はR1に入れましたが、PC2からの返事は 192.168.1.10 宛てです。R2はLAN1への行き方を知らないので、返事を捨てます。捨てたのはPC2が送った返事なので、PC1にはエラーの知らせも届かず、黙って失敗します。通信には行きと帰りの両方の経路が要ります。' } },
    { title: 'R2に、帰りの経路を入れる',
      body: 'R2に「192.168.1.0/24 宛ては R1（10.0.0.1）に渡す」を設定します。\n\n- GUI: R2の Routing Table に `192.168.1.0/24` → Next Hop `10.0.0.1`\n- CLI: R2で `configure terminal` → `ip route 192.168.1.0 255.255.255.0 10.0.0.1`\n\nもう一度PC1からpingを送り、Echo Replyが戻ることを確かめましょう。PC1のTerminalの `ping -c 1 192.168.2.10` では `ttl=62` と表示されます（PC2が64で送り、R2とR1で1ずつ減った値です）。',
      check: n => net.ping(n, 'PC1', '192.168.2.10'),
      solve: n => n.addRoute('R2', { destination: '192.168.1.0/24', nextHop: '10.0.0.1', preference: 1, metric: 0 }) },
    { title: 'tracerouteで経路をたどる',
      body: 'PC1のTerminalで `traceroute 192.168.2.10` を実行します。TTLを1、2、3…と増やしながら調査用のパケットを送り、途中のルータが返す「時間切れ（Time Exceeded）」の送り主を順に並べたものが表示されます（Theory「traceroute：どこまで届いたかを調べる」）。',
      quiz: { question: 'tracerouteの1行目（1ホップ目）に表示されるアドレスはどれですか？', options: ['192.168.1.1（R1）', '10.0.0.2（R2）', '192.168.2.10（PC2）'], answer: 0, explanation: 'TTL=1のパケットは最初のルータR1で0になり、R1がPC1に面したアドレス 192.168.1.1 からTime Exceededを返します。2行目は 10.0.0.2（R2）、3行目は宛先のPC2です。' } },
    { title: 'R1の経路を、Default Routeにまとめる',
      body: 'R1から見ると、LAN1以外の宛先はすべてR2の方向にあります。そこで具体的な経路を消し、「どの宛先にも一致する」Default Route `0.0.0.0/0` をR2へ向けます（Theory「Default Route：『その他すべて』の行き先」）。\n\n```text\nconfigure terminal\nno ip route 192.168.2.0 255.255.255.0\nip route 0.0.0.0 0.0.0.0 10.0.0.2\nend\n```\n\nGUIでは、Routing Table の `192.168.2.0/24` を × で消し、Destination `0.0.0.0/0`・Next Hop `10.0.0.2` を追加します。設定後もpingが通ることを確かめ、R1で `show ip route 192.168.1.10` を実行して「最長一致の候補」を読みましょう（Theory「最長一致：いちばん具体的な経路が勝つ」）。',
      check: n => { const r1 = n.device('R1').routes; return r1.length === 1 && r1[0].destination === '0.0.0.0/0' && r1[0].nextHop === '10.0.0.2' && net.ping(n, 'PC1', '192.168.2.10'); },
      solve: n => { n.deleteRoute('R1', '192.168.2.0/24'); n.addRoute('R1', { destination: '0.0.0.0/0', nextHop: '10.0.0.2', preference: 1, metric: 0 }); },
      quiz: { question: 'R1の show ip route 192.168.1.10 では、候補に 192.168.1.0/24（connected）と 0.0.0.0/0（static）が並びます。PC1宛てに使われるのはどちらで、なぜですか？', options: ['192.168.1.0/24。一致するビットが24ビットで、0ビットの 0.0.0.0/0 より長いから', '0.0.0.0/0。staticの経路は connected より優先されるから', '両方を交互に使う'], answer: 0, explanation: 'ルータは、宛先に一致する経路のうちプレフィックスが最も長いもの（最長一致）を選びます。0.0.0.0/0 は1ビットも比べないのでどんな宛先にも一致しますが、より具体的な経路があるときは使われません。出力の1行目 Routing entry for 192.168.1.0/24 が、選ばれた経路です。' } },
    { title: 'R1とR2を、2本目のケーブルでつなぐ',
      body: 'R1とR2の間に、もう1本の道を作ります（Theory「動的ルーティングとOSPFのしくみ」）。新しいリンクのネットワークは 10.0.0.4/30 です。\n\n1. 配線: 構成図で、R1の空きポート g0/2 から R2の g0/2 へドラッグしてケーブルをつなぎます（ポートにカーソルを当てると名前が出ます）。\n2. アドレス: R1 g0/2 に `10.0.0.5/30`、R2 g0/2 に `10.0.0.6/30`（CLIでは `interface g0/2` → `ip address 10.0.0.5 255.255.255.252`）。\n\nR1のTerminalで `ping 10.0.0.6` が `!!!!!` になり、`show ip route` に `C 10.0.0.4/30` が増えれば完了です。',
      hints: ['ケーブルは、ポートの小さな丸から相手のポートの丸へドラッグします。', '10.0.0.4/30 で使えるアドレスは .5 と .6 の2つだけです（.4 はネットワークアドレス、.7 はブロードキャストアドレス）。'],
      check: n => r1r2(n) === 2 && net.hasAddress(n, 'R1', '10.0.0.5/30') && net.hasAddress(n, 'R2', '10.0.0.6/30') && net.ping(n, 'R1', '10.0.0.6'),
      solve: n => {
        n.connect({ id: 'link-4', sourceDevice: 'R1', sourceInterface: 'g0/2', targetDevice: 'R2', targetInterface: 'g0/2', up: true, bandwidth: 1000, latency: 1 });
        n.configureInterface('R1', 'g0/2', '10.0.0.5/30', true); n.configureInterface('R2', 'g0/2', '10.0.0.6/30', true);
      } },
    { title: 'R1とR2で、OSPFを動かす',
      body: 'R1とR2にOSPFを設定し、経路を自動で教え合わせます（Theory「OSPFを設定して、経路表を読む」）。OSPFの設定欄はGUIにないので、Terminalで入力します。R1では:\n\n```text\nenable\nconfigure terminal\nrouter ospf 1\nnetwork 10.0.0.0/24 area 0\nnetwork 192.168.1.0/24 area 0\npassive-interface g0/0\nend\n```\n\nR2では、LAN側を `network 192.168.2.0/24 area 0` と `passive-interface g0/1` にします（`network 10.0.0.0/24 area 0` は同じ）。`10.0.0.0/24` は、2本のリンク（10.0.0.0/30 と 10.0.0.4/30）の両方を含む範囲です。\n\n`show ip ospf neighbor` で相手が2行（FULL）、R1の `show ip route` で `O 192.168.2.0/24` の下に via 10.0.0.2 と via 10.0.0.6 の2行（ECMP）が出れば完了です。',
      hints: ['show ip ospf neighbor に何も出ないときは、両方のルータで network 文の範囲とエリア番号（area 0）を見直します。show logging に原因が出ます。', 'R1でLAN側の network 192.168.1.0/24 area 0 を忘れると、R2は 192.168.1.0/24 をOSPFで知ることができません。'],
      check: n => { const r = via(n, 'R1', '192.168.2.10'); return r?.route.kind === 'ospf' && r.ecmp?.paths.length === 2 && routingTable(n.device('R2')).some(x => x.kind === 'ospf' && x.destination === '192.168.1.0/24'); },
      solve: n => { n.update('R1', d => { d.ospf = ospf('192.168.1.0/24', 'g0/0'); }); n.update('R2', d => { d.ospf = ospf('192.168.2.0/24', 'g0/1'); }); },
      quiz: { question: 'R2で show ip route 192.168.1.10 を実行すると、同じ 192.168.1.0/24 が static [1/0] と ospf [110/2] の両方で候補に出ます。使われているのはどちらで、なぜですか？', options: ['static。プレフィックス長が同じなので、AD（1 と 110）の小さいほうが選ばれる', 'ospf。メトリック 2 が static の 0 より正確だから', 'ospf。新しく覚えた経路が優先されるから'], answer: 0, explanation: 'プレフィックス長が同じ候補どうしは、AD（情報源の信頼度）で比べます。static は 1、OSPF は 110 なので static が使われ、OSPFの経路は控えに回ります。メトリックは同じ情報源（同じプロトコル）の中でだけ比べる値です。' } },
    { title: 'R2の静的ルートを消し、OSPFに任せる',
      body: 'R2の帰りの経路を、OSPFが計算した経路に切り替えます（Theory「ADとメトリック：同じ宛先を2通りで知ったとき」）。\n\n- GUI: R2の Routing Table で `192.168.1.0/24 via 10.0.0.1` を × で消す\n- CLI: R2で `configure terminal` → `no ip route 192.168.1.0 255.255.255.0 10.0.0.1`\n\nR2の `show ip route` が `O 192.168.1.0/24` の2行になり、pingが通ることを確かめます。\n\n最後に、障害を起こしてみます（Theory「経路が壊れたとき：収束とブラックホール」）。1本目のケーブル（R1 g0/1 – R2 g0/0）をダブルクリックして Link Down にし、R1の `show ip route` とPC1からのpingを確かめます。確かめたら、**もう一度ダブルクリックして Link Up に戻してください**（戻すまで、前のステップの判定が外れます）。',
      check: n => via(n, 'R2', '192.168.1.10')?.route.kind === 'ospf' && net.ping(n, 'PC1', '192.168.2.10'),
      solve: n => { n.deleteRoute('R2', '192.168.1.0/24', '10.0.0.1'); },
      quiz: { question: '1本目のケーブルを Link Down にしたとき、R1の show ip route はどう変わりましたか？', options: ['O 192.168.2.0/24 は via 10.0.0.6 の1行だけになり、10.0.0.0/30 の C の行と、10.0.0.2 へ向けた S* 0.0.0.0/0 の行も消えた', '何も変わらない（静的ルートもOSPFの経路も、そのまま残る）', '192.168.2.0/24 への経路がすべて消え、pingも失敗する'], answer: 0, explanation: 'ケーブルが切れると、そのインターフェースのConnectedの経路が消えます。Next Hop 10.0.0.2 に届かなくなったDefault Routeも使えなくなります。OSPFは残った 10.0.0.4/30 で経路を計算し直し（収束）、via 10.0.0.6 だけでLAN2へ届け続けます。' } },
  ],
  debrief: 'アドレスを付ければ Connected、知らない先は静的ルート、帰り道も忘れずに、端のルータは Default Route でまとめる。道が増えたら OSPF に経路を教え合わせ、同じコストの道は ECMP で同時に使い、壊れた道は自動で外す——これが、ルーティングの基本形です。',
});
