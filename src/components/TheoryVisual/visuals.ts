import { moreVisuals } from './moreVisuals';
import { inlineVisuals } from './inlineVisuals';

/** Small, explicit teaching examples. The prose remains the source of truth; these are not live simulations. */
export interface VisualNode { id: string; x: number; y: number; label: string; detail: string }
export interface VisualEdge { from: string; to: string; label?: string }
export interface VisualStep {
  label: string;
  text: string;
  nodes?: string[];
  edges?: number[];
  facts?: [string, string][];
  blockedNodes?: string[];
  blockedEdges?: number[];
  table?: string[][];
  focusRow?: number;
  bars?: { label: string; parts: { label: string; value: number }[]; note: string }[];
  /** chart: draw the series only up to this x value, so playback reads as time passing. */
  reveal?: number;
  /** chart: a labelled point to look at in this step. */
  mark?: { x: number; y: number; label: string };
}
export interface ChartAxis { label: string; max: number; ticks: number[] }
export interface Visual {
  title: string;
  intro: string;
  kind: 'graph' | 'sequence' | 'layers' | 'subnet' | 'vlsm' | 'routes' | 'rules' | 'compare' | 'bars' | 'chart';
  columns?: string[];
  scale?: { max: number; unit: string; limit?: number };
  bidirectional?: boolean;
  nodes?: VisualNode[];
  edges?: VisualEdge[];
  lanes?: string[];
  messages?: { from: number; to: number; label: string }[];
  layers?: { label: string; detail: string }[];
  groups?: { x: number; y: number; width: number; height: number; label: string }[];
  /** chart: line graph. Axes start at 0. A series is drawn as straight segments between its points. */
  chart?: { x: ChartAxis; y: ChartAxis; series: { label: string; points: [number, number][] }[]; limit?: { y: number; label: string } };
  steps: VisualStep[];
}
const n = (id: string, x: number, y: number, label: string, detail = ''): VisualNode => ({ id, x, y, label, detail });
const e = (from: string, to: string, label?: string): VisualEdge => ({ from, to, label });
const s = (label: string, text: string, nodes: string[] = [], edges: number[] = [], facts?: [string, string][]): VisualStep => ({ label, text, nodes, edges, facts });

