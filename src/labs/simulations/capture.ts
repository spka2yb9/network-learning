import { build, dnsService, https, web } from '../../simulator/scenarios/build';
import { parseRule } from '../../simulator/services/FirewallEngine';
import { networkSimulation } from '../simulation';

/**
 * Chapter 8: the Theory's example network (PC1, DNS1 / R1 / WEB), starting with three failures to read in captures:
 * www.example.com is not registered (NXDOMAIN), nginx is stopped (RST), WEB's host firewall drops 443 (SYN retransmissions).
 */
export const captureSimulation = networkSimulation({
  id: 'sim-capture', chapter: 'capture', minutes: 40,
  title: 'キャプチャで「開けない」を読み解き、直したことも確かめる',
  mission: 'PC1 から www.example.com が開けない原因を、キャプチャの観測（NXDOMAIN・RST・SYNの再送）から1つずつ突き止めて直し、http と https の両方でページを開けるようにする',
  brief: [
    'Theory と同じネットワークです。配線・アドレス・経路は済んでいますが、PC1 から `www.example.com` を開けません。原因は3つあります。',
    '```text\n  PC1   192.168.1.10 ───┐\n                        SW1 ──── g0/0 [ R1 ] g0/1 ──── WEB  192.168.2.80\n  DNS1  192.168.1.53 ───┘     192.168.1.1   192.168.2.1     nginx（80番・443番）\n```',
    'このシミュレータは、すべてのリンクを通ったフレームを自動で記録します。画面下の **Packet Capture** タブ（一覧・階層表示・Hexダンプ）と、各機器の **Terminal** の `tcpdump`（その機器のリンクだけ）を使い分けて読みます。',
    'Theory の順に、①観測点で見え方が変わる → ②DNS（NXDOMAIN）→ ③TCP（RST・3-way handshake・フラグ）→ ④HTTPは平文 → ⑤SYNの再送と2か所の観測点 → ⑥TLSのSNI → ⑦観測と仮説、と進めます。',
  ].join('\n\n'),
  source: 'PC1', target: '192.168.2.80',
  build: () => build([
    { id: 'PC1', kind: 'pc', at: [40, 60], ip: { eth0: '192.168.1.10/24' }, gw: '192.168.1.1', dns: ['192.168.1.53'] },
    { id: 'DNS1', kind: 'server', at: [40, 300], ip: { eth0: '192.168.1.53/24' }, gw: '192.168.1.1', set: d => {
      d.services = [dnsService()];
      d.dnsServer = { recursive: true, rootHints: [], zones: [{ origin: 'example.com.', records: [
        { name: 'example.com.', type: 'SOA', ttl: 3600, value: 'dns1.example.com. hostmaster.example.com. 2026100301 7200 3600 1209600 300' },
        { name: 'example.com.', type: 'NS', ttl: 3600, value: 'dns1.example.com.' },
        { name: 'dns1.example.com.', type: 'A', ttl: 3600, value: '192.168.1.53' },
      ] }] };
    } },
    { id: 'SW1', kind: 'switch', at: [260, 180] },
    { id: 'R1', kind: 'router', at: [480, 180], ip: { 'g0/0': '192.168.1.1/24', 'g0/1': '192.168.2.1/24' } },
    { id: 'WEB', kind: 'server', at: [720, 180], ip: { eth0: '192.168.2.80/24' }, gw: '192.168.2.1', set: d => {
      d.services = [{ ...web('nginx', '<h1>www.example.com</h1>'), running: false }, https(['www.example.com'], '<h1>www.example.com (TLS)</h1>')];
      d.firewall = { stateful: false, defaultAction: 'permit', rules: [parseRule(10, 'deny tcp any any eq 443'.split(' '))] };
    } },
  ], [['PC1', 'eth0', 'SW1', 'g0/1'], ['DNS1', 'eth0', 'SW1', 'g0/2'], ['SW1', 'g0/8', 'R1', 'g0/0'], ['R1', 'g0/1', 'WEB', 'eth0']]),
  sim: [
    { title: 'PC1からWEBへpingを送り、最初のフレームを読む',
      body: '画面下の SEND バーで PC1 → `192.168.2.80` に ping を送ります（または PC1 の Terminal で `ping 192.168.2.80`）。\n\n次に **Packet Capture** タブを開き、一覧の最初の行（ARP）を読みます。PC1 の Terminal で次のように実行すると、PC1 のリンクの ARP だけを、MACアドレス付きで見られます（Theory「パケット一覧を読む」）。\n\n```text\ntcpdump -e arp\n```',
      hints: ['ARP の行の Info は「Who has （尋ねたIP）? Tell （尋ねた人のIP）」の形です。', 'WEB は PC1 と別のネットワーク（192.168.2.0/24）にいます。PC1 は、別のネットワーク宛てのフレームを誰に渡すでしょうか（第3章）。'],
      quiz: { question: 'ping を送ったときに PC1 が出した ARP 要求で、PC1 が MAC アドレスを尋ねている IP アドレスはどれですか？', options: ['192.168.2.80（WEB）', '192.168.1.1（R1 の g0/0）', '192.168.1.53（DNS1）', 'ff:ff:ff:ff:ff:ff'], answer: 1, explanation: 'WEB は別のネットワークにいるので、PC1 はフレームを Default Gateway の R1 に渡します。そのために R1（192.168.1.1）の MAC アドレスを ARP で尋ねます。ff:ff:ff:ff:ff:ff はブロードキャストの宛先 MAC で、尋ねている IP ではありません。' } },
    { title: 'R1の前後で、同じEcho Requestを比べる',
      body: '同じ Echo Request が、PC1 のリンクと WEB のリンクでどう違って見えるかを比べます（Theory「どこで取るか：観測点で見えるものが変わる」）。\n\n- **Packet Capture** タブで Echo request の行を順に選び、階層表示の Ethernet II（Source / Destination）と IPv4 の Time to live を見る\n- または右の **Debugger** で「Hop」を選び、ホップごとの MAC・IP・TTL を表で比べる\n- CLI なら、PC1 と WEB の Terminal でそれぞれ `tcpdump -e icmp` を実行し、MAC アドレスを比べる',
      hints: ['同じ Echo request の行が3つ並ぶのは、PC1–SW1、SW1–R1、R1–WEB の3本のリンクで記録したからです。', 'スイッチ（SW1）は IP ヘッダを書き換えません。ルータ（R1）は何を変えるでしょうか。'],
      quiz: { question: 'WEB のリンク（R1–WEB 間）で記録された Echo Request は、PC1 のリンクで記録されたものと比べて何が違いますか？', options: ['送信元・宛先の IP アドレスが変わり、TTL は同じ', '送信元・宛先の MAC アドレスが変わり、TTL が 64 から 63 に減っている', '何も変わらない', 'TTL だけが 2 減っている（SW1 と R1 で1ずつ）'], answer: 1, explanation: 'R1 は MAC アドレスを付け替え（送信元は R1 の g0/1、宛先は WEB）、TTL を1減らします。IP アドレスは NAT がなければ変わりません。SW1 は TTL を減らさないので、減るのは R1 の1回分だけです。' } },
    { title: 'DNSの応答を読み、NXDOMAINを確かめる',
      body: 'PC1 の Terminal で名前を引き、DNS のやり取りだけを表示します（Theory「DNSをキャプチャで読む」）。\n\n```text\ndig www.example.com\ntcpdump udp port 53\n```\n\n**Packet Capture** タブなら、フィルタ欄に `udp port 53` と入れます。応答の行を選び、Domain Name System の Flags を見ましょう。続けて `curl http://www.example.com/` も実行し、`tcpdump tcp` で TCP の SYN が出ているかも確かめます。',
      hints: ['応答の Info の最後に、結果が英語で書かれています。', 'Flags の値の下4ビットが RCODE です。0 は成功、3 は NXDOMAIN でした。'],
      quiz: { question: 'DNS1 の応答と、その後の curl のキャプチャから言えることはどれですか？', options: ['www.example.com という名前は DNS1 に存在しない（RCODE 3、No such name）。そのため curl は SYN を1つも送っていない', 'DNS1 が応答しなかった', 'SYN は送られたが、WEB が RST を返した', 'R1 が DNS の問い合わせを捨てた'], answer: 0, explanation: '応答は返ってきていて、Flags の RCODE が 3（NXDOMAIN、No such name）です。接続先の IP アドレスがわからないので、curl は SYN を送らずに「Could not resolve host」で終わります。「SYN が1つもない」ことも、名前解決で止まった手がかりです。' } },
    { title: 'DNS1に、wwwのAレコードを登録する',
      body: 'NXDOMAIN の原因は、DNS1 に `www.example.com` のレコードがないことです。WEB のアドレスを A レコードとして登録します。\n\n- GUI: DNS1 を選び、右の「機器設定」→「DNSサーバー（ゾーン）」で、ゾーン `example.com.` に 名前 `www`、型 `A`、TTL `300`、値 `192.168.2.80` を入れて「レコードを追加」\n\n登録したら、PC1 でもう一度 `dig www.example.com` を実行し、`tcpdump udp port 53` で問い合わせと応答の組を読みます。',
      hints: ['レコード名に `www` とだけ入れると、ゾーン名が補われて `www.example.com.` になります。', 'PC1 の `dig` の結果に `status: NOERROR` と `192.168.2.80` が出れば登録できています。'],
      check: n => !!n.dnsLookup('PC1', 'www.example.com').message?.answer.some(r => r.type === 'A' && r.value === '192.168.2.80'),
      solve: n => n.update('DNS1', d => { d.dnsServer!.zones[0].records.push({ name: 'www.example.com.', type: 'A', ttl: 300, value: '192.168.2.80' }); }),
      quiz: { question: '新しい問い合わせ（Standard query）と、その応答の組について、正しいものはどれですか？', options: ['問い合わせは PC1 の 53番 → DNS1 の 53番、応答も同じ向き', '問い合わせは PC1 の 49152 以上のポート → DNS1 の 53番（UDP）。応答はその逆向きで、同じトランザクションID（0x…）が入っている', '問い合わせは TCP の 80番を使う', '問い合わせと応答では、トランザクションIDが毎回変わる'], answer: 1, explanation: 'PC1 は一時的に選んだエフェメラルポートから、DNS1 の UDP 53番に問い合わせます。応答は 53番からそのポート宛てに戻り、問い合わせと同じトランザクションIDが入っているので、どの質問への答えかを対応付けられます。' } },
    { title: 'curlでつなぎ、RSTを返したのは誰かを読む',
      body: '名前は引けるようになりました。PC1 で `curl http://www.example.com/` を実行します（SEND バーで curl を選んでもかまいません）。まだ失敗するはずです。\n\nPC1 の Terminal で TCP だけを表示し、SYN への返事を読みます（Theory「失敗はキャプチャでこう見える」）。\n\n```text\ntcpdump tcp and host 192.168.2.80\n```',
      hints: ['返事の行の Source（`>` の左）が、RST を送った機器です。', 'RST, ACK の Ack が、SYN の Seq ＋1 になっているかも確かめましょう。'],
      quiz: { question: '[RST, ACK] を送ったのは誰で、そこから何が言えますか？', options: ['R1（192.168.1.1）。WEB への経路がない', 'WEB（192.168.2.80）。SYN は WEB まで届いたが、80番で待ち受けているプログラムがない', 'PC1 自身。curl が自分で接続を打ち切った', 'DNS1。名前解決に失敗した'], answer: 1, explanation: 'RST, ACK の送信元は 192.168.2.80 で、Ack は SYN の Seq ＋1 です。SYN は WEB まで届いていて、WEB の OS が「80番で待ち受けがない」と即座に断っています。経路の問題ではなく、WEB のサービス（nginx）を疑います。' } },
    { title: 'WEBのnginxを起動する',
      body: 'WEB で `ss -tlnp` を実行すると、80番で待ち受けていないことがわかります。nginx（80番の Web サーバー）を起動します。\n\n- GUI: WEB を選び、右の「機器設定」→「サービス」で nginx を running にする\n- CLI: WEB の Terminal で\n\n```text\nsystemctl start nginx\n```\n\n起動したら PC1 で `curl http://www.example.com/` を実行し、`tcpdump tcp and host 192.168.2.80` で 3-way handshake の番号を読みます。',
      hints: ['`systemctl status nginx` で Active: active (running) になれば起動しています。', 'PC1 の curl で `<h1>www.example.com</h1>` が表示されれば、このステップは完了です。'],
      check: n => n.http('PC1', 'http://www.example.com/').success,
      solve: n => n.update('WEB', d => { d.services!.find(s => s.name === 'nginx')!.running = true; }),
      quiz: { question: '[SYN, ACK] の Ack の値は、直前の [SYN] の Seq と比べてどうなっていますか？', options: ['同じ値', 'SYN の Seq ＋1', '0', 'SYN の Seq ＋ 64240（Win の値）'], answer: 1, explanation: 'SYN はデータを運びませんが、番号を1つ使います。そのため WEB は「次は Seq＋1 から送ってください」という意味で、Ack に SYN の Seq ＋1 を返します。この関係を見れば、その SYN, ACK が本当にその SYN への返事だと確かめられます。' } },
    { title: 'SYNとSYN, ACKのフラグを、Hexダンプで確かめる',
      body: '**Packet Capture** タブのフィルタ欄に `tcp port 80` と入れ、[SYN] の行を選びます。階層表示の Transmission Control Protocol → Flags にカーソルを合わせると、Hexダンプで対応するバイト（オフセット 0x2f）が強調されます。同じように [SYN, ACK] の行も見ます（Theory「Hexダンプを読む（2）TCPヘッダとフラグ」）。\n\n余裕があれば、Source port・Destination port・Time to live にもカーソルを合わせ、オフセットと値を確かめましょう。',
      hints: ['フラグは1バイトの中のビットの組み合わせです。FIN＝0x01、SYN＝0x02、RST＝0x04、PSH＝0x08、ACK＝0x10。', 'SYN, ACK は 0x02 ＋ 0x10 です。'],
      quiz: { question: 'オフセット 0x2f のバイトの値は、[SYN] と [SYN, ACK] でそれぞれいくつですか？', options: ['02 と 12', '10 と 02', '12 と 02', '01 と 11'], answer: 0, explanation: 'SYN だけが立つと 0x02、SYN と ACK が立つと 0x02 ＋ 0x10 で 0x12 です。同じ考え方で、PSH, ACK は 0x18、FIN, ACK は 0x11、RST, ACK は 0x14 になります。' } },
    { title: 'HTTPのリクエストを平文で読む',
      body: '**Packet Capture** タブのフィルタ欄に `http` と入れ、`GET / HTTP/1.1` の行を選びます。Hexダンプの右側（文字の欄）と、階層表示の Hypertext Transfer Protocol を読みます（Theory「HTTPとTLS：読める中身と、読めない中身」）。\n\n`HTTP/1.1 200 OK` の行も選び、本文がどこまで読めるかを確かめましょう。',
      hints: ['`47 45 54 20` は文字で `GET ` です。`0d 0a` は改行です。'],
      quiz: { question: 'HTTP（暗号化なし）のリクエストについて、キャプチャから読めるものはどれですか？', options: ['IP アドレスとポート番号だけ', '`GET / HTTP/1.1` の行や `Host: www.example.com` などのヘッダまで、すべて文字のまま読める', '暗号化されているので何も読めない', 'SNI だけが読める'], answer: 1, explanation: 'HTTP は平文なので、リクエスト行・ヘッダ・本文がそのまま読めます。ログインのパスワードや Cookie も同じように見えてしまうため、実際のサービスでは TLS（HTTPS）を使います。' } },
    { title: 'httpsで接続し、2か所の観測点で再送を読む',
      body: 'PC1 で `curl https://www.example.com/` を実行します。今度は、しばらく待たされた末に失敗します。\n\n送り手と受け手の両方で、443番の通信を表示して比べます（Theory「失敗はキャプチャでこう見える」）。\n\n```text\n（PC1 の Terminal）tcpdump tcp port 443\n（WEB の Terminal）tcpdump -i eth0 tcp port 443\n```',
      hints: ['左端の時刻の差を計算してみましょう。', 'WEB の eth0 に SYN が届いているなら、経路は問題ありません。WEB は何か返しているでしょうか。'],
      quiz: { question: 'PC1 と WEB の2つの tcpdump から言えることはどれですか？', options: ['SYN は R1 で捨てられ、WEB には届いていない', '同じ Seq の SYN が約1秒・2秒の間隔で3回、WEB の eth0 まで届いているのに、WEB は何も返していない。WEB の中（Firewall など）で止まっていると考えられる', 'WEB が RST を返して、すぐに断った', '名前解決に失敗している'], answer: 1, explanation: 'PC1 は返事がないので、同じ SYN を間隔を倍に延ばしながら再送しています。WEB の eth0 にも3つとも届いているので、経路の問題ではありません。tcpdump は Firewall の判定より前に記録するので、WEB のホストの Firewall が黙って捨てている（DROP）と考えるのが自然です。ただし、これはまだ仮説です。' } },
    { title: 'WEBのFirewallで、443番の破棄をやめる',
      body: '仮説を確かめます。WEB で Firewall のルールを見ると、443番を DROP するルールがあります。\n\n```text\niptables -L INPUT -n\niptables -D INPUT 1\n```\n\n- GUI: WEB を選び、右の「機器設定」→「ホストFirewall（iptables INPUT）」で `deny tcp any any eq 443` のルールを削除\n\n直ったら PC1 で `curl https://www.example.com/` を実行し、**Packet Capture** タブで `tls` と入れて、Client Hello の行を選びます。',
      hints: ['`iptables -L INPUT -n` の1列目の番号が、`-D INPUT` に渡すルールの番号です。', 'PC1 の curl で `<h1>www.example.com (TLS)</h1>` が表示されれば完了です。'],
      check: n => n.http('PC1', 'https://www.example.com/').success,
      solve: n => n.update('WEB', d => { d.firewall!.rules = d.firewall!.rules.filter(r => r.destinationPort?.[0] !== 443); }),
      quiz: { question: 'Client Hello の行から、キャプチャで読めるものはどれですか？', options: ['SNI として書かれた接続先の名前 www.example.com', 'HTTP の GET の行と Host ヘッダ', 'サーバーの証明書の中身', '何も読めない'], answer: 0, explanation: 'Client Hello は暗号化の前に送るので、SNI（接続したいサーバーの名前）が読めます。TLS 1.3 では Server Hello 以降が暗号化されるため、証明書も HTTP の中身も Application Data としか見えません。' } },
    { title: '観測と仮説を分けて報告する',
      body: '443番の件を、チームに報告する文にまとめます（Theory「観測と仮説を分けて報告する」）。観測（どの観測点で、何が見えた・見えなかったか）と、仮説・確認の方法を分けて書けているものを選びます。',
      hints: ['観測には、ほかの人が同じキャプチャで確かめられる事実だけを書きます。'],
      quiz: { question: '報告として最も適切なものはどれですか？', options: ['「WEB の Firewall が原因でした。」', '「観測：PC1 の eth0 と WEB の eth0 の両方で、192.168.2.80:443 宛ての同じ Seq の SYN が3回（約1秒・2秒の間隔）。SYN, ACK・RST・ICMP はどちらにも無い。仮説：WEB の中で SYN が捨てられている。確認：WEB の iptables -L INPUT -n で DROP のルールを見つけ、削除後に curl https が成功。」', '「ネットワークが不安定なようです。」', '「キャプチャには SYN, ACK が無かったので、WEB は SYN を受け取っていません。」'], answer: 1, explanation: '観測点とフレームの事実（同じ Seq・間隔・無かったもの）を観測として書き、そこから考えた説明を仮説として分け、確かめた方法と結果を添えています。「SYN, ACK が無い」から「受け取っていない」と言い切るのは、観測と仮説の混同です。' } },
  ],
  debrief: 'NXDOMAIN（SYN が出ない）、RST（届いたが断られた）、SYN の再送（返事がない）を、キャプチャの形から見分けて直しました。一覧で筋をつかみ、階層表示とHexダンプで確かめ、観測点を増やして止まった区間を絞る。そして観測と仮説を分けて伝える——これがキャプチャで障害を調べるときの基本の流れです。',
});
