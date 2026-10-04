import type { NetworkSimulator } from '../../simulator/core/NetworkSimulator';
import { parseRule } from '../../simulator/services/FirewallEngine';
import { build, ssh, web } from '../../simulator/scenarios/build';
import { net, networkSimulation } from '../simulation';

const fw = (n: NetworkSimulator) => n.device('FW').firewall!;
const nat = (n: NetworkSimulator, toward: string) => n.device('FW').interfaces.find(i => i.id === net.port(n, 'FW', toward))?.nat;
const rule = (n: NetworkSimulator, seq: number, text: string) => n.update('FW', d => { d.firewall!.rules = [...d.firewall!.rules.filter(r => r.seq !== seq), parseRule(seq, text.split(' '))].sort((a, b) => a.seq - b.seq); });
/** NAT steps are judged with the filter opened up, so the later default deny does not undo them (the Firewall steps judge the filter). */
const open = (n: NetworkSimulator) => { n.update('FW', d => { d.firewall!.defaultAction = 'permit'; d.firewall!.rules = []; }); return n; };
const http = (n: NetworkSimulator, from: string, url: string) => n.http(from, url);
/** Every packet on the FW–ISP cable carries the global address 203.0.113.2 (no private address leaks out). */
const globalOnly = (n: NetworkSimulator, r: { captures: { linkId?: string; source: string; destination: string; protocol: string }[] }) => {
  const link = net.link(n, 'FW', 'ISP')?.id;
  const seen = r.captures.filter(c => c.linkId === link && c.protocol === 'TCP');
  return seen.length > 0 && seen.every(c => c.source === '203.0.113.2' || c.destination === '203.0.113.2');
};
/** Dropped by the Firewall: no answer at all (a closed port would answer with RST = refused). */
const dropped = (n: NetworkSimulator, from: string, to: string, port: number) => { const r = n.tcpConnect(from, to, port); return !r.success && !r.refused; };
/** The policy every Firewall step keeps: stateful, default deny, and the server network can never start a connection into the office LAN. */
const policy = (n: NetworkSimulator) => fw(n).stateful && fw(n).defaultAction === 'deny' && !net.ping(n, 'SRV', '192.168.1.10') && dropped(n, 'SRV', '192.168.1.10', 445);

