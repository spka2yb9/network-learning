import { createDevice, type NetworkSimulator } from '../../simulator/core/NetworkSimulator';
import { build } from '../../simulator/scenarios/build';
import { cidr, ipOf } from '../../simulator/l3/ipv4';
import { net, networkSimulation } from '../simulation';

const SALES = '192.168.10.0/26', DEV = '192.168.10.64/27', ADMIN = '192.168.10.96/28';
/** Is this interface address in that subnet, with that prefix length? (The simulator rejects network / broadcast addresses.) */
const on = (address: string | undefined, subnet: string) => !!address && cidr(address).canonical === subnet;
const pcAddress = (n: NetworkSimulator, id: string) => n.device(id).interfaces.find(i => i.id === 'eth0')?.address;
/** R1's address on the cable to the LAN switch `sw` (port-agnostic). */
const gw = (n: NetworkSimulator, sw: string) => ipOf(net.address(n, 'R1', sw));
/** A PC is set up for its LAN: a host address of the subnet (not R1's), R1 as its gateway, and R1 answers a ping. */
const hostReady = (n: NetworkSimulator, pc: string, sw: string, subnet: string) => {
  const a = pcAddress(n, pc); const g = gw(n, sw);
  return on(a, subnet) && !!g && ipOf(a) !== g && n.device(pc).gateway === g && net.ping(n, pc, g);
};

