import { createDevice, type NetworkSimulator } from '../../simulator/core/NetworkSimulator';
import type { NetworkInterface } from '../../simulator/core/types';
import { access, build, lag, subinterface, trunk, vlans } from '../../simulator/scenarios/build';
import { net, networkSimulation } from '../simulation';

type N = NetworkSimulator;
type Switchport = NetworkInterface['switchport'];
/** a's switchport on the cable to b (the learner chooses the ports). */
const sp = (n: N, a: string, b: string) => n.device(a).interfaces.find(i => i.id === net.port(n, a, b))?.switchport;
const accessIn = (n: N, sw: string, pc: string, vlan: number) => { const s = sp(n, sw, pc); return s?.mode === 'access' && s.accessVlan === vlan; };
const carries = (s: Switchport, ...list: number[]) => s?.mode === 'trunk' && list.every(v => s.allowedVlans === 'all' || s.allowedVlans.includes(v));
const hasVlans = (n: N, id: string) => [10, 20].every(v => n.device(id).vlans?.some(x => x.id === v));
/** Up cables between SW1 and SW2 (a second one is added in step 10). */
const uplinks = (n: N) => n.snapshot().links.filter(l => l.up && [l.sourceDevice, l.targetDevice].sort().join() === 'SW1,SW2');
const port = (n: N, id: string, name: string) => n.device(id).interfaces.find(i => i.id === name);
/** PC1's broadcasts stay in VLAN 10. */
const isolated = (n: N) => !n.broadcastDomain('PC1', 'eth0').some(r => r.device === 'PC2' || r.device === 'PC4');
const bundled = (n: N, id: string) => Object.values(n.device(id).lagStatus ?? {}).some(l => l.up && l.members.filter(m => m.flag === 'P').length >= 2);