export const visuals: Record<string, Visual> = {
  ...moreVisuals,
  ...inlineVisuals,
  encapsulation: {
    title: 'データを包む、4つの層', kind: 'layers',
    intro: '送信側を上から下へたどると、内側のデータを残したまま送り状が増えます。箱の幅は実際のバイト数とは比例しません。',
    layers: [
      { label: 'アプリケーション', detail: 'HTTPのメッセージ' },
      { label: 'トランスポート', detail: 'TCPヘッダ：送信元・宛先ポート、Seq、Ack' },
      { label: 'インターネット', detail: 'IPヘッダ：送信元・宛先IP、TTL' },
      { label: 'リンク', detail: 'Ethernetヘッダ：送信元・宛先MAC ／ 末尾にFCS' },
    ],
    steps: [s('データ', 'アプリケーションが「GET /」などのHTTPメッセージを用意する。'), s('TCPで包む', 'TCPヘッダを付け、相手のどのプログラムへ届けるかをポート番号で表す。'), s('IPで包む', 'IPヘッダを付け、最終的な送り手と届け先を表す。'), s('Ethernetで包む', '次の機器のMACアドレスを付け、フレームとして送る。受信ホストは外側から順に開ける。')],
  },
  handshake: {
    title: 'TCP接続は、3回のやり取りから', kind: 'sequence',
    intro: '上から下へ時間が進みます。Seqは説明用の小さな番号です。SYNは番号を1つ使います。',
    lanes: ['PC1 :49153', 'SRV1 :80'],
    messages: [{ from: 0, to: 1, label: 'SYN' }, { from: 1, to: 0, label: 'SYN + ACK' }, { from: 0, to: 1, label: 'ACK' }],
    steps: [s('接続を頼む', 'PC1が開始番号100を伝える。まだアプリケーションのデータは送っていない。', [], [], [['Seq', '100'], ['PC1の状態', 'SYN-SENT']]), s('応答する', 'SRV1は「次は101がほしい」と応答し、自分の開始番号500も伝える。', [], [], [['Seq', '500'], ['Ack', '101']]), s('確認する', 'PC1も「次は501がほしい」と返す。SRV1がこのACKを受け取ると、両端で接続が成立する。', [], [], [['Seq', '101'], ['Ack', '501']])],
  },
  'subnet-bits': {
    title: '境目を動かして、サブネットを読む', kind: 'subnet',
    intro: 'IPアドレスは192.168.10.70で固定。/の後ろの数を変えて、ネットワーク部と使える範囲を比べてみましょう。',
    steps: [s('/24', '最初の24ビットがネットワーク部。最後の8ビットをホストに使う。'), s('/26', 'ホスト部は6ビット。64アドレスずつの区画になり、.70は.64からの区画に入る。'), s('/27', 'ホスト部は5ビット。32アドレスのうち、両端を除く30個が通常のホスト用。'), s('/28', 'ホスト部は4ビット。同じ.70でも、ブロードキャストは.79へ変わる。')],
  },
  vlsm: {
    title: '大きい部署から、アドレスを切り分ける', kind: 'vlsm',
    intro: '192.168.10.0/24の256アドレスを、必要な台数に応じて割り当てます。横幅はアドレス数に比例します。',
    steps: [s('営業：50台', '/26は64アドレス、通常のホスト用は62個。.0〜.63を営業に割り当てる。'), s('開発：25台', '/27は32アドレス、通常のホスト用は30個。次の境界.64から.95を使う。'), s('総務：10台', '/28は16アドレス、通常のホスト用は14個。.96〜.111を使い、.112〜.255を将来のために残す。')],
  },
  'routing-hops': {
    title: 'IPは届け先、MACは次の相手', kind: 'graph',
    intro: 'NATを使わない例です。各区間を選び、IP・MAC・TTLの変化を比べてください。',
    nodes: [n('pc1', 80, 135, 'PC1', '192.168.1.10'), n('r1', 245, 135, 'R1', 'LAN1の出口'), n('r2', 410, 135, 'R2', 'LAN2の入口'), n('pc2', 575, 135, 'PC2', '192.168.2.10')],
    edges: [e('pc1', 'r1'), e('r1', 'r2'), e('r2', 'pc2')],
    steps: [s('PC1 → R1', '宛先は別のネットワーク。PC1はゲートウェイR1へフレームを送る。', ['pc1', 'r1'], [0], [['宛先IP', '192.168.2.10'], ['宛先MAC', 'R1の受信側'], ['TTL', '64']]), s('R1 → R2', 'R1は経路表を引き、TTLを1減らし、新しいEthernetヘッダでR2へ送る。', ['r1', 'r2'], [1], [['宛先IP', '192.168.2.10'], ['宛先MAC', 'R2の受信側'], ['TTL', '63']]), s('R2 → PC2', 'R2は直接つながるPC2へ送る。Next HopのIPをパケットの宛先IPに書き込むわけではない。', ['r2', 'pc2'], [2], [['宛先IP', '192.168.2.10'], ['宛先MAC', 'PC2'], ['TTL', '62']])],
  },
  'longest-prefix': {
    title: '宛先を変えて、最長一致を確かめる', kind: 'routes',
    intro: '一致する経路のうち、/の数が最も大きい行を選びます。先に見つかった行で決まるわけではありません。',
    steps: [s('192.168.2.10', '/0・/16・192.168.2.0/24が一致する。最も具体的な/24を選ぶ。'), s('192.168.2.200', '/25も一致するため、192.168.2.128/25を選ぶ。'), s('192.168.3.10', '192.168.3.0/24が最も具体的な一致になる。'), s('203.0.113.80', '具体的な経路には一致しない。0.0.0.0/0のDefault Routeを選ぶ。')],
  },
  arp: {
    title: 'ARP：みんなに聞いて、本人が答える', kind: 'graph',
    intro: '同じVLAN内の例です。スイッチは受信ポート以外へARP要求を広げます。',
    nodes: [n('pc1', 90, 140, 'PC1', '192.168.10.11'), n('sw', 315, 140, 'SW1', '同じVLAN'), n('pc3', 555, 60, 'PC3', '192.168.10.13'), n('other', 555, 235, '別のPC', '192.168.10.14')],
    edges: [e('pc1', 'sw'), e('sw', 'pc3'), e('sw', 'other'), e('pc3', 'sw'), e('sw', 'pc1')],
    steps: [s('要求を送る', 'PC1が「192.168.10.13は誰？」とブロードキャストする。', ['pc1', 'sw'], [0], [['宛先MAC', 'ff:ff:ff:ff:ff:ff']]), s('VLAN内へ広げる', '要求は同じVLANへ届く。IPが一致しないPCは、この質問には答えない。', ['sw', 'pc3', 'other'], [1, 2]), s('本人が応答する', 'PC3が自分のMACをPC1へユニキャストで返す。PC1は対応をARPキャッシュに覚える。', ['pc3', 'sw', 'pc1'], [3, 4], [['対応', '192.168.10.13 → PC3のMAC']])],
  },
  vlan: {
    title: '同じスイッチでも、VLANが違えば別のLAN', kind: 'graph',
    intro: '囲みは論理的なグループ。VLANを選び、ブロードキャストが届く範囲を確認しましょう。',
    groups: [{ x: 15, y: 15, width: 305, height: 260, label: 'VLAN 10・営業' }, { x: 340, y: 15, width: 305, height: 260, label: 'VLAN 20・開発' }],
    nodes: [n('a', 90, 100, 'PC1', 'VLAN 10'), n('b', 245, 210, 'PC3', 'VLAN 10'), n('c', 415, 100, 'PC2', 'VLAN 20'), n('d', 570, 210, 'PC4', 'VLAN 20')],
    edges: [e('a', 'b', '同じLAN'), e('c', 'd', '同じLAN')],
    steps: [s('VLAN 10', 'PC1からのブロードキャストはVLAN 10のPC3へ届く。VLAN 20へは流れない。', ['a', 'b'], [0]), s('VLAN 20', 'PC2からのブロードキャストはVLAN 20内に限定される。VLAN間のIP通信にはルータやL3スイッチが必要。', ['c', 'd'], [1])],
  },
  'dns-lookup': {
    title: 'DNS：問い合わせを進めるのはリゾルバ', kind: 'sequence',
    intro: 'キャッシュが空の例。ルートとTLDは次の問い合わせ先を案内し、権威DNSが答えを返します。',
    lanes: ['PC1', 'リゾルバ', 'ルート', 'com', '権威DNS'],
    messages: [{ from: 0, to: 1, label: '質問' }, { from: 1, to: 2, label: '質問' }, { from: 2, to: 1, label: 'comへ' }, { from: 1, to: 3, label: '質問' }, { from: 3, to: 1, label: '権威へ' }, { from: 1, to: 4, label: '質問' }, { from: 4, to: 1, label: 'Aの答え' }, { from: 1, to: 0, label: '回答' }],
    steps: [s('PCの依頼', 'PC1がリゾルバへwww.example.comのIPを尋ねる。'), s('ルートへ', 'リゾルバがルートDNSへ問い合わせる。'), s('comの案内', 'ルートDNSはcomのDNSサーバーを案内する。'), s('comへ', 'リゾルバがcomのDNSサーバーへ問い合わせる。'), s('権威の案内', 'comのDNSサーバーはexample.comの権威DNSを案内する。'), s('権威へ', 'リゾルバがexample.comの権威DNSへ問い合わせる。'), s('答えを取得', '権威DNSがwww.example.comのAレコード、203.0.113.80を返す。'), s('PCへ回答', 'リゾルバが答えをキャッシュし、PC1に203.0.113.80を返す。')],
  },
  'dns-cache': {
    title: 'TTLが残っている間は、前の答えを使う', kind: 'graph',
    intro: 'TTL 300秒のAレコードを受け取った例。時刻を進めると、権威DNSの変更がいつ見えるかがわかります。',
    nodes: [n('pc', 90, 140, 'PC1', '名前を引く'), n('cache', 330, 140, 'リゾルバ', '答えを保存'), n('auth', 570, 140, '権威DNS', 'レコードを管理')],
    edges: [e('auth', 'cache'), e('cache', 'pc'), e('cache', 'auth')],
    steps: [s('0秒：取得', '権威DNSから古いIP .80を取得し、300秒のTTLで保存する。', ['cache', 'auth'], [0], [['キャッシュ', '203.0.113.80'], ['残りTTL', '300秒']]), s('100秒：変更', '権威DNSを.90へ変えても、保存済みの答えが一斉に消えるわけではない。', ['auth'], [], [['権威DNS', '203.0.113.90'], ['残りTTL', '200秒']]), s('200秒：再利用', 'リゾルバは有効なキャッシュの.80を返す。この問い合わせでは権威DNSへ聞き直さない。', ['cache', 'pc'], [1], [['PCへの回答', '203.0.113.80'], ['残りTTL', '100秒']]), s('期限後：再取得', '期限後の問い合わせで権威DNSへ聞き直し、新しい.90を取得する。', ['cache', 'auth'], [2, 0], [['新しい回答', '203.0.113.90'], ['再取得後のTTL', '300秒（この例）']])],
  },
  pat: {
    title: 'PAT：ポート番号で、返事の相手を区別する', kind: 'graph',
    intro: '本文の例です。PC1とPC2が、どちらも送信元ポート49152でWEBへ接続します。外側のIPが1つでも、変換後のポートが目印になります。',
    nodes: [n('a', 100, 65, 'PC1', '192.168.1.10'), n('b', 100, 235, 'PC2', '192.168.1.11'), n('nat', 330, 145, 'FW', '203.0.113.2'), n('web', 570, 145, 'WEB', '198.51.100.80:80')],
    edges: [e('a', 'nat'), e('b', 'nat'), e('nat', 'web'), e('web', 'nat'), e('nat', 'b')],
    steps: [s('PC1の通信', 'PC1の送信元IPを外側の203.0.113.2へ書き換える。49152番はまだ空いているので、ポートはそのまま使う。', ['a', 'nat', 'web'], [0, 2], [['Inside local', '192.168.1.10:49152'], ['Inside global', '203.0.113.2:49152']]), s('PC2の通信', 'PC2も49152を選んだが、203.0.113.2の49152番はPC1が使用中。FWは空いている1024番を割り当てる。', ['b', 'nat', 'web'], [1, 2], [['Inside local', '192.168.1.11:49152'], ['Inside global', '203.0.113.2:1024']]), s('PC2への返事', '1024番宛ての返事をNATテーブルで照合し、宛先をPC2のIPと元のポートへ戻す。', ['web', 'nat', 'b'], [3, 4], [['返事の宛先', '203.0.113.2:1024'], ['変換後', '192.168.1.11:49152']])],
  },
  firewall: {
    title: 'ルールは上から、最初の一致で決まる', kind: 'rules',
    intro: '図の例は「特定ホストを拒否 → Webを許可 → その他を拒否」。送信元を変えると、同じポート80でも結果が変わります。',
    steps: [s('許可されるWeb', '192.168.1.10 → TCP/80。1行目は不一致、2行目で許可される。3行目までは調べない。'), s('拒否対象のWeb', '192.168.1.20 → TCP/80。1行目で拒否される。後ろにWebの許可があっても覆らない。'), s('その他の通信', '192.168.1.10 → TCP/22。1・2行目に一致せず、最後のdenyで拒否される。')],
  },
  'linux-ladder': {
    title: '「つながらない」を、下から積み上げて調べる', kind: 'graph',
    intro: '本文の8段のはしごです。各段を選ぶと、確かめる対象とコマンドが切り替わります。成功した観測から、次の段へ進みます。',
    nodes: [n('nic', 85, 65, '1. NIC', 'ip link'), n('ip', 245, 65, '2. IP', 'ip addr'), n('arp', 415, 65, '3. ARP', 'ip neigh'), n('route', 575, 65, '4. Route', 'ip route'), n('app', 85, 235, '8. Application', 'curl -v / ログ'), n('tls', 245, 235, '7. TLS', 'curl -v https://'), n('tcp', 415, 235, '6. TCP', 'nc -zv / ss'), n('dns', 575, 235, '5. DNS', 'dig')],
    edges: [e('nic', 'ip'), e('ip', 'arp'), e('arp', 'route'), e('route', 'dns'), e('dns', 'tcp'), e('tcp', 'tls'), e('tls', 'app')],
    steps: [s('NIC', '管理状態UPと物理リンクを確認する。IPを直しても、抜けたケーブルは直らない。', ['nic']), s('IP', '自分のアドレスとプレフィックス長が正しいかを確認する。', ['ip'], [0]), s('ARP', '同じLANの相手やGatewayのMACアドレスが引けるかを確認する。', ['arp'], [1]), s('Route', '宛先への経路とDefault Gatewayを確認する。帰りの経路も必要。', ['route'], [2]), s('DNS', '名前を意図したIPへ解決できるか確認する。DNSの失敗とIPの到達性を分ける。', ['dns'], [3]), s('TCP', '対象ポートに接続できるか、サーバーが待ち受けているかを確かめる。', ['tcp'], [4]), s('TLS', '証明書が、接続に使った名前に合っているかを確かめる。', ['tls'], [5]), s('Application', 'HTTPステータスとアプリのログを読む。503ならHTTPの応答は届いているので、原因はネットワークより上にある。', ['app'], [6])],
  },
  'listen-address': {
    title: 'どのアドレスで待ち受けるかで、届く相手が変わる', kind: 'graph',
    intro: 'IPv4の待受アドレスを比較します。経路・Firewallが許可されていることを前提にした図です。',
    groups: [{ x: 235, y: 15, width: 410, height: 270, label: 'Webサーバー内部' }],
    nodes: [n('remote', 85, 155, '別のPC', '外部から接続'), n('nic', 330, 155, 'サーバーのNIC', 'LAN側のIP'), n('local', 555, 80, '同じサーバー', 'localhostへ接続'), n('service', 555, 235, 'Webサービス', 'TCP/80')],
    edges: [e('remote', 'nic'), e('nic', 'service'), e('local', 'service')],
    steps: [s('127.0.0.1:80', 'ループバックだけで待つ。同じサーバーからは届いても、別のPCがLAN側IPへ接続してもこの待受には届かない。', ['local', 'service'], [2], [['ssのLocal Address', '127.0.0.1:80']]), s('0.0.0.0:80', 'すべてのローカルIPv4アドレスで待つ。LAN側IP宛ての接続も受け付けられる。0.0.0.0を接続先にするという意味ではない。', ['nic', 'local', 'service', 'remote'], [0, 1, 2], [['ssのLocal Address', '0.0.0.0:80']])],
  },
  'capture-layers': {
    title: 'キャプチャを、外側の箱から開ける', kind: 'layers',
    intro: 'Ethernet上のIPv4/TCP/HTTPの例。選んだ層で、どの問いに答えられるかを確認します。',
    layers: [{ label: 'Ethernet', detail: 'その区間の送信元MAC・宛先MAC' }, { label: 'IPv4', detail: '送信元IP・宛先IP・TTL' }, { label: 'TCP', detail: '送信元ポート・宛先ポート・Seq・Ack・フラグ' }, { label: 'HTTP', detail: 'リクエストやレスポンスの内容' }],
    steps: [s('Ethernet', 'このリンクで誰から誰へ送られたか。遠くのサーバー宛てでも、宛先MACは隣のルータの場合がある。'), s('IPv4', 'どのIP間の通信か。TTLから、その観測点に到達した時点の残りホップ数も読める。'), s('TCP', 'どのポート間で、接続のどの段階か。SYN・ACK・RSTやSeq/Ackを確認する。'), s('HTTP', '暗号化されていないHTTPなら内容を読める。TLSで暗号化されたアプリデータは、そのままでは読めない。')],
  },
  'tcp-sequence': {
    title: 'Ackは「次にほしいバイトの番号」', kind: 'sequence',
    intro: '接続成立後の例です。データを100バイト、続けて50バイト送り、受信側がそれぞれ確認応答します。',
    lanes: ['送信側', '受信側'],
    messages: [{ from: 0, to: 1, label: 'Seq 101・100 B' }, { from: 1, to: 0, label: 'Ack 201' }, { from: 0, to: 1, label: 'Seq 201・50 B' }, { from: 1, to: 0, label: 'Ack 251' }],
    steps: [s('100 Bを送る', 'Seq 101から100バイト、番号101〜200のデータを送る。'), s('201を要求', '200まで連続して受信したのでAck 201。201番のデータを受信済み、という意味ではない。'), s('50 Bを送る', '次のSeqは201。50バイトなので番号201〜250を送る。'), s('251を要求', '250まで連続して受信したのでAck 251。データもSYN/FINもないACKだけのセグメントは、シーケンス番号を消費しない。')],
  },
  'topology-path': {
    title: 'スイッチを越えるとき、ルータを越えるとき', kind: 'graph',
    intro: 'PC → スイッチ → ルータ → サーバーという構成を簡略化した例。役割の違いをヘッダの変化で見ます。',
    nodes: [n('pc', 85, 140, 'PC1', 'VLAN 10'), n('sw', 250, 140, 'SW1', 'L2スイッチ'), n('r', 415, 140, 'R1', 'VLAN間ルーティング'), n('srv', 580, 140, 'SRV1', '別のネットワーク')],
    edges: [e('pc', 'sw'), e('sw', 'r'), e('r', 'srv')],
    steps: [s('PCから送信', 'PC1は遠くのSRV1宛てのIPパケットを、ゲートウェイR1のMAC宛てに包む。', ['pc', 'sw'], [0], [['宛先MAC', 'R1'], ['TTL', '64']]), s('L2で中継', 'SW1はVLANと宛先MACから出口を決める。L2スイッチを通るだけではIPのTTLは減らない。', ['sw', 'r'], [1], [['宛先MAC', 'R1のまま'], ['TTL', '64のまま']]), s('L3で中継', 'R1は宛先IPで経路を選び、TTLを減らす。別のEthernetフレームに包んでサーバー側へ出す。', ['r', 'srv'], [2], [['宛先MAC', 'SRV1'], ['TTL', '63']])],
  },
  redundancy: {
    title: '経路が2本でも、共有する機器が止まると？', kind: 'graph',
    intro: '2つの経路が同じ出口ルータを使う例です。障害箇所を切り替え、残る道を確かめましょう。',
    nodes: [n('src', 85, 145, '送信元', '分岐の手前'), n('a', 310, 60, '経路A', '中継機器A'), n('b', 310, 235, '経路B', '中継機器B'), n('exit', 555, 145, '共通の出口', '1台のルータ')],
    edges: [e('src', 'a'), e('a', 'exit'), e('src', 'b'), e('b', 'exit')],
    steps: [s('正常', 'A・Bの2経路が使える。しかし、どちらも最後は同じ出口に依存している。', ['src', 'a', 'b', 'exit'], [0, 1, 2, 3]), s('Aが故障', '経路Bは残る。障害検出と経路の切り替えが済めば、B経由で通信を続けられる。', ['src', 'b', 'exit'], [2, 3], [['故障箇所', '中継機器A'], ['残る経路', 'B']]), s('出口が故障', 'A・Bが正常でも、出口が止まれば両方とも届かない。この共通の出口が単一障害点。', [], [], [['故障箇所', '共通の出口'], ['結果', '両経路とも通信不可']])],
  },
  'aws-public': {
    title: '「パブリック」は、経路とアドレスの組み合わせ', kind: 'graph',
    intro: 'IPv4でインターネットからEC2へ届くまで。囲みはVPCとサブネットの境界です。',
    groups: [{ x: 190, y: 15, width: 455, height: 270, label: 'VPC 10.0.0.0/16' }, { x: 390, y: 65, width: 240, height: 205, label: 'パブリックサブネット' }],
    nodes: [n('net', 85, 155, 'Internet', 'クライアント'), n('igw', 275, 155, 'IGW', 'VPCに接続'), n('ec2', 510, 155, 'EC2', 'プライベートIP')],
    edges: [e('net', 'igw'), e('igw', 'ec2'), e('ec2', 'igw'), e('igw', 'net')],
    steps: [s('経路', 'サブネットのルートテーブルに0.0.0.0/0 → IGWを設定する。この経路がパブリックサブネットの条件。', ['ec2', 'igw'], [2], [['Default Route', '0.0.0.0/0 → IGW']]), s('アドレス', 'EC2にはパブリックIPv4またはElastic IPも必要。IGWでプライベートIPとの対応が扱われる。', ['net', 'igw', 'ec2'], [0, 1], [['EC2', 'パブリックIPv4あり']]), s('フィルタと返事', 'SG・NACL・OSのFirewall・待受も確認する。帰りはEC2からIGWへのルートを使う。', ['ec2', 'igw', 'net'], [2, 3], [['追加の条件', '必要な通信を許可・サービス待受']])],
  },
  'aws-filters': {
    title: 'SGは接続を覚え、NACLは往復を別に判定する', kind: 'sequence',
    intro: 'クライアントの一時ポート50000からEC2のTCP/443へ接続する例。図はフィルタの判定に絞っています。',
    lanes: ['Client', 'NACL', 'SG', 'EC2 :443'],
    messages: [{ from: 0, to: 1, label: '要求' }, { from: 1, to: 2, label: '許可' }, { from: 2, to: 3, label: '許可' }, { from: 3, to: 2, label: '返事' }, { from: 2, to: 1, label: '応答通信' }, { from: 1, to: 0, label: '許可' }],
    steps: [s('NACL inbound', '宛先TCP/443の要求を、NACLのinboundルールで許可する。'), s('SG inbound', 'SGでも送信元とTCP/443を許可する必要がある。'), s('接続を追跡', 'SGで許可された要求が、EC2で待ち受けるサービスへ届く。SGは接続を追跡する。'), s('返事を送る', '返事の送信元は443、宛先はクライアントの一時ポート50000になる。'), s('SGの返事', '許可した接続への応答は、SGのoutboundルールに関係なく許可される。'), s('NACL outbound', 'NACLは接続を覚えない。宛先50000を含む戻りの通信をoutboundで明示的に許可する。')],
  },
  'vpn-envelope': {
    title: 'VPN：内側の宛先と、外側の宛先', kind: 'layers',
    intro: 'ESPトンネルモードの概念図です。フィールドの幅・配置は実際のバイト配置を表しません。',
    layers: [{ label: '元のデータ', detail: '拠点のPCから、クラウドのサーバーへ' }, { label: '内側のIPパケット', detail: '内側IP：プライベートIP同士の通信' }, { label: 'ESPで保護', detail: '元のIPパケットを暗号化・改ざん検知' }, { label: '外側のIPヘッダ', detail: '外側IP：VPNゲートウェイ同士の通信' }],
    steps: [s('拠点で送信', 'PCはいつも通り、クラウドのプライベートIP宛てにデータを用意する。'), s('内側の宛先', '元のIPパケットには、PCとサーバーのIPが書かれている。'), s('暗号化', 'VPNゲートウェイがESPで元のIPパケットを保護する。途中では内側の宛先を読めない。'), s('インターネットへ', '外側IPの宛先は相手のVPNゲートウェイ。出口で復号・取り出しを行い、内側の宛先へ転送する。')],
  },
  'bgp-path': {
    title: 'AS_PATHは、広告が通ってきたASの並び', kind: 'graph',
    intro: '3つのASでのeBGP広告の例。矢印は経路情報が伝わる向きで、データパケットの流れではありません。',
    nodes: [n('a', 95, 145, 'AS 65000', '経路の発信元'), n('b', 330, 145, 'AS 65001', '中継するAS'), n('c', 565, 145, 'AS 65002', '受信するAS')],
    edges: [e('a', 'b'), e('b', 'c'), e('b', 'a')],
    steps: [s('最初の広告', 'AS 65000が自分の経路をAS 65001へ広告すると、自分のASNを先頭に付ける。', ['a', 'b'], [0], [['受信したAS_PATH', '65000']]), s('次のASへ', 'AS 65001がAS 65002へ広告すると、さらに自分のASNを先頭に足す。左が直近、右が発信元。', ['b', 'c'], [1], [['受信したAS_PATH', '65001 65000']]), s('自分に戻ったら', '仮に65001 65000という広告がAS 65000へ戻ってきても、自分のASNを含むので受け入れない。', ['a'], [2], [['判定', '自分のASを含む → 拒否']])],
  },
  'terraform-cycle': {
    title: 'コードから実物へ。planとapplyの境界', kind: 'graph',
    intro: 'コマンドを順に選んで、準備・確認・変更のどの段階かを確かめましょう。',
    nodes: [n('code', 95, 65, 'HCL', '望む構成'), n('init', 325, 65, 'init', '実行の準備'), n('validate', 555, 65, 'validate', '構成を検証'), n('state', 95, 235, 'state', 'IDとの対応を記録'), n('apply', 325, 235, 'apply', '実物を変更'), n('plan', 555, 235, 'plan', '差分を予告')],
    edges: [e('code', 'init'), e('init', 'validate'), e('validate', 'plan'), e('plan', 'apply'), e('apply', 'state')],
    steps: [s('init', '必要なプロバイダなどを準備する。HCLに書いたVPCを作る操作ではない。', ['code', 'init'], [0]), s('validate', '構成の構文や内部の整合性を検証する。実際に作成できるかのすべてを保証するものではない。', ['validate'], [1]), s('plan', '構成・state・実環境の情報をもとに、作成や変更の差分を確認する。この時点でリソースは変更しない。', ['plan'], [2], [['読む記号', '+ 作成 / ~ 変更 / -/+ 置換 / - 削除']]), s('apply', '確認した変更を実行する。プロバイダを通してリソースを作成・更新する。', ['apply'], [3]), s('state', 'Terraform上のリソース名と実物のIDの対応を保存し、次回のplanに使う。', ['state'], [4])],
  },
  'terraform-deps': {
    title: '参照が決める、リソースの作成順', kind: 'graph',
    intro: '矢印は「先に必要なもの → それを参照するもの」。ファイルに書いた行の順番ではありません。',
    nodes: [n('vpc', 95, 145, 'VPC', 'aws_vpc.main'), n('subnet', 330, 65, 'Subnet', 'vpc_idを参照'), n('sg', 330, 235, 'Security Group', 'vpc_idを参照'), n('ec2', 565, 145, 'EC2', 'subnet_id / SGを参照')],
    edges: [e('vpc', 'subnet'), e('vpc', 'sg'), e('subnet', 'ec2'), e('sg', 'ec2')],
    steps: [s('VPCを作る', 'まだ何も作っていない例。まずVPCを作り、実際のIDが決まる。', ['vpc'], [], [['参照式の例', 'aws_vpc.main.id']]), s('SubnetとSG', 'VPCのIDを使ってSubnetとSGを作る。この2つの間には、この図では依存関係がないので並行して作成できる。', ['subnet', 'sg'], [0, 1]), s('EC2を作る', 'SubnetとSGのIDがそろってからEC2を作る。参照式から、Terraformがこの順番を判断する。', ['ec2'], [2, 3])],
  },
};