/** Chapter 2: split 192.168.10.0/24 into three LANs of different sizes (VLSM) and address them. */
export const subnetSimulation = networkSimulation({
  id: 'sim-subnet', chapter: 'subnet', minutes: 35,
  title: '192.168.10.0/24 を3つのLANに切り分ける',
  mission: 'アドレス計画どおりにR1とPCへアドレス・マスク・ゲートウェイを設定し、3つのLANの間でpingを通す',
  brief: [
    'Theoryで立てた新オフィスのアドレス計画（`192.168.10.0/24` をVLSMで3つのLANに分けたもの）を、そのまま組み立てます。配線は済んでいます。R1にはまだアドレスがなく、PC2だけは先輩が設定したまま（マスクが /24）です。開発LANのPC3は、これから追加します。',
    '```text\n                          R1\n          g0/0 ┌───────────┼───────────┐ g0/2\n               │         g0/1          │\n              SW1         SW2         SW3\n             ┌─┴─┐         │           │\n            PC1  PC2     （PC3）       PC4\n```',
    '| LAN | ネットワーク | R1（ゲートウェイ） | PC |\n| --- | --- | --- | --- |\n| 営業LAN | `192.168.10.0/26` | `192.168.10.1` | PC1 `.10`、PC2 `.20` |\n| 開発LAN | `192.168.10.64/27` | `192.168.10.65` | PC3 `.70` |\n| 総務LAN | `192.168.10.96/28` | `192.168.10.97` | PC4 `.100` |',
    '実際の台数ぶんのPCは置かず、各LANに代表のPCを置きます。Theoryの順に、①範囲を計算する → ②R1にLANの出口のアドレスを付ける → ③PCにアドレス・マスク・ゲートウェイを設定する → ④`ip route get` で送り方を確かめる → ⑤マスクの間違いを見つけて直す、と進みます。',
  ].join('\n\n'),
  source: 'PC1', target: '192.168.10.70',
  build: () => build([
    { id: 'R1', kind: 'router', at: [400, 40] },
    { id: 'SW1', kind: 'switch', at: [140, 170] },
    { id: 'SW2', kind: 'switch', at: [400, 170] },
    { id: 'SW3', kind: 'switch', at: [660, 170] },
    { id: 'PC1', kind: 'pc', at: [60, 300] },
    { id: 'PC2', kind: 'pc', at: [220, 300], ip: { eth0: '192.168.10.20/24' }, gw: '192.168.10.1' },
    { id: 'PC4', kind: 'pc', at: [660, 300] },
  ], [['R1', 'g0/0', 'SW1', 'g0/1'], ['R1', 'g0/1', 'SW2', 'g0/1'], ['R1', 'g0/2', 'SW3', 'g0/1'],
    ['SW1', 'g0/2', 'PC1', 'eth0'], ['SW1', 'g0/3', 'PC2', 'eth0'], ['SW3', 'g0/2', 'PC4', 'eth0']]),
  sim: [
    { title: 'アドレス計画を確かめる',
      body: 'Theoryの「VLSM」で立てた計画では、営業LAN（50台＋R1）は `192.168.10.0/26`、開発LAN（25台＋R1）は `192.168.10.64/27`、総務LAN（10台＋R1）は `192.168.10.96/28` です。\n\n設定を始める前に、営業LANの範囲を計算しておきます。/26 はホスト部が 32 − 26 = 6ビット、ブロックの大きさは 2の6乗 = 64 です。\n\n```text\nネットワークアドレス     ホスト部が全部0\nブロードキャストアドレス ホスト部が全部1\n使える範囲               その間\n```',
      quiz: { question: '192.168.10.0/26 で、機器に割り当てられるアドレスの範囲はどれですか？', options: ['192.168.10.0 〜 192.168.10.63', '192.168.10.1 〜 192.168.10.62', '192.168.10.1 〜 192.168.10.63', '192.168.10.1 〜 192.168.10.254'], answer: 1, explanation: 'ブロックは .0〜.63 の64個です。先頭の .0 はネットワークアドレス、末尾の .63 はブロードキャストアドレスなので、機器に使えるのは .1〜.62 の62個（2の6乗 − 2）です。' } },
    { title: 'R1に、営業LAN側のアドレスを付ける',
      body: '営業LANの出口（デフォルトゲートウェイ）になるR1のポートに、計画どおり先頭の使えるアドレス `192.168.10.1/26` を付けます。R1の、SW1につながったポート（g0/0）です。\n\n- GUI: R1を選び、右の「機器設定」で g0/0 に `192.168.10.1/26` を入れて適用\n- CLI: R1のTerminalで\n\n```text\nenable\nconfigure terminal\ninterface g0/0\nip address 192.168.10.1 255.255.255.192\nend\n```\n\nIOS形式のCLIでは、プレフィックス長ではなくサブネットマスクで書きます。/26 のマスクは 255.255.255.192 です。',
      hints: ['/26 は「先頭から26ビットが1」。第4オクテットは 1100 0000 = 192 です。', 'GUIでは `/26` の形のまま入力できます。'],
      check: n => on(net.address(n, 'R1', 'SW1'), SALES),
      solve: n => n.configureInterface('R1', 'g0/0', '192.168.10.1/26', true),
      quiz: { question: '営業LAN（192.168.10.0/26）のブロードキャストアドレスはどれですか？', options: ['192.168.10.255', '192.168.10.63', '192.168.10.64', '192.168.10.62'], answer: 1, explanation: 'ホスト部の6ビットを全部1にすると 0011 1111 = 63 です。.64 は隣のブロック（開発LAN 192.168.10.64/27）の先頭です。' } },
    { title: 'PC1に、アドレス・マスク・ゲートウェイを設定する',
      body: 'PC1に、営業LANの中のアドレスと、R1のアドレスをデフォルトゲートウェイとして設定します。例として `192.168.10.10/26`、ゲートウェイ `192.168.10.1` を使います（.2〜.62 のうち、R1と重ならないものなら判定は通ります）。\n\n- GUI: PC1を選び、eth0 に `192.168.10.10/26`、Default Gateway に `192.168.10.1` を入れてそれぞれ適用\n- CLI: PC1のTerminalで\n\n```text\nip addr add 192.168.10.10/26 dev eth0\nip route add default via 192.168.10.1\nping 192.168.10.1\n```\n\nR1からEcho Replyが返れば、PC1とR1は同じネットワークにいて、直接届いています。',
      hints: ['マスクも忘れずに。`192.168.10.10` だけでなく `/26` まで入れます。', 'ゲートウェイは、ひとつ前のステップでR1に付けたアドレスです。'],
      check: n => hostReady(n, 'PC1', 'SW1', SALES),
      solve: n => { n.configureInterface('PC1', 'eth0', '192.168.10.10/26', true); n.setGateway('PC1', '192.168.10.1'); } },
    { title: 'R1に、開発LAN側のアドレスを付ける',
      body: '開発LANは `192.168.10.64/27` です。R1の、SW2につながったポート（g0/1）に、このLANの先頭の使えるアドレス `192.168.10.65/27` を付けます。\n\n- GUI: R1の g0/1 に `192.168.10.65/27`\n- CLI: R1のTerminalで\n\n```text\nenable\nconfigure terminal\ninterface g0/1\nip address 192.168.10.65 255.255.255.224\nend\n```\n\n/27 のマスクは、第4オクテットが 1110 0000 = 224 です。',
      hints: ['ブロックの大きさは 256 − 224 = 32。.64 から始まるブロックは .64〜.95 です。'],
      check: n => on(net.address(n, 'R1', 'SW2'), DEV),
      solve: n => n.configureInterface('R1', 'g0/1', '192.168.10.65/27', true),
      quiz: { question: '開発LAN（192.168.10.64/27）で、PCに割り当てられるアドレスはどれですか？', options: ['192.168.10.64', '192.168.10.94', '192.168.10.95', '192.168.10.96'], answer: 1, explanation: '.64 はネットワークアドレス、.95 はブロードキャストアドレス、.96 は次のブロック（総務LAN 192.168.10.96/28）の先頭です。使えるのは .65〜.94 で、.94 はその最後です。' } },
    { title: '開発LANにPC3を追加して、設定する',
      body: '開発LANの代表として、PCを1台追加します。\n\n1. 左の DEVICES パレットで PC をクリック（または構成図へドラッグ）。空いている最小の番号で **PC3** という名前になります\n2. PC3 の eth0 から、SW2 の空いているポートへドラッグして配線\n3. 開発LANのアドレスを設定（例: `192.168.10.70/27`、ゲートウェイ `192.168.10.65`。.66〜.94 のうちR1と重ならないものなら判定は通ります）\n\n- GUI: PC3を選び、eth0 に `192.168.10.70/27`、Default Gateway に `192.168.10.65`\n- CLI: PC3のTerminalで\n\n```text\nip addr add 192.168.10.70/27 dev eth0\nip route add default via 192.168.10.65\n```\n\n設定できたら、PC1から `ping 192.168.10.70` を実行します。PC1とPC3は別のネットワークなので、R1を経由して届きます（Theory「同じネットワークなら直接、違えばゲートウェイへ」）。',
      hints: ['PC3のゲートウェイは、開発LAN側のR1のアドレス（192.168.10.65）です。営業LAN側の .1 ではありません。', 'PC1からのpingが届かないときは、PC3で `ip route` を実行し、default via の行に注意書きが出ていないか確かめます。'],
      check: n => net.linked(n, 'PC3', 'SW2') && hostReady(n, 'PC3', 'SW2', DEV) && net.ping(n, 'PC1', ipOf(pcAddress(n, 'PC3'))!),
      solve: n => {
        n.addDevice(createDevice('PC3', 'pc', 8, { x: 400, y: 300 }));
        n.connect({ id: 'link-pc3', sourceDevice: 'SW2', sourceInterface: 'g0/2', targetDevice: 'PC3', targetInterface: 'eth0', up: true, bandwidth: 1000, latency: 1 });
        n.configureInterface('PC3', 'eth0', '192.168.10.70/27', true); n.setGateway('PC3', '192.168.10.65');
      } },
    { title: 'PC1の送り方を、ip route get で確かめる',
      body: 'PC1のTerminalで、経路表と、宛先ごとの判断を表示します。\n\n```text\nip route\nip route get 192.168.10.20\nip route get 192.168.10.70\n```\n\n`ip route` の1行目（`192.168.10.0/26 dev eth0 …`）が「自分のネットワークには直接送る」、`default via …` が「それ以外はゲートウェイへ」です。`ip route get` は、その宛先にどの行が使われるかを示します。`via` が付いていればゲートウェイ経由、付いていなければ直接です。',
      quiz: { question: 'PC1で ip route get 192.168.10.70（PC3）を実行した結果はどうでしたか？', options: ['via が付かない（同じネットワークとして直接送る）', 'via 192.168.10.1 が付く（R1に預ける）', 'Network is unreachable と表示される'], answer: 1, explanation: 'PC1のネットワークは 192.168.10.0/26（.0〜.63）なので、.70 はその外です。PC1は default の行を使い、R1（192.168.10.1）に預けます。一方、.20（PC2）は同じネットワークなので via が付きません。' } },
    { title: 'PC2から開発LANへpingして、症状を調べる',
      body: 'PC2は先輩が設定したままです。PC2のTerminalで次を実行し、結果を比べます。\n\n```text\nping 192.168.10.1\nping 192.168.10.70\nip addr\nip route get 192.168.10.70\n```\n\nゲートウェイには届くのに、開発LANのPC3には届きません。`ip addr` の `inet` の行で、`/` の後ろの数字を確かめましょう。Debuggerで、PC2のARP（相手のMACアドレスの問い合わせ）が誰を探しているかも見られます。',
      quiz: { question: 'PC2からPC3（192.168.10.70）へのpingが失敗する原因はどれですか？', options: ['R1が開発LANへの行き方を知らない', 'PC2のマスクが /24 なので、.70 を自分と同じネットワークと判断し、ゲートウェイに預けずに直接ARPで探している', 'PC3のゲートウェイが間違っている', 'PC2のゲートウェイが R1 のアドレスではない'], answer: 1, explanation: '/24 だと 192.168.10.0〜.255 全体が「自分のネットワーク」に見えます。PC2は .70 を直接ARPで探しますが、PC3は R1 の向こう側の別のLANにいるので、誰も答えません。ip route get に via が付かないことでも確かめられます。' } },
    { title: 'PC2のマスクを /26 に直す',
      body: 'PC2のアドレスはそのままで、プレフィックス長だけを計画どおり /26 に直します。\n\n- GUI: PC2の eth0 を `192.168.10.20/26` に変えて適用\n- CLI: PC2のTerminalで\n\n```text\nip addr del 192.168.10.20/24 dev eth0\nip addr add 192.168.10.20/26 dev eth0\nping 192.168.10.70\n```\n\n直したら、もう一度 `ip route get 192.168.10.70` を実行して、`via` が付くようになったことも確かめましょう。',
      hints: ['ip addr add は、すでにアドレスがあるとエラーになります。先に ip addr del で古いアドレスを消します。'],
      check: n => hostReady(n, 'PC2', 'SW1', SALES) && net.ping(n, 'PC2', ipOf(pcAddress(n, 'PC3'))!),
      solve: n => n.configureInterface('PC2', 'eth0', '192.168.10.20/26', true) },
    { title: '総務LANを仕上げる',
      body: '総務LANは `192.168.10.96/28` です。まず試しに、R1の、SW3につながったポート（g0/2）に `192.168.10.96/28` を設定してみて、何が表示されるかを確かめます（GUIで入れても、同じ内容のエラーが表示されます）。\n\n```text\nenable\nconfigure terminal\ninterface g0/2\nip address 192.168.10.96 255.255.255.240\n```\n\n確かめたら、正しい計画どおりに設定します。\n\n- R1の g0/2: `192.168.10.97/28`（マスク 255.255.255.240）\n- PC4: `192.168.10.100/28`、ゲートウェイ `192.168.10.97`\n\n最後に、PC4から営業LANのPC1（`ping 192.168.10.10`）へ届くことを確かめます。',
      hints: ['/28 はブロックの大きさ 16。.96 から始まるブロックは .96〜.111 で、使えるのは .97〜.110 です。'],
      check: n => on(net.address(n, 'R1', 'SW3'), ADMIN) && hostReady(n, 'PC4', 'SW3', ADMIN) && net.ping(n, 'PC4', ipOf(pcAddress(n, 'PC1'))!),
      solve: n => { n.configureInterface('R1', 'g0/2', '192.168.10.97/28', true); n.configureInterface('PC4', 'eth0', '192.168.10.100/28', true); n.setGateway('PC4', '192.168.10.97'); },
      quiz: { question: 'R1に 192.168.10.96/28 を設定しようとしたとき、どうなりましたか？', options: ['そのまま設定できた', 'ネットワークアドレスなので機器には割り当てられない、というエラーになった', '開発LANと範囲が重なる、というエラーになった'], answer: 1, explanation: '/28 の .96 はホスト部が全部0、つまりネットワークアドレス（ネットワークそのものの名前）なので、機器には付けられません。使えるのは .97〜.110 です。' } },
    { title: 'R1の経路表で、3つのLANを確かめる',
      body: 'R1のTerminalで `show ip route` を実行します（右の「状態」タブでも見られます）。行頭の **C**（Connected）は、R1のポートが直接つながっているネットワークです。アドレスとマスクを付けただけで、R1はそれぞれのLANの範囲を知り、LANの間でパケットを中継できるようになりました。',
      quiz: { question: 'R1の show ip route に C で載っているネットワークはどれですか？', options: ['192.168.10.0/24 の1行だけ', '192.168.10.0/26、192.168.10.64/27、192.168.10.96/28 の3行', '192.168.10.1、192.168.10.65、192.168.10.97 の3行'], answer: 1, explanation: 'R1はポートのアドレスとプレフィックス長から、それぞれのネットワークアドレスを計算して経路表に載せます。プレフィックス長がLANごとに違う（VLSM）ことも、そのまま経路表に表れています。経路表の読み方は、次の第3章で詳しく扱います。' } },
  ],
  debrief: '1つの /24 を、必要な大きさに合わせて /26・/27・/28 に切り分け、ルータの各ポートに「LANの出口」のアドレスを、PCには同じネットワークのアドレス・マスク・ゲートウェイを設定しました。マスクが1つ違うだけで「一部の相手にだけ届かない」症状になることも確かめました。設定のあとは、ip addr で / の後ろの数字まで確かめる習慣をつけましょう。',
});
