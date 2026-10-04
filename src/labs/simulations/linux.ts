import { CliEngine } from '../../cli/CliEngine';
import type { NetworkSimulator } from '../../simulator/core/NetworkSimulator';
import { build, dnsService, https, ssh, web } from '../../simulator/scenarios/build';
import { resolveRoute } from '../../simulator/l3/RoutingTable';
import { net, networkSimulation } from '../simulation';

/** Run the step's commands in the Terminal, as the learner would (a rejected command fails the solve loudly). */
const sh = (n: NetworkSimulator, id: string, ...commands: string[]) => {
  const cli = new CliEngine(n);
  for (const c of commands) { const out = cli.execute(id, c); if (out.startsWith('%')) throw new Error(`${id}$ ${c}\n${out}`); }
};
const WEB = '192.168.2.80';

/** Chapter 7: a new Linux web server, made reachable one layer of the troubleshooting ladder at a time. */
export const linuxSimulation = networkSimulation({
  id: 'sim-linux', chapter: 'linux', minutes: 40,
  title: '新しいWebサーバーを、はしごの下の段から順に使える状態にする',
  mission: 'PC1から http://www.example.com/ と https://www.example.com/ が開けるように、NIC → IP → ARP → 経路 → DNS → TCP（待ち受け・Firewall）→ TLS → アプリ の順に1段ずつ整える',
  brief: [
    '社内LANのPC1から、サーバー用ネットワークに置いた新しいLinuxサーバー **WEB** のページを開けるようにします。配線とPC1・NS1・R1の設定は済んでいます。WEBは、設置したばかりで何も設定されていません。',
    '```text\n        社内LAN 192.168.1.0/24                  サーバー用 192.168.2.0/24\nPC1 192.168.1.10 ──┐\n                   SW1 ── R1 ──────────────── WEB 192.168.2.80（予定）\nNS1 192.168.1.53 ──┘   g0/0 192.168.1.1  g0/1 192.168.2.1\n（DNSサーバー: example.com を管理）\n```',
    'Theoryの「切り分けのはしご」を、下の段から1段ずつ「正常」にしていきます。各段で、Theoryで読んだコマンドを実行し、出力のどこが変わるかを確かめましょう。WEBのTerminalは、構成図でWEBを選んで開きます。',
  ].join('\n\n'),
  source: 'PC1', target: WEB,
  build: () => build([
    { id: 'PC1', kind: 'pc', at: [0, 40], ip: { eth0: '192.168.1.10/24' }, gw: '192.168.1.1' },
    { id: 'NS1', kind: 'server', at: [0, 260], ip: { eth0: '192.168.1.53/24' }, gw: '192.168.1.1', set: d => {
      d.services = [dnsService()];
      d.dnsServer = { recursive: true, rootHints: [], allowRecursion: ['192.168.1.0/24', '192.168.2.0/24'], zones: [{ origin: 'example.com.', records: [
        { name: 'example.com.', type: 'SOA', ttl: 3600, value: 'ns1.example.com. hostmaster.example.com. 2026100101 7200 3600 1209600 300' },
        { name: 'example.com.', type: 'NS', ttl: 86400, value: 'ns1.example.com.' },
        { name: 'ns1.example.com.', type: 'A', ttl: 86400, value: '192.168.1.53' },
      ] }] };
    } },
    { id: 'SW1', kind: 'switch', at: [220, 150] },
    { id: 'R1', kind: 'router', at: [440, 150], ip: { 'g0/0': '192.168.1.1/24', 'g0/1': '192.168.2.1/24' } },
    { id: 'WEB', kind: 'server', at: [700, 150], set: d => {
      d.interfaces[0].up = false;
      d.services = [{ ...web('nginx', '<h1>www.example.com</h1>'), running: false }, ssh(),
        { name: 'app', protocol: 'tcp', port: 8080, app: 'http', running: true, bind: '127.0.0.1', http: { status: 200, body: '<h1>app</h1>' } }];
    } },
  ], [['PC1', 'eth0', 'SW1', 'g0/1'], ['NS1', 'eth0', 'SW1', 'g0/2'], ['SW1', 'g0/8', 'R1', 'g0/0'], ['R1', 'g0/1', 'WEB', 'eth0']]),
  sim: [
    { title: 'WEBのeth0を有効にする',
      body: 'はしごの1段目（NIC）です。WEBのTerminalで `ip link` を実行すると、eth0 は `<BROADCAST,MULTICAST>`・`state DOWN` で、`UP` がありません。設定で無効にされている状態です。\n\n- GUI: WEBを選び、右の「機器設定」→ インターフェース → eth0 のスイッチをオンにする\n- CLI: WEBのTerminalで\n\n```text\nip link set eth0 up\nip link\n```\n\n`<BROADCAST,MULTICAST,UP,LOWER_UP>` と `state UP` が見えれば、有効になり、ケーブルの先（R1）ともつながっています。',
      hints: ['`UP` は「設定で有効にした」、`LOWER_UP` は「ケーブルの先とつながっている」という意味です。両方そろって正常です。'],
      check: n => { const p = net.port(n, 'WEB', 'R1'); return !!p && n.device('WEB').interfaces.some(i => i.id === p && i.up); },
      solve: n => sh(n, 'WEB', 'ip link set eth0 up'),
      quiz: { question: '有効にする前の `ip link` で、eth0 の `< >` の中になかったものはどれですか？', options: ['UP と LOWER_UP', 'BROADCAST と MULTICAST', 'NO-CARRIER'], answer: 0, explanation: '無効（down）のインターフェースには、管理者が有効にしたことを表す UP も、ケーブルの先とつながっていることを表す LOWER_UP も付きません。有効にしたのにケーブルがつながっていなければ、NO-CARRIER と表示されます。' } },
    { title: 'WEBにIPアドレスを付ける',
      body: 'はしごの2段目（IP）です。`ip addr` を実行すると、eth0 に `inet` の行がありません。サーバー用ネットワーク 192.168.2.0/24 の中の `192.168.2.80/24` を付けます。\n\n- GUI: WEB → インターフェース → eth0 の「IPv4アドレス / プレフィックス長」に `192.168.2.80/24` を入れて適用\n- CLI:\n\n```text\nip addr add 192.168.2.80/24 dev eth0\nip addr\n```\n\n`inet 192.168.2.80/24 brd 192.168.2.255 scope global eth0` の行が出れば完了です。',
      hints: ['プレフィックス長（/24）を忘れずに付けます。Gateway（R1）の 192.168.2.1 と同じネットワークになるかを確かめましょう。'],
      check: n => net.address(n, 'WEB', 'R1') === `${WEB}/24`,
      solve: n => sh(n, 'WEB', `ip addr add ${WEB}/24 dev eth0`) },
    { title: 'Gatewayに届くか、ARPで確かめる',
      body: 'はしごの3段目（ARP）です。WEBのTerminalで、同じLANにいるGateway（R1）にpingを送り、ARPキャッシュを見ます。\n\n```text\nping -c 3 192.168.2.1\nip neigh\n```\n\n`ip neigh` の行は「IPアドレス dev ポート lladdr MACアドレス 状態」の順です。R1の機器設定（インターフェース）に表示されるMACアドレスと比べましょう。',
      quiz: { question: '`ip neigh` に表示された 192.168.2.1 の lladdr は、どの機器のどのポートのMACアドレスですか？', options: ['R1 の g0/1（WEB側のポート）', 'R1 の g0/0（社内LAN側のポート）', 'WEB自身の eth0', 'PC1 の eth0'], answer: 0, explanation: 'ARPは同じLANの中だけで使います。WEBが知る必要があるのは、同じ 192.168.2.0/24 にいるR1の g0/1 のMACアドレスです。PC1のMACアドレスは、ルータの向こう側なのでWEBのARPキャッシュには載りません。' } },
    { title: 'WEBにDefault Gatewayを設定する',
      body: 'はしごの4段目（経路）です。まずPC1のTerminalで `ping 192.168.2.80` を実行してみましょう。WEBにアドレスを付けたのに、返事が戻りません。WEBで `ip route` を見ると、`192.168.2.0/24 dev eth0 …` の1行だけで、`default` の行がありません。\n\nLANの外（192.168.1.0/24）への出口として、R1（192.168.2.1）をDefault Gatewayにします。\n\n- GUI: WEB → Routing Table の「Default Gateway」に `192.168.2.1`\n- CLI:\n\n```text\nip route add default via 192.168.2.1\nip route get 192.168.1.10\n```\n\nもう一度PC1からpingを送り、返事が戻ることを確かめます。',
      hints: ['`ip route get 192.168.1.10` で `via 192.168.2.1 dev eth0` と出れば、PC1宛ての返事をR1に渡せます。'],
      check: n => resolveRoute(n.device('WEB'), '192.168.1.10')?.nextHop === '192.168.2.1',
      solve: n => sh(n, 'WEB', 'ip route add default via 192.168.2.1'),
      quiz: { question: 'Default Gatewayを設定する前、PC1からのpingが失敗したのはなぜですか？', options: ['Echo RequestはWEBに届いたが、WEBが 192.168.1.10 への返し方（経路）を知らなかった', 'R1が 192.168.2.0/24 への経路を知らなかった', 'WEBがpingに応答しない設定だった'], answer: 0, explanation: 'R1は両側のネットワークに直接つながっているので、行きのEcho RequestはWEBまで届きます。ところがWEBの経路表には 192.168.2.0/24 しかなく、返事のEcho Reply（192.168.1.10宛て）を送る先がありませんでした。通信には行きと帰りの両方の経路が要ります。' } },
    { title: 'PC1の /etc/resolv.conf にNS1を設定する',
      body: 'はしごの5段目（DNS）です。PC1で `curl http://www.example.com/` を実行すると `Could not resolve host` で失敗し、`cat /etc/resolv.conf` には nameserver がありません。問い合わせ先のDNSサーバーとして、NS1（192.168.1.53）を設定します。\n\n- GUI: PC1 → 「DNSクライアント（/etc/resolv.conf）」に `192.168.1.53`\n- CLI: PC1のTerminalで\n\n```text\necho "nameserver 192.168.1.53" > /etc/resolv.conf\ncat /etc/resolv.conf\ndig www.example.com\n```',
      check: n => (n.device('PC1').dnsServers ?? []).includes('192.168.1.53'),
      solve: n => sh(n, 'PC1', 'echo "nameserver 192.168.1.53" > /etc/resolv.conf'),
      quiz: { question: '設定後の `dig www.example.com` の `status:` は何でしたか？', options: ['NXDOMAIN', 'NOERROR', 'SERVFAIL', '応答なし（connection timed out）'], answer: 0, explanation: 'NS1には問い合わせが届き、答えも返っています。ただし example.com の中に www という名前がまだ登録されていないので、「その名前は存在しない」（NXDOMAIN）と答えました。応答がないとき（timed out）とは、直すべき場所が違います。' } },
    { title: 'NS1に www.example.com のAレコードを登録する',
      body: 'NS1は example.com の名前を管理するDNSサーバー（権威サーバー）です。ここに `www.example.com → 192.168.2.80` のAレコードを追加します（このシミュレータでは、ゾーンの編集はGUIで行います）。\n\n- GUI: NS1 → 「DNSサーバー（ゾーン）」でゾーン `example.com.` を選び、名前 `www`・型 `A`・TTL `300`・値 `192.168.2.80` で「レコードを追加」\n\nPC1で `dig www.example.com` を実行し、`status: NOERROR` と ANSWER SECTION の `192.168.2.80` を確かめます。',
      hints: ['名前の欄に `www` と書くと、ゾーン名が後ろに付いて `www.example.com.` になります。'],
      check: n => n.dnsLookup('PC1', 'www.example.com').message?.answer.some(r => r.type === 'A' && r.value === WEB) ?? false,
      solve: n => n.update('NS1', d => { d.dnsServer!.zones[0].records.push({ name: 'www.example.com.', type: 'A', ttl: 300, value: WEB }); }) },
    { title: 'WEBでnginxを起動する',
      body: 'はしごの6段目（TCP）です。PC1で `curl -v http://www.example.com/` を実行すると、`[TCP] 失敗: Connection refused` になります。パケットはWEBに届いたのに、80番で待ち受けているプログラムがいない、という意味です。WEBで確かめます。\n\n```text\nss -tlnp\nsystemctl status nginx\n```\n\nnginxは `inactive (dead)`（停止中）です。起動して、もう一度 `ss -tlnp` を見ます。\n\n- GUI: WEB → 「サービス（待ち受けるポート）」で nginx を running にする\n- CLI: `systemctl start nginx`\n\nPC1で `curl http://www.example.com/` を実行し、ページの中身が表示されることを確かめましょう。',
      check: n => n.tcpConnect('PC1', WEB, 80).success,
      solve: n => sh(n, 'WEB', 'systemctl start nginx'),
      quiz: { question: '起動後の `ss -tlnp` の待ち受けのうち、PC1からは接続できないものはどれですか？', options: ['127.0.0.1:8080（app）', '0.0.0.0:80（nginx）', '0.0.0.0:22（sshd）'], answer: 0, explanation: '127.0.0.1 はループバック（自分自身）のアドレスで、WEBの外からは届きません。app は WEBの中からだけ使う前提で、外からの接続は 0.0.0.0（すべてのアドレス）で待ち受ける nginx が受けます。' } },
    { title: 'WEBのホストFirewallで、必要な通信だけを許可する',
      body: 'WEBに入ってくる通信（iptablesの INPUT チェーン）を、必要なものだけに絞ります。必要なのは、戻りの通信（ESTABLISHED,RELATED）、Web（80番）、社内LANからの管理用SSH（22番）です。pingも許可しておくと、切り分けに使えます。**どれにも一致しないものを捨てる `-P INPUT DROP` は、許可ルールを入れた後に最後に設定します。**\n\n```text\niptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT\niptables -A INPUT -p tcp --dport 80 -j ACCEPT\niptables -A INPUT -p tcp -s 192.168.1.0/24 --dport 22 -j ACCEPT\niptables -A INPUT -p icmp -j ACCEPT\niptables -P INPUT DROP\niptables -L -n\n```\n\nGUIでも、WEB → ホストFirewall →「iptables INPUT を有効にする」の後、`permit tcp any any eq 80` のような書式でルールを追加できます（デフォルトポリシー `-P INPUT DROP` はCLIで設定します）。\n\n設定後、PC1から `nc -zv 192.168.2.80 80`・`nc -zv 192.168.2.80 22`・`nc -zv 192.168.2.80 8080` を試しましょう。',
      hints: ['`-P INPUT DROP` を先に実行すると、許可ルールを入れるまでの間、SSHで作業していれば自分も締め出されます（実機での事故の定番です）。', 'すべてを許可するルール（`-j ACCEPT` だけ）や `-P INPUT ACCEPT` では、「必要なものだけ」になりません。', 'ルールを間違えたら `iptables -L -n` で番号を確かめ、`iptables -D INPUT <番号>` で消します。'],
      check: n => { const t = (p: number) => n.tcpConnect('PC1', WEB, p); const other = t(8080);
        return n.device('WEB').firewall?.defaultAction === 'deny' && n.http('PC1', 'http://www.example.com/').success && t(22).success && !other.success && !other.refused; },
      solve: n => sh(n, 'WEB', 'iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT', 'iptables -A INPUT -p tcp --dport 80 -j ACCEPT',
        'iptables -A INPUT -p tcp -s 192.168.1.0/24 --dport 22 -j ACCEPT', 'iptables -A INPUT -p icmp -j ACCEPT', 'iptables -P INPUT DROP'),
      quiz: { question: 'Firewallを設定した後、PC1からの `nc -zv 192.168.2.80 8080` はどうなりましたか？', options: ['Connection timed out（何も返ってこない）', 'Connection refused（拒否の応答が返る）', 'succeeded（接続できる）'], answer: 0, explanation: '設定前は、8080番宛てのSYNはWEBに届き、外向きの待ち受けがないのでRST（拒否の応答）が返っていました（refused）。いまは INPUT のポリシー DROP で黙って捨てられるので、何も返らずタイムアウトします。エラーの言い方から「どこで止まったか」の見当が付きます。' } },
    { title: 'WEBでHTTPSを公開する',
      body: 'はしごの7段目（TLS）です。WEBにHTTPSのサービスを追加します。\n\n- GUI: WEB → 「サービス（待ち受けるポート）」の「HTTPS (443)」ボタン（証明書の名前は www.example.com）\n\nPC1で `curl -v https://www.example.com/` を実行すると、`[TCP] 失敗` でタイムアウトします。前のステップのFirewallが443番を許可していないからです。443番の許可を追加します。\n\n```text\niptables -A INPUT -p tcp --dport 443 -j ACCEPT\n```\n\nもう一度 `curl -v https://www.example.com/` を実行し、`[TLS]` の行が成功することを確かめます。続けて、名前ではなくIPアドレスで `curl -v https://192.168.2.80/` も試しましょう。',
      hints: ['新しいサービスを足したら、Firewallにもそのポートの許可が要ります。', '`curl -k` は証明書の検証を省くだけで、解決にはなりません。判定も `-k` なしで行います。'],
      check: n => n.http('PC1', 'https://www.example.com/').success,
      solve: n => { n.update('WEB', d => { d.services!.push(https(['www.example.com'])); }); sh(n, 'WEB', 'iptables -A INPUT -p tcp --dport 443 -j ACCEPT'); },
      quiz: { question: '`curl -v https://192.168.2.80/`（IPアドレスで接続）は、どの段で失敗しましたか？', options: ['[TLS]：証明書の名前が一致しない', '[DNS]：名前解決できない', '[TCP]：Connection refused', '[HTTP]：503が返る'], answer: 0, explanation: 'IPアドレスを指定したのでDNSは使わず、TCPの接続までは成功します。ところが証明書に書かれた名前は www.example.com だけなので、接続先の 192.168.2.80 と一致せず、TLSの段で失敗します。HTTPSは名前で接続するのが基本です。' } },
    { title: 'アプリの応答を変えて、最上段の失敗を読む',
      body: 'はしごの最上段（アプリケーション）です。WEB → 「サービス」で nginx-tls の「HTTPステータス」を `503` にして、PC1で `curl -v https://www.example.com/` を実行します。どの段まで成功し、どこで失敗と表示されるかを読みましょう。\n\n読み終えたら、HTTPステータスを `200` に戻します（前のステップの判定が、また成り立つようになります）。',
      quiz: { question: '503にしたとき、`curl -v` で「失敗」と表示されたのはどの段でしたか？', options: ['[HTTP] だけ（[DNS]・[TCP]・[TLS] は成功）', '[TCP]', '[TLS]', 'すべての段'], answer: 0, explanation: '名前解決・TCPの接続・TLSのハンドシェイクはすべて成功し、サーバーのアプリが「今は処理できない」（503）と答えています。ネットワークは正常で、調べる先はサーバーのアプリ（ログや設定）だ、と根拠を持って言えます。' } },
  ],
  debrief: 'NIC → IP → ARP → 経路 → DNS → TCP（待ち受けとFirewall）→ TLS → アプリ。WEBを1段ずつ「正常」にしながら、各段のコマンドと、失敗したときの言い方を確かめました。障害のときも同じはしごを下から登り、最初に失敗した段を探します。',
});