/** Chapter 6: an office behind FW (PAT out, one port forwarded in), then a stateful default-deny policy. */
export const natFirewallSimulation = networkSimulation({
  id: 'sim-nat-firewall', chapter: 'nat-firewall', minutes: 40,
  title: 'オフィスの出入り口に、NATとファイアウォールを組み立てる',
  mission: 'FWにPATとポートフォワードを設定して社内PCとSRVをインターネットにつなぎ、ステートフル・default denyのルールで「必要な通信だけ」を通す',
  brief: [
    'Theoryで使った「例のネットワーク」です。配線と、PC・サーバー・ISPのアドレスは設定済みです。境界の機器FWには、アドレスとDefault Route（ISPへ）だけが入っています。',
    '```text\n           社内LAN 192.168.1.0/24\nPC1 .10 ─┐\n          SW1 ── g0/1 [ FW ] g0/0 ────────── [ ISP ] ── SW2 ─┬─ WEB 198.51.100.80\nPC2 .11 ─┘   192.168.1.1  │  203.0.113.2/30   203.0.113.1      └─ EXT 198.51.100.50\n                         g0/2 192.168.2.1\n                          │  サーバー用LAN（DMZ） 192.168.2.0/24\n                         SRV 192.168.2.80（自社のWebサーバー：80番 / SSH 22番）\n```',
    'FWのファイアウォールは、前半はNATに集中するため「何も止めない」設定（default permit）にしてあります。Theoryの流れに沿って、①プライベートアドレスのままでは返事が戻らないことを確かめる → ②inside / outside → ③PAT → ④ポートフォワード → ⑤default deny → ⑥必要な許可ルール、の順に組み立てます。',
  ].join('\n\n'),
  source: 'PC1', target: '198.51.100.80',
  build: () => build([
    { id: 'PC1', kind: 'pc', at: [0, 40], ip: { eth0: '192.168.1.10/24' }, gw: '192.168.1.1' },
    { id: 'PC2', kind: 'pc', at: [0, 240], ip: { eth0: '192.168.1.11/24' }, gw: '192.168.1.1' },
    { id: 'SW1', kind: 'switch', at: [200, 140] },
    { id: 'FW', kind: 'firewall', at: [420, 140], ip: { 'g0/0': '203.0.113.2/30', 'g0/1': '192.168.1.1/24', 'g0/2': '192.168.2.1/24' }, routes: [['0.0.0.0/0', '203.0.113.1']],
      set: d => { d.firewall!.defaultAction = 'permit'; d.interfaces[0].description = 'outside'; d.interfaces[1].description = 'office-lan'; d.interfaces[2].description = 'dmz'; } },
    { id: 'SRV', kind: 'server', at: [420, 360], ip: { eth0: '192.168.2.80/24' }, gw: '192.168.2.1', set: d => { d.services = [web('nginx', '<h1>PATH Shop</h1>'), ssh()]; } },
    { id: 'ISP', kind: 'internet', at: [660, 140], ip: { 'g0/0': '203.0.113.1/30', 'g0/1': '198.51.100.1/24' } },
    { id: 'SW2', kind: 'switch', at: [860, 140] },
    { id: 'WEB', kind: 'server', at: [1060, 40], ip: { eth0: '198.51.100.80/24' }, gw: '198.51.100.1', set: d => { d.services = [web('nginx', '<h1>www.example.com</h1>')]; } },
    { id: 'EXT', kind: 'pc', at: [1060, 240], ip: { eth0: '198.51.100.50/24' }, gw: '198.51.100.1' },
  ], [['PC1', 'eth0', 'SW1', 'g0/1'], ['PC2', 'eth0', 'SW1', 'g0/2'], ['SW1', 'g0/8', 'FW', 'g0/1'], ['FW', 'g0/2', 'SRV', 'eth0'], ['FW', 'g0/0', 'ISP', 'g0/0'],
    ['ISP', 'g0/1', 'SW2', 'g0/8'], ['SW2', 'g0/1', 'WEB', 'eth0'], ['SW2', 'g0/2', 'EXT', 'eth0']]),
  sim: [
    { title: 'プライベートアドレスのまま外へ出て、止まる場所を調べる',
      body: 'まだNATはありません。PC1のTerminalで WEB のページを取りに行きます。\n\n```text\ncurl http://198.51.100.80/\n```\n\n失敗するはずです。右の「Debugger」でイベントを1つずつ進め、SYN（接続の申し込み）とSYN-ACK（その返事）がそれぞれどこまで進んだかを確かめましょう。Theoryの「プライベートアドレスでは、返事が戻ってこない」の実験です。',
      hints: ['SYNの送信元アドレスが、ISPを通るときに何になっているかを見ます。', 'ISPの経路表（ISPを選んで show ip route）に 192.168.1.0/24 はありますか？'],
      quiz: { question: 'curlが失敗した理由として、Debuggerから読み取れるものはどれですか？', options: ['SYNがFWで破棄された', 'SYNはWEBに届いたが、WEBが返したSYN-ACK（宛先 192.168.1.10）をISPが届け先の経路を知らずに捨てた', 'WEBが80番で待ち受けていない'], answer: 1, explanation: '行きは宛先 198.51.100.80 への経路があるので届きます。ところが返事の宛先はプライベートアドレス 192.168.1.10 で、インターネット側（ISP）はそこへの経路を持ちません。送信元のまま外へ出ると、返事が迷子になるのです。' } },
    { title: 'FWのインターフェースに、inside と outside を設定する',
      body: 'NATは「insideのインターフェースから入って、outsideのインターフェースから出る」パケット（とその返事）だけを書き換えます。社内LAN側の g0/1 とサーバー用LAN側の g0/2 を **inside**、ISP側の g0/0 を **outside** にします。\n\n- GUI: FWを選び、「機器設定」のインターフェース欄で、各ポートの「NAT」を inside / outside に\n- CLI: FWのTerminalで\n\n```text\nenable\nconfigure terminal\ninterface g0/1\nip nat inside\nexit\ninterface g0/2\nip nat inside\nexit\ninterface g0/0\nip nat outside\nend\n```\n\n`show running-config` で、各インターフェースの下に `ip nat inside` / `ip nat outside` が出ていれば完了です。これだけではまだ何も書き換わりません（変換のルールがないため）。',
      hints: ['inside は「守る側・プライベートアドレスの側」、outside は「インターネットの側」です。', 'g0/2（SRVの側）も inside です。ポートフォワードの返事を書き換えるのに必要になります。'],
      check: n => nat(n, 'SW1') === 'inside' && nat(n, 'SRV') === 'inside' && nat(n, 'ISP') === 'outside',
      solve: n => n.update('FW', d => { for (const i of d.interfaces) i.nat = i.id === 'g0/0' ? 'outside' : 'inside'; }) },
    { title: 'PATを設定して、社内PCをインターネットへ出す',
      body: '「192.168.1.0/24 から来た通信は、g0/0 のアドレス（203.0.113.2）に送信元を書き換え、ポート番号で見分ける」——これがPAT（Ciscoでは overload）です。\n\n- GUI: FWの「NAT」欄で種別「PAT（overload）」、内側CIDR `192.168.1.0/24`、出口インターフェース `g0/0` を追加\n- CLI:\n\n```text\nconfigure terminal\nip nat inside source 192.168.1.0/24 interface g0/0 overload\nend\n```\n\nPC1とPC2の両方で `curl http://198.51.100.80/` を実行し、`<h1>www.example.com</h1>` が返れば成功です。ISPにプライベートアドレスへの経路を足すのは不正解です（インターネットでは使えない方法です）。',
      hints: ['実機では対象をACLで指定しますが、このシミュレータでは CIDR を直接書きます。', 'うまくいかないときは、FWで show ip nat translations が空かどうかを見ます。空なら inside / outside の設定を確認します。'],
      check: n => { open(n); const r = http(n, 'PC1', 'http://198.51.100.80/'); return r.success && globalOnly(n, r) && http(n, 'PC2', 'http://198.51.100.80/').success && !n.table('ISP').some(x => x.destination.startsWith('192.168.')); },
      solve: n => n.update('FW', d => { d.nat = [{ id: 'pat-lan', type: 'pat', source: '192.168.1.0/24', outInterface: 'g0/0' }]; }) },
    { title: 'NATテーブルを読む',
      body: 'PC1とPC2から `curl http://198.51.100.80/` を実行した直後に、FWのTerminalで次を実行します（右の「状態」タブでも見られます）。\n\n```text\nshow ip nat translations\n```\n\n1行が1つの通信の「控え」です。**Inside local** が書き換える前の送信元（PCのアドレス:ポート）、**Inside global** が書き換えた後の送信元、**Outside global** が通信相手です。PC1の行とPC2の行を見比べましょう。',
      quiz: { question: 'PC1の行とPC2の行で、Inside global はどうなっていましたか？', options: ['どちらも 203.0.113.2。行どうしはポート番号で見分けている', 'PC1は 203.0.113.2、PC2は別のグローバルアドレス', 'PCのアドレス（192.168.1.x）のまま'], answer: 0, explanation: 'PATでは、全員が同じグローバルアドレス 203.0.113.2 を共有します。返事はどれも宛先 203.0.113.2 で戻ってくるので、FWはInside globalのポート番号でNATテーブルの行を探し、どのPCに戻すかを決めます。' } },
    { title: 'ポートフォワードで、SRVのWebを公開する',
      body: '外の利用者（EXT）が `http://203.0.113.2:8080/` にアクセスしたら、SRV（192.168.2.80）の80番に届ける——宛先を書き換えるポートフォワードを設定します。SRVを丸ごと対応させる静的NAT（1対1）は使いません（SSHの22番まで外から見えてしまうため）。\n\n- GUI: FWの「NAT」欄で種別「ポートフォワード（TCP）」、内側IP `192.168.2.80`、外側IP `203.0.113.2`、内側port `80`、外側port `8080`\n- CLI:\n\n```text\nconfigure terminal\nip nat inside source static tcp 192.168.2.80 80 interface g0/0 8080\nend\n```\n\nEXTのTerminalで `curl http://203.0.113.2:8080/` を実行し、`<h1>PATH Shop</h1>` が返れば成功です。',
      hints: ['書式は ip nat inside source static tcp <内側IP> <内側ポート> interface <外側のポート> <外側ポート> です。', 'g0/2 が inside になっていないと、SRVからの返事の送信元が書き換わりません（ステップ2）。'],
      check: n => { open(n); const r = http(n, 'EXT', 'http://203.0.113.2:8080/'); const rules = n.device('FW').nat ?? [];
        return (r.body ?? '').includes('PATH Shop') && globalOnly(n, r) && !rules.some(x => x.type === 'static') && rules.filter(x => x.type === 'port-forward').length === 1 && !n.tcpConnect('EXT', '203.0.113.2', 22).success; },
      solve: n => n.update('FW', d => { d.nat!.push({ id: 'pf-srv', type: 'port-forward', protocol: 'tcp', inside: '192.168.2.80', insidePort: 80, outside: '203.0.113.2', outsidePort: 8080 }); }) },
    { title: '返事の書き換えを、Debuggerで確かめる',
      body: 'EXTから `curl http://203.0.113.2:8080/` をもう一度実行し、Debuggerで **SRVが返したSYN-ACK** を追いかけます。SRVを出たときの送信元は 192.168.2.80:80 です。FWを通って ISP へ出ていくときに、どう変わったでしょうか。Theoryの「行きと帰りの書き換え」を、1ホップずつ確かめましょう。\n\nあわせて `show ip nat translations` で、Outside global が EXT（198.51.100.50）の行を探してみましょう。',
      quiz: { question: 'SYN-ACKがFWからISPへ出ていくとき、送信元はどうなっていましたか？', options: ['192.168.2.80:80 のまま', '203.0.113.2:8080 に書き換えられていた', '203.0.113.2:80 に書き換えられていた'], answer: 1, explanation: 'EXTは 203.0.113.2:8080 に接続したので、返事も 203.0.113.2:8080 から来なければ自分の通信の返事だとわかりません。FWはNATテーブルの行を使い、行きで書き換えた宛先を、帰りでは送信元として元に戻します。' } },
    { title: 'FWの既定の動作を deny にする',
      body: 'ここからはファイアウォールです。まず「どのルールにも一致しなかったら拒否」（default deny＝暗黙の拒否）にします。\n\n- GUI: FWの「Firewall ポリシー」で「既定の動作」を deny に（モードは stateful のまま）\n- CLI:\n\n```text\nconfigure terminal\nfirewall default deny\nend\n```\n\nルールはまだ1つもないので、**すべての通信が止まります**。PC1から `curl http://198.51.100.80/` を試し、Debuggerで何がSYNを止めたかを見ましょう。\n\n> 実機をリモートで操作しているときにこれをすると、自分の管理用の接続まで切れます。現場では、必要な許可ルールを先に入れてから既定を切り替えます。ここでは「暗黙の拒否」を体験するために、あえて先に切り替えています。',
      check: n => fw(n).defaultAction === 'deny' && fw(n).stateful,
      solve: n => n.update('FW', d => { d.firewall!.defaultAction = 'deny'; }),
      quiz: { question: 'PC1のSYNを止めたのは、FWの何でしたか？', options: ['ルール1番の deny', 'デフォルトポリシー（どのルールにも一致しなかった）', 'NATテーブルに行がなかったこと'], answer: 1, explanation: 'ルールが1つもないので、どのパケットもどのルールにも一致せず、最後の「既定の動作」= deny で破棄されます。これが暗黙の拒否です。許可したいものは、ルールとして書かなければ通りません。' } },
    { title: '社内からインターネットへの通信を許可する',
      body: '「社内LAN（192.168.1.0/24）から始まる通信は、どこへでも許可」というルールを入れます。番号は30にします（前に別のルールを差し込めるよう、間をあけておきます）。\n\n- GUI: 「Firewall ポリシー」の欄で、seq `30`、ルール `permit ip 192.168.1.0/24 any` を追加\n- CLI:\n\n```text\nconfigure terminal\nfirewall rule 30 permit ip 192.168.1.0/24 any\nend\n```\n\nPC1・PC2から WEB のページが見えれば成功です。戻りのSYN-ACK用のルールは書いていません。それでも通る理由は、次のステップで確かめます。\n\n`permit ip any any` のような「全部許可」は不正解です。SRV（サーバー用LAN）から社内LANへの通信は、拒否されたままにします。',
      hints: ['送信元を社内LANの範囲に限定します。宛先は any です。', 'FWで show firewall を実行すると、モード・既定の動作・ルールの一覧が見られます。'],
      check: n => policy(n) && http(n, 'PC1', 'http://198.51.100.80/').success && http(n, 'PC2', 'http://198.51.100.80/').success,
      solve: n => rule(n, 30, 'permit ip 192.168.1.0/24 any') },
    { title: 'ステートレスに切り替えて、戻りのパケットを観察する',
      body: 'まずFWで `show conntrack` を実行します。PC1の通信が `src=192.168.1.10:… dst=198.51.100.80:80` の1行として記録されています。ステートフルなFWは、この記録（接続追跡）に一致する返事を、ルールを見ずに通します。\n\n次に、記録を使わない **ステートレス** に切り替えて、同じ通信を試します。\n\n- GUI: 「Firewall ポリシー」の「モード」を stateless に\n- CLI:\n\n```text\nconfigure terminal\nfirewall mode stateless\nend\n```\n\nPC1から `curl http://198.51.100.80/` を実行し、Debuggerで WEB → PC1 のSYN-ACKがFWでどう扱われたかを見ます。**見終わったら必ず元に戻します**（`firewall mode stateful`）。戻さないと、前のステップの判定が失敗に戻ります。',
      quiz: { question: 'ステートレスのとき、WEBからPC1へのSYN-ACKはFWでどうなりましたか？', options: ['接続追跡（conntrack）の記録に一致して許可された', 'どのルールにも一致せず、デフォルトポリシーで破棄された', 'ルール30に一致して許可された'], answer: 1, explanation: 'SYN-ACKの送信元は 198.51.100.80 なので、「送信元が192.168.1.0/24」のルール30には一致しません。ステートレスでは過去の通信を覚えていないため、返事にも許可ルールが必要です。ステートフルなら、接続追跡の記録（ESTABLISHED）で自動的に通ります。' } },
    { title: '公開Webへの通信を、変換後の宛先で許可する',
      body: 'ポートフォワードは設定済みですが、default deny なので EXT からの `http://203.0.113.2:8080/` は止まっています。FWは **DNAT（宛先の書き換え）の後** にルールを評価するので、ルールの宛先は書き換えた後の `192.168.2.80` の `80`番で書きます。\n\n- GUI: 「Firewall ポリシー」の欄で、seq `10`、ルール `permit tcp any host 192.168.2.80 eq 80` を追加\n- CLI:\n\n```text\nconfigure terminal\nfirewall rule 10 permit tcp any host 192.168.2.80 eq 80\nend\n```\n\nEXTから `curl http://203.0.113.2:8080/` が成功すれば完了です。`permit tcp any host 203.0.113.2 eq 8080` と書くと一致しません（Debuggerで、FWが見ている宛先を確かめてみましょう）。',
      hints: ['DebuggerでFWのイベントを見ると、NAT_TRANSLATED（宛先の書き換え）の後にFIREWALLの判定が来ています。', '送信元は any（インターネットの誰でも）、宛先は host 192.168.2.80、ポートは eq 80 です。'],
      check: n => policy(n) && (http(n, 'EXT', 'http://203.0.113.2:8080/').body ?? '').includes('PATH Shop'),
      solve: n => rule(n, 10, 'permit tcp any host 192.168.2.80 eq 80') },
    { title: '社内からサーバー用LANへは、Webだけに絞る',
      body: 'いまのルール30（社内 → どこへでも）は、社内からSRVのSSH（22番）まで許可しています。PC1で `nc -zv 192.168.2.80 22` を実行すると、つながってしまうはずです。社内からサーバー用LANへは、Web（80番）だけにしましょう。\n\nルールは **番号の小さい順に評価し、最初に一致したもので決まる** ので、拒否をルール30より前（20番）に入れます。Web（80番）はルール10が先に許可するので、止まりません。\n\n- GUI: 「Firewall ポリシー」の欄で、seq `20`、ルール `deny ip 192.168.1.0/24 192.168.2.0/24` を追加\n- CLI:\n\n```text\nconfigure terminal\nfirewall rule 20 deny ip 192.168.1.0/24 192.168.2.0/24\nend\n```\n\n`show firewall` でルールが 10 → 20 → 30 の順に並んでいることを確かめ、PC1から `nc -zv 192.168.2.80 22` が失敗し、`curl http://192.168.2.80/` が成功すれば完了です。',
      hints: ['拒否ルールの番号を10より小さくすると、Webまで止まります。', '別解: ルール30を `permit ip 192.168.1.0/24 any out g0/0`（出口がISP側のときだけ許可）に置き換えても、同じ結果になります。'],
      check: n => policy(n) && dropped(n, 'PC1', '192.168.2.80', 22) && http(n, 'PC1', 'http://192.168.2.80/').success && http(n, 'PC1', 'http://198.51.100.80/').success && (http(n, 'EXT', 'http://203.0.113.2:8080/').body ?? '').includes('PATH Shop'),
      solve: n => rule(n, 20, 'deny ip 192.168.1.0/24 192.168.2.0/24') },
  ],
  debrief: '送信元を書き換えて外へ出す（PAT）、決めたポートだけ宛先を書き換えて中へ入れる（ポートフォワード）、そして「どのルールにも一致しなければ拒否」の上に、必要な通信だけを上から順に許可する——これがオフィスの出入り口の基本形です。NATは書き換えの仕組み、通すかどうかを決めるのはファイアウォール、という分担を忘れないでください。',
});
