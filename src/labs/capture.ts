import { dnsScenario, firewallScenario } from '../simulator/scenarios/chapters';
import { routingScenario } from '../simulator/scenarios/routing';
import type { CaptureCase, CaptureLab } from './types';

const tlsBroken = () => { const n = dnsScenario(); n.update('WEB', d => { d.services!.find(s => s.port === 443)!.tls!.names = ['example.com']; }); return n; };
const causes = ['サーバーがRSTを返した（そのポートで待ち受けているプログラムがない）', 'SYNに応答がなく、再送を繰り返している（途中で破棄されたか、応答が戻れていない）', '名前解決（DNS）で「その名前は存在しない」（NXDOMAIN）と返された', 'TLSのハンドシェイク（暗号化を始めるためのやり取り）の途中で、クライアントが切断した（証明書の検証に失敗）', 'ルータが ICMP で「宛先のネットワークへの経路がない」と返した'];
export const failureCases: CaptureCase[] = [
  { id: 'syn-timeout', title: 'ケースA: 待たされた末に失敗', question: 'PC1 から 10.0.2.80:443 への接続が失敗しました。キャプチャから分かる原因はどれですか？',
    build: () => ({ captures: firewallScenario(false).tcpConnect('PC1', '10.0.2.80', 443).captures, note: 'PC1で nc -zv 10.0.2.80 443' }), options: causes, answer: 1,
    evidence: c => c.protocol === 'TCP' && /\[SYN\]/.test(c.info), evidenceHint: '根拠: 原因を示すパケットの番号（No.）', explanation: '同じSeqのSYNが、間隔を広げながら（Time を比べると約1秒、2秒）再送されています。SYN, ACK も RST も返っていません。途中のFirewallなどで黙って破棄（DROP）されている典型的なパターンです。拒否（REJECT）の設定なら、RST か ICMP のエラーが返ります。ただし「応答が戻る途中で落ちている」可能性もあるので、サーバー側のキャプチャやFirewallのログで確かめます。' },
  { id: 'rst', title: 'ケースB: すぐに失敗する接続', question: 'PC1 から 203.0.113.80:8080 への接続が失敗しました。キャプチャから分かる原因はどれですか？',
    build: () => ({ captures: dnsScenario().tcpConnect('PC1', '203.0.113.80', 8080).captures, note: 'PC1で nc -zv 203.0.113.80 8080' }), options: causes, answer: 0,
    evidence: c => c.protocol === 'TCP' && /RST/.test(c.info), evidenceHint: '根拠: 原因を示すパケットの番号（No.）', explanation: 'SYN に対して RST, ACK（接続を打ち切る合図）が返っています。パケットは宛先まで届いていて、サーバー上にそのポートで待ち受けているプログラムがありません（実機では、RSTを代わりに返すFirewallもあります）。同じSYNやRSTがほぼ同じ時刻に何行も見えるのは、このシミュレータが通り道のすべてのリンクで記録しているためで、再送ではありません。' },
  { id: 'nxdomain', title: 'ケースC: curl が失敗する（http）', question: 'PC1 で curl http://wwww.example.com/ が失敗しました。キャプチャから分かる原因はどれですか？',
    build: () => ({ captures: dnsScenario().http('PC1', 'http://wwww.example.com/').captures, note: 'PC1で curl http://wwww.example.com/' }), options: causes, answer: 2,
    evidence: c => c.protocol === 'DNS' && c.info.includes('No such name') && c.destination === '192.168.1.10', evidenceHint: '根拠: 原因を示すパケットの番号（PC1 192.168.1.10 が受け取ったもの）', explanation: 'リゾルバ（PC1の代わりに名前を調べるDNSサーバー）が、PC1に NXDOMAIN（No such name：その名前は存在しない）を返しています。接続先のIPがわからないので、TCPのSYNは一度も送られていません。ホスト名の綴り（wwww）の誤りです。' },
  { id: 'tls', title: 'ケースD: curl が失敗する（https）', question: 'PC1 で curl https://www.example.com/ が失敗しました。キャプチャから分かる原因はどれですか？',
    build: () => ({ captures: tlsBroken().http('PC1', 'https://www.example.com/').captures, note: 'PC1で curl https://www.example.com/' }), options: causes, answer: 3,
    evidence: c => c.protocol === 'TLS' && c.info.includes('Server Hello'), evidenceHint: '根拠: サーバーから届いた最後のTLSレコードのパケット番号', explanation: 'TCPの接続と、TLSの Client Hello / Server Hello までは成立しています。その後クライアントは短い暗号化レコードを1つ送り（TLS 1.3 ではエラーの通知も暗号化され、Application Data と表示されます）、FIN で切断しています。TLS 1.3では証明書も暗号化されるので中身は見えませんが、流れから、クライアント側での証明書の検証失敗と推測できます。確かめるには、クライアントで curl -v を実行してエラーを読みます。' },
  { id: 'unreachable', title: 'ケースE: ping が通らない', question: 'PC1 から 192.168.2.10 への ping が失敗しました。キャプチャから分かる原因はどれですか？',
    build: () => ({ captures: routingScenario().ping('PC1', '192.168.2.10').captures, note: 'PC1で ping 192.168.2.10' }), options: causes, answer: 4,
    evidence: c => c.protocol === 'ICMP' && c.info.includes('Destination unreachable'), evidenceHint: '根拠: 原因を示すパケットの番号（No.）', explanation: 'R1（192.168.1.1）が ICMP Destination unreachable（Network unreachable：宛先のネットワークへ届けられない）を返しています。R1の経路表に、192.168.2.10 へ届く経路がありません。' },
];
const basics: CaptureCase[] = [
  { id: 'handshake', title: '3-way handshake を読む', question: 'サーバーからクライアントへ送られた、最初のTCPセグメント（TCPで送るデータのまとまり）のフラグは何ですか？', build: () => ({ captures: dnsScenario().http('PC1', 'http://203.0.113.80/').captures, note: 'PC1で curl http://203.0.113.80/' }),
    options: ['SYN', 'SYN, ACK', 'ACK', 'FIN, ACK'], answer: 1, evidence: c => c.protocol === 'TCP' && c.info.includes('[SYN, ACK]'), evidenceHint: '根拠: そのセグメントのパケット番号（No.）', explanation: 'クライアントの SYN（接続の申し込み）に、サーバーが SYN, ACK（受け入れと確認）を返し、クライアントの ACK で接続が確立します（3-way handshake）。SYN, ACK の Ack は、クライアントの Seq + 1 です。' },
  { id: 'dns-port', title: 'DNSの通信を読む', question: 'PC1のDNSの問い合わせは、どのプロトコルとポートを使っていますか？', build: () => ({ captures: dnsScenario().dnsLookup('PC1', 'www.example.com').captures, note: 'PC1で dig www.example.com' }),
    options: ['TCP 80', 'UDP 53', 'TCP 443', 'ICMP'], answer: 1, evidence: c => c.protocol === 'DNS' && c.source === '192.168.1.10', evidenceHint: '根拠: PC1が送ったDNSの問い合わせ（クエリ）のパケット番号', explanation: '通常のDNSの問い合わせは UDP の53番です。応答が大きすぎる場合や、ゾーン転送（DNSサーバーどうしでデータをまとめてコピーすること）では TCP 53 も使います。' },
  { id: 'ttl', title: 'tracerouteの仕組みを読む', question: 'traceroute を実行したとき、途中のルータから返ってくるICMPのメッセージは何ですか？', build: () => ({ captures: routingScenario(true).traceroute('PC1', '192.168.2.10').flatMap(p => p.result.captures), note: 'PC1で traceroute -I 192.168.2.10' }),
    options: ['Echo Reply', 'Time-to-live exceeded', 'Port Unreachable', 'Redirect'], answer: 1, evidence: c => c.info.startsWith('Time-to-live exceeded'), evidenceHint: '根拠: 途中のルータから返ってきたICMPのパケット番号', explanation: 'traceroute は、TTL（パケットが通過できるルータの数の上限）を 1, 2, 3… と増やして送ります。TTLが0になったルータは ICMP Time Exceeded（Time-to-live exceeded）を返すので、その送信元アドレスから、途中のルータを順に知ることができます。' },
];
export const captureLabs: CaptureLab[] = [
  { id: 'capture-01', chapter: 'capture', kind: 'guided', workspace: 'capture', minutes: 20, title: 'パケットで通信を読む', mission: 'キャプチャ（記録されたパケット）から、TCPの接続・DNSの問い合わせ・tracerouteの仕組みを読み取ります。',
    brief: '**やること**: 3つのケースそれぞれで、記録されたパケットの一覧を読み、質問の答えと、その根拠になるパケットの番号（一覧の左端の No.）を入力します。\n\n**完了の条件**: 3つのケースすべてで、答えと根拠のパケット番号の両方が正しいこと。\n\n**読み方の注意**: このシミュレータは、パケットが通ったすべてのリンクで記録します。そのため、同じ内容の行がほぼ同じ時刻に何行も並びます。どの行の番号を答えてもかまいません。\n\n**まずは**: 「3-way handshake を読む」のケースで、Info 列にある [SYN] などのフラグを上から順に読みます。',
    hints: ['パケット一覧の Info 列に、TCPのフラグ（[SYN] など）、DNSの問い合わせ名、ICMPの種類が要約されています。まずは上から順に読みます。', 'フィルタ（tcp、udp port 53、icmp など）で絞り込むと、目的のパケットを見つけやすくなります。パケットを選ぶと、階層表示とHexで中身を確かめられます。', '根拠の番号は、一覧の左端の No. です。たとえば3-way handshakeなら、サーバー 203.0.113.80 から送られた最初のTCPパケットの No. を入力します。'],
    debrief: '一覧（Info）→ 階層表示 → Hex の順に、外側から中身を読み解けました。実務でキャプチャを共有するときも、「No.14 の SYN, ACK」のようにパケット番号を添えると、ほかの人が同じ事実を確かめられます。', cases: basics },
  { id: 'capstone-3', chapter: 'capstone', kind: 'capstone', workspace: 'capture', minutes: 60, title: 'Capstone 3: キャプチャから失敗の理由を示す', mission: '5つの通信失敗のキャプチャを読み、それぞれの原因と、根拠になるパケットの番号を答えます。',
    brief: '**状況**: 「つながらない」という相談が5件届き、それぞれPC1で操作したときのキャプチャがあります（どのコマンドで記録したかは、各ケースの「取得方法」に表示されます）。\n\n**やること**: ケースごとに、キャプチャから原因を選び、その根拠になるパケットの番号（一覧の左端の No.）を入力します。\n\n**完了の条件**: 5つのケースすべてで、原因と根拠のパケットの両方が正しいこと。\n\n**読み方の注意**: このシミュレータは、パケットが通ったすべてのリンクで記録します。同じ内容の行がほぼ同じ時刻に並ぶのは、別のリンクで記録された同じパケットで、再送ではありません。再送かどうかは Time の間隔で見分けます。\n\n**まずは**: ケースAを開き、パケット一覧を上から読みます。観測した事実（どのパケットがあり、どれが無いか）と、そこからの推測を分けて考えましょう。',
    hints: ['まず、最後に何が起きたか（最後のパケット）から見ると早いことがあります。どのプロトコルのパケットで終わっているかを確認します。', '「応答がない」と「拒否された」は別の失敗です。相手から返ってきたパケットがあるか、あるならどのプロトコルの何かを見比べます。', 'RST、同じSYNの繰り返し、DNSの「No such name」、TLSの Server Hello の後の切断、ICMPの「Destination unreachable」は、それぞれ別の原因を示します。'],
    debrief: '5つの失敗が、キャプチャ上ではそれぞれ違う形で見えることを確かめました。実務で報告するときは「観測：No.3〜5 に同じSeqのSYN、SYN, ACK なし」「仮説：途中のFirewallで破棄」のように、パケット番号付きの観測と仮説を分けて書き、別の観測点のキャプチャやログで仮説を確かめます。', cases: failureCases },
];