/** Chapter 4: the Theory's office (sales VLAN 10 / dev VLAN 20 on two floors), from "switches just plugged in" to VLANs, trunk, router on a stick and LACP. */
export const ethernetVlanSimulation = networkSimulation({
  id: 'sim-ethernet-vlan', chapter: 'ethernet-vlan', minutes: 45,
  title: '2台のスイッチで、部署ごとのLANを組み立てる',
  mission: 'スイッチにVLANとトランクを設定して営業部（VLAN 10）と開発部（VLAN 20）を分け、ルータR1でVLAN間をつなぎ、最後にスイッチ間の2本のケーブルをLACPで束ねる',
  brief: [
    'Theoryの「例のネットワーク」です。配線とPCのアドレスは済んでいますが、スイッチは買ってきてつないだだけ（全ポートが VLAN 1）で、ルータはまだありません。',
    '```text\n           1階                                        2階\nPC1（営業）192.168.10.11 ─ g0/1 ┐                 ┌ g0/1 ─ PC3（営業）192.168.10.13\n                               SW1 g0/3 ─── g0/3 SW2\nPC2（開発）192.168.20.12 ─ g0/2 ┘                 └ g0/2 ─ PC4（開発）192.168.20.14\n```',
    '完成形はこうです。\n\n```text\n                      R1  g0/0.10 = 192.168.10.1 / g0/0.20 = 192.168.20.1\n                      │ g0/0 ── g0/8（トランク）\nPC1（VLAN 10）─ g0/1 ─ SW1 ══ po1（g0/3・g0/4 を束ねたトランク）══ SW2 ─ g0/1 ─ PC3（VLAN 10）\nPC2（VLAN 20）─ g0/2 ─┘                                          └─ g0/2 ─ PC4（VLAN 20）\n```',
    'Theoryの順に、①MAC学習とブロードキャストを観察 → ②VLANで分ける → ③トランクでスイッチ間をつなぐ → ④ルータでVLAN間をつなぐ（Router on a Stick）→ ⑤ケーブルを二重にしてSTPを観察 → ⑥LACPで束ねる、と組み立てます。',
  ].join('\n\n'),
  source: 'PC1', target: '192.168.10.13',
  build: () => build([
    { id: 'PC1', kind: 'pc', at: [0, 160], ip: { eth0: '192.168.10.11/24' }, gw: '192.168.10.1' },
    { id: 'PC2', kind: 'pc', at: [0, 400], ip: { eth0: '192.168.20.12/24' }, gw: '192.168.20.1' },
    { id: 'PC3', kind: 'pc', at: [800, 160], ip: { eth0: '192.168.10.13/24' }, gw: '192.168.10.1' },
    { id: 'PC4', kind: 'pc', at: [800, 400], ip: { eth0: '192.168.20.14/24' }, gw: '192.168.20.1' },
    { id: 'SW1', kind: 'switch', at: [240, 280] },
    { id: 'SW2', kind: 'switch', at: [560, 280] },
  ], [['PC1', 'eth0', 'SW1', 'g0/1'], ['PC2', 'eth0', 'SW1', 'g0/2'], ['SW1', 'g0/3', 'SW2', 'g0/3'], ['SW2', 'g0/1', 'PC3', 'eth0'], ['SW2', 'g0/2', 'PC4', 'eth0']]),
  sim: [
    { title: 'PC1からPC3へpingし、SW1のMACアドレステーブルを読む',
      body: 'スイッチが「誰がどのポートの先にいるか」を覚える様子を確かめます（Theory「フレームを1つずつ追う：2台のスイッチをまたぐping」）。\n\n1. 画面下の SEND バーで PC1 → `192.168.10.13` に ping を送る（PC1のTerminalで `ping 192.168.10.13` でも同じ）\n2. 右の「Debugger」でイベントを進め、`MAC_LEARNED`（学習した）と `MAC_LOOKUP`（表を引いて送り先を決めた）を探す\n3. SW1のTerminalで `show mac address-table` を実行する（SW1を選んで右の「状態」タブでも見られます）\n\nPC3のMACアドレスは `02:00:00:03:00:01` です。',
      hints: ['MACアドレステーブルは、機器の設定を変えると消えます。消えていたら、もう一度pingを送ってから見ます。'],
      quiz: { question: 'SW1のMACアドレステーブルで、PC3のMACアドレス 02:00:00:03:00:01 はどのポートに載っていますか？', options: ['g0/1（PC1がつながるポート）', 'g0/3（SW2につながるポート）', 'どこにも載っていない（PC3はSW1に直接つながっていないから）'], answer: 1, explanation: 'SW1は、PC3からの返事（ARP Reply・Echo Reply）を g0/3 で受け取り、その送信元MACを g0/3 に学習しました。スイッチにとっては「そのポートの先のどこかにいる」がわかれば十分で、SW2の向こうにいる機器は、すべて g0/3 に載ります。' } },
    { title: '開発部のPC2に届いたフレームを調べる',
      body: '営業部どうしのpingで、開発部のPC2に何が届いたかを確かめます（Theory「ブロードキャストが届く範囲：ブロードキャストドメイン」）。\n\nPC2のTerminalで `tcpdump -e` を実行します。PC2のケーブルを通ったフレームが、MACアドレス付きで表示されます。',
      quiz: { question: 'PC2の tcpdump -e に表示されたフレームはどれですか？', options: ['PC1が出した ARP Request（宛先 ff:ff:ff:ff:ff:ff、Who has 192.168.10.13?）', 'PC1からPC3への Echo Request', '何も表示されない（PC2は開発部で、サブネットも違うから）'], answer: 0, explanation: 'ARP Requestはブロードキャストなので、SW1・SW2がすべてのポートへフラッディングし、開発部のPC2・PC4にも届きました。IPのサブネットを分けても、同じスイッチの同じVLAN（いまは全員 VLAN 1）にいれば、ブロードキャストドメインは1つです。Echo Requestはユニキャストで、学習済みの g0/3 にだけ送られたので、PC2には届いていません。' } },
    { title: 'SW1にVLAN 10・20を作り、PC1とPC2のポートを分ける',
      body: 'SW1に営業部（VLAN 10、名前 SALES）と開発部（VLAN 20、名前 DEV）を作り、PC1のポートを VLAN 10、PC2のポートを VLAN 20 のアクセスポートにします（Theory「VLAN：1台のスイッチを、設定で複数のLANに分ける」）。\n\n- GUI: SW1を選び、「VLAN / STP」の欄で VLAN ID `10`・名前 `SALES` を入れて「VLANを作成」（20 / DEV も同じ）。「インターフェース」の欄で g0/1 をモード access・VLAN `10`、g0/2 を VLAN `20` にする\n- CLI: SW1のTerminalで\n\n```text\nenable\nconfigure terminal\nvlan 10\nname SALES\nexit\nvlan 20\nname DEV\nexit\ninterface g0/1\nswitchport mode access\nswitchport access vlan 10\nexit\ninterface g0/2\nswitchport mode access\nswitchport access vlan 20\nend\nshow vlan brief\n```\n\n`show vlan brief` で、g0/1 が SALES の行、g0/2 が DEV の行に出れば完了です。',
      hints: ['VLANを作る前にポートへ割り当てると、そのVLANのフレームはスイッチで捨てられます。先に vlan 10 / vlan 20 を作ります。'],
      check: n => hasVlans(n, 'SW1') && accessIn(n, 'SW1', 'PC1', 10) && accessIn(n, 'SW1', 'PC2', 20),
      solve: n => n.update('SW1', d => { vlans(d, [10, 'SALES'], [20, 'DEV']); access(d, 10, 'g0/1'); access(d, 20, 'g0/2'); }) },
    { title: 'SW2も同じように分ける',
      body: '2階のSW2でも VLAN 10（SALES）・20（DEV）を作り、PC3のポート（g0/1）を VLAN 10、PC4のポート（g0/2）を VLAN 20 のアクセスポートにします。やり方は前のステップと同じです。\n\n設定したら、PC1から `ping 192.168.10.13`（PC3）を試します。',
      hints: ['SW2は別の機器なので、SW2のTerminalでも enable → configure terminal から始めます。'],
      check: n => hasVlans(n, 'SW2') && accessIn(n, 'SW2', 'PC3', 10) && accessIn(n, 'SW2', 'PC4', 20),
      solve: n => n.update('SW2', d => { vlans(d, [10, 'SALES'], [20, 'DEV']); access(d, 10, 'g0/1'); access(d, 20, 'g0/2'); }),
      quiz: { question: '両方のスイッチを分けたあと、PC1からPC3（どちらも VLAN 10）へのpingはどうなりましたか？', options: ['届かない。SW1とSW2をつなぐ g0/3 が VLAN 1 のアクセスポートのままで、VLAN 10 のフレームを運べないから', '届く。同じ VLAN 10 どうしだから', '届かない。PC1とPC3のサブネットが違うから'], answer: 0, explanation: 'スイッチは、フレームを同じVLANのポートにしか出しません。SW1とSW2の間の g0/3 は何も設定していないので VLAN 1 のままで、VLAN 10 のフレームはそこから出ていけません。複数のVLANを1本で運ぶには、次のステップのトランクが要ります。' } },
    { title: 'SW1とSW2の間をトランクにする',
      body: 'SW1とSW2の g0/3 を、VLAN 10 と 20 を運ぶトランクにします（Theory「トランク：1本のケーブルで複数のVLANを運ぶ」）。\n\n- GUI: 各スイッチの「インターフェース」で g0/3 をモード trunk、許可VLAN `10,20` にする\n- CLI: SW1とSW2のそれぞれで\n\n```text\nconfigure terminal\ninterface g0/3\nswitchport mode trunk\nswitchport trunk allowed vlan 10,20\nend\nshow interfaces trunk\n```\n\nPC1 → `192.168.10.13`、PC2 → `192.168.20.14` のpingが通り、PC1のブロードキャストがPC2・PC4に届かなくなれば完了です。',
      hints: ['show interfaces trunk で、g0/3 の Status が trunking、Vlans allowed on trunk が 10,20 になっているか、両方のスイッチで確かめます。'],
      check: n => net.ping(n, 'PC1', '192.168.10.13') && net.ping(n, 'PC2', '192.168.20.14') && isolated(n),
      solve: n => { for (const id of ['SW1', 'SW2']) n.update(id, d => trunk(d, 'g0/3', [10, 20])); },
      quiz: { question: 'PC2からPC4へpingし、Debuggerの「Hop」表示を見ます。SW1 g0/3 からSW2へ送られたEcho Requestの「VLAN」欄はどれですか？', options: ['—（タグなし）', '1', '20'], answer: 2, explanation: 'トランクでは、フレームに802.1Qタグ（VID）を付けて、どのVLANのものかを区別します。PC2のポートは VLAN 20 なので、SW1はトランクへ出すときに VID=20 のタグを付けます。PCとの間（アクセスポート）ではタグを付けないので、PC2 eth0 と SW2 g0/2 の行は「—」です。' } },
    { title: '別のVLANへのpingが止まる場所を調べる',
      body: 'SEND バーで PC1 → `192.168.20.12`（開発部のPC2）に ping を送り、Debuggerでどこまで進んだかを確かめます（Theory「VLANの間をつなぐ：VLAN間ルーティング」）。',
      quiz: { question: 'PC1からPC2（192.168.20.12）へのpingが失敗した理由として、Debuggerから読み取れるものはどれですか？', options: ['PC1がゲートウェイ 192.168.10.1 のMACアドレスをARPで調べたが、返事がなかった', 'PC1のARP RequestはPC2に届いたが、PC2が返事をしなかった', 'SW1が、PC2宛てのフレームを VLAN 10 のポートへ送ってしまった'], answer: 0, explanation: 'PC2は別のサブネットなので、PC1はゲートウェイ（192.168.10.1）に渡そうとして、そのMACアドレスをARPで調べます。まだルータがいないので、誰も答えません。VLANが違う相手へは、ルータに中継してもらう必要があります。' } },
    { title: 'ルータR1を置き、SW1とトランクでつなぐ',
      body: 'VLAN間を中継するルータを置きます（Theory「Router on a Stick」）。\n\n1. 左の DEVICES パレットで Router をクリック（または構成図へドラッグ）。名前は自動で **R1** になります\n2. R1の g0/0 から、SW1の空いているポート（例: g0/8）へドラッグして配線\n3. SW1の、R1につないだポートをトランク（許可VLAN `10,20`）にする\n\n- GUI: SW1の「インターフェース」で g0/8 をモード trunk、許可VLAN `10,20`\n- CLI: SW1で `configure terminal` → `interface g0/8` → `switchport mode trunk` → `switchport trunk allowed vlan 10,20`\n\nR1のサブインターフェースはタグ付きのフレームを受け取るので、アクセスポートのままでは話が通じません。',
      hints: ['ルータの名前が R1 以外（R2 など）になったときは、余分なルータを削除してから置き直します。', 'SW1で show interfaces trunk を実行し、R1につないだポートが trunking と表示されれば完了です。'],
      check: n => net.has(n, 'R1', 'router') && carries(sp(n, 'SW1', 'R1'), 10, 20),
      solve: n => {
        n.addDevice(createDevice('R1', 'router', 7, { x: 240, y: 60 }));
        n.connect({ id: 'link-6', sourceDevice: 'SW1', sourceInterface: 'g0/8', targetDevice: 'R1', targetInterface: 'g0/0', up: true, bandwidth: 1000, latency: 1 });
        n.update('SW1', d => trunk(d, 'g0/8', [10, 20]));
      } },
    { title: 'R1にサブインターフェースを作り、VLAN間をつなぐ',
      body: 'R1の g0/0 を、VLANごとのサブインターフェースに分け、それぞれにゲートウェイのアドレスを付けます（Theory「Router on a Stick」）。SW1につないだのが g0/0 以外なら、そのポート名に読み替えます。\n\n- GUI: R1の「インターフェース」の下の追加欄で「サブインターフェース」を選び、VLAN ID `10`・親ポート `g0/0` で「追加」。できた g0/0.10 に `192.168.10.1/24` を入れて適用（g0/0.20 と `192.168.20.1/24` も同じ）\n- CLI: R1のTerminalで\n\n```text\nenable\nconfigure terminal\ninterface g0/0.10\nencapsulation dot1q 10\nip address 192.168.10.1 255.255.255.0\nexit\ninterface g0/0.20\nencapsulation dot1q 20\nip address 192.168.20.1 255.255.255.0\nend\nshow ip route\n```\n\n`show ip route` に `C 192.168.10.0/24 … g0/0.10` と `C 192.168.20.0/24 … g0/0.20` が並び、PC1 → `192.168.20.12`、PC4 → `192.168.10.13` のpingが通れば完了です。',
      hints: ['まずPC1から ping 192.168.10.1（自分のゲートウェイ）を試します。届かなければ、SW1のR1側のポートがトランクか、サブインターフェースの VLAN ID（encapsulation dot1q）が正しいかを見直します。'],
      check: n => {
        const parent = net.port(n, 'R1', 'SW1');
        const sub = (vlan: number, cidr: string) => n.device('R1').interfaces.some(i => i.kind === 'subinterface' && i.parent === parent && i.vlan === vlan && i.address === cidr);
        return sub(10, '192.168.10.1/24') && sub(20, '192.168.20.1/24') && net.ping(n, 'PC1', '192.168.20.12') && net.ping(n, 'PC4', '192.168.10.13');
      },
      solve: n => n.update('R1', d => { subinterface(d, 'g0/0', 10, '192.168.10.1/24'); subinterface(d, 'g0/0', 20, '192.168.20.1/24'); }) },
    { title: 'VLAN間の通り道を、Hop表示で確かめる',
      body: 'SEND バーで PC1 → `192.168.20.12` に ping を送り、Debuggerの「Hop」表示で、ケーブル1本ごとにMACアドレス・VLAN・TTLがどう変わるかを読みます（Theory「PC1からPC2へ：1区間ずつ見る」）。色付きのセルが、1つ前の区間から変わった値です。\n\nPC1のTerminalで `traceroute 192.168.20.12` も実行してみましょう。1行目にゲートウェイ 192.168.10.1 が出ます。',
      quiz: { question: 'Hop表示で、R1 g0/0 からSW1へ送り返されたEcho Requestの行について、正しいものはどれですか？', options: ['VLANは20、送信元MACはR1、宛先MACはPC2、TTLは63', 'VLANは10のまま、送信元MACはPC1、TTLは64', 'VLANは20で、送信元IPがR1の 192.168.20.1 に書き換わっている'], answer: 0, explanation: 'R1はタグ10のフレームを g0/0.10 で受け取り、宛先 192.168.20.12 が g0/0.20 の Connected だとわかると、MACアドレスを付け替え（送信元R1・宛先PC2）、タグ20を付けて、同じケーブルでSW1へ送り返します。ルータを通ったのでTTLは1減って63。IPアドレスは変わりません。' } },
    { title: 'SW1とSW2の間に、2本目のケーブルをつなぐ',
      body: '1本目が切れても1階と2階が通じるように、予備のケーブルを足します（Theory「ケーブルを二重にするとループになる：STP」）。\n\n1. 構成図で、SW1の空いているポート（例: g0/4）からSW2の空いているポート（例: g0/4）へドラッグして配線\n2. 両端のポートを、1本目と同じトランク（許可VLAN `10,20`）にする（CLI: `interface g0/4` → `switchport mode trunk` → `switchport trunk allowed vlan 10,20`）\n\nつないだら、SW2のTerminalで `show spanning-tree` を実行します。',
      hints: ['2本目もトランクにしないと、予備の道として VLAN 10・20 を運べません。'],
      check: n => { const ls = uplinks(n); return ls.length >= 2 && ls.every(l => port(n, l.sourceDevice, l.sourceInterface)?.switchport?.mode === 'trunk' && port(n, l.targetDevice, l.targetInterface)?.switchport?.mode === 'trunk') && net.ping(n, 'PC1', '192.168.10.13') && net.ping(n, 'PC2', '192.168.20.14'); },
      solve: n => {
        n.connect({ id: 'link-7', sourceDevice: 'SW1', sourceInterface: 'g0/4', targetDevice: 'SW2', targetInterface: 'g0/4', up: true, bandwidth: 1000, latency: 1 });
        for (const id of ['SW1', 'SW2']) n.update(id, d => trunk(d, 'g0/4', [10, 20]));
      },
      quiz: { question: 'SW2の show spanning-tree で、SW1につながる2本のポートはどうなっていますか？', options: ['1本は Root FWD、もう1本は Altn BLK（ブロック）で、フレームを運ぶのは1本だけ', '2本とも FWD で、2倍の速さで使える', '2本とも BLK で、SW1とSW2の間は通信できない'], answer: 0, explanation: 'Root Bridgeは、Bridge IDの小さいSW1です（プライオリティが同じ32768なので、MACアドレスで比べます）。SW2は根へのポートを1つだけ Root Port にし、もう1本を Alternate Port としてブロックしてループを切ります。2本目は、1本目が切れたときの予備として待機しています。' } },
    { title: '2本のケーブルを、LACPで1本に束ねる',
      body: 'ブロックされている2本目も使えるように、2本をLACPで束ねて1本の Port-channel（po1）にします（Theory「2本のケーブルを1本として使う：Link Aggregation」）。SW1とSW2の両方で設定します。\n\n- GUI: スイッチを選び、「Link Aggregation（LAG / LACP）」の欄でグループ `1`・モード active を選び、スイッチ間の2本のポートにチェックして「選んだポートを束ねる」\n- CLI: 各スイッチで\n\n```text\nconfigure terminal\ninterface range g0/3-4\nchannel-group 1 mode active\nend\nshow etherchannel summary\nshow interfaces trunk\n```\n\n`show etherchannel summary` が `po1(SU) LACP g0/3(P) g0/4(P)` になり、`show interfaces trunk` で po1 が 10,20 を運んでいれば完了です。po1 がトランクになっていなければ、`interface po1` → `switchport mode trunk` → `switchport trunk allowed vlan 10,20` を設定します。',
      hints: ['片方のスイッチだけ束ねても、相手が応えないのでメンバーは使われません。両方で設定します。', 'show etherchannel summary でメンバーが (s) なら suspended です。下に理由が表示されます。'],
      check: n => bundled(n, 'SW1') && bundled(n, 'SW2') && net.ping(n, 'PC1', '192.168.10.13') && net.ping(n, 'PC2', '192.168.20.14') && net.ping(n, 'PC1', '192.168.20.12') && isolated(n),
      solve: n => { for (const id of ['SW1', 'SW2']) n.update(id, d => lag(d, 1, 'active', 'g0/3', 'g0/4')); },
      quiz: { question: 'SW2でもう一度 show spanning-tree を実行します。SW1へつながるポートは、どう表示されますか？', options: ['po1 の1行だけ（Root FWD）。STPからは、束ねた1本に見える', 'g0/3 が Root FWD、g0/4 が Altn BLK のまま', 'g0/3・g0/4・po1 の3行が、すべて FWD'], answer: 0, explanation: 'STPから見えるのは、束ねた論理ポート po1 の1本だけです。輪に見えないのでブロックされず、2本のメンバーがどちらも使われます。ただし1つのフロー（1本のTCP接続など）が通るのは、ハッシュで選ばれたメンバー1本だけです。' } },
  ],
  debrief: 'スイッチは送信元MACで学習し、VLANでブロードキャストドメインを分け、トランクのタグで複数のVLANを1本で運ぶ。VLANの間はルータ（またはL3スイッチ）が中継し、二重にしたケーブルはSTPがループを防ぎ、LACPで束ねれば両方を使える——これが、オフィスのLANの基本形です。',
});
