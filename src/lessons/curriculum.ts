import type { ChapterId } from '../labs/types';

export interface QuizQuestion { question: string; options: string[]; answer: number; explanation: string }
export interface Chapter {
  id: Exclude<ChapterId, 'capstone'>;
  dir: string;
  title: string;
  subtitle: string;
  level: 'FOUNDATION' | 'CORE NETWORKING' | 'PRACTICE' | 'PROFESSIONAL';
  available: boolean;
  goal: string;
  minutes: number;
  playground: { text: string; to: string; label: string };
  quiz: QuizQuestion[];
  /** 'form' chapters use the built-in observation / calculation checks; others a mastery lab. */
  mastery: { type: 'lab'; labId: string } | { type: 'form' };
}

export const curriculum: Chapter[] = [
  { id: 'tcp-ip', dir: '01-tcp-ip', title: 'TCP / IPのきほん', subtitle: 'レイヤーとカプセル化をつかむ', level: 'FOUNDATION', available: true, minutes: 40, goal: 'Webページを開くときに流れるパケットを、層（レイヤー）ごとに分けて説明できる。',
    playground: { text: 'DNSサーバーとWebサーバーがある構成を開きます。Terminalで「dig www.example.com」や「curl -v https://www.example.com/」を実行し、DNS・TCP・TLS・HTTPのパケットが別々に流れる様子を確かめましょう。', to: '/simulator?template=dns', label: 'DNS / Webのテンプレートを開く' },
    mastery: { type: 'form' },
    quiz: [
      { question: 'PC1で「ping 192.168.2.10」を実行しました。送られるICMP Echo Requestは、どの中に入って運ばれますか？', options: ['TCPセグメントの中', 'IPv4パケットの中（TCPやUDPを使わず直接）', 'HTTPリクエストの中'], answer: 1, explanation: 'ICMPは、IPパケットの中に直接入ります（IPヘッダのProtocol欄は1）。TCPやUDPを使わないので、pingにはポート番号も3-way handshakeもありません。TCPの中に入るのは、WebやSSHなどの通信です。' },
      { question: 'クライアントがWebサーバーにTCPで接続を始めます。3-way handshake（接続を始める3回のやり取り）で、2番目にサーバーから返るセグメントはどれですか？', options: ['SYN', 'SYN, ACK', 'ACK', 'FIN'], answer: 1, explanation: '順番は SYN → SYN, ACK → ACK です。2番目でサーバーは、自分の始まりの番号（SYN）と「あなたのSYNを受け取った」という確認（ACK）を、1つのセグメントで返します。ACKだけを送るのは3番目のクライアントで、FINは接続を終えるときの合図です。' },
      { question: 'NATを使っていない構成で、パケットがルータを1台通過しました。ルータの前後で変わるものはどれですか？', options: ['送信元IPアドレス', '宛先IPアドレス', 'Ethernetの送信元・宛先MACアドレスと、IPヘッダのTTL', 'TCPの宛先ポート'], answer: 2, explanation: 'ルータはEthernetヘッダを外し、次のケーブル用に新しいMACアドレスで付け直します。あわせてTTLを1減らします。IPアドレスは「最終的な届け先の住所」なので、NATがなければ宛先も送信元も変わりません。' },
      { question: 'ブラウザが www.example.com のIPアドレスをDNSサーバーに問い合わせます。通常使われるプロトコルとポート番号はどれですか？', options: ['UDPの53番（応答が大きいときなどはTCPの53番）', 'TCPの80番', 'ICMP（ポート番号なし）', 'TCPの443番だけ'], answer: 0, explanation: 'DNSの問い合わせは、確認のやり取りを省いて身軽に送れるUDPの53番が基本です。応答が大きいときなどは、TCPの53番も使います。TCPの443番は、名前を調べた後のHTTPS接続で使うポートです。' },
      { question: 'Webページが開けないと相談されました。サーバーへのpingは成功しています。pingの成功から確実に言えることはどれですか？', options: ['TLS証明書が正しい', 'Webサーバーのプロセスが動いている', 'ICMPのEcho RequestとEcho Replyが往復できる経路がある', 'TCPの443番で接続を受け付けている'], answer: 2, explanation: 'pingからわかるのは、ICMPが行って帰ってこられる経路があることだけです。TCPの443番が開いているか、証明書が正しいか、Webサーバーが動いているかは、別に確かめます。「pingが通るからWebも大丈夫」は、よくある誤解です。' },
    ] },
  { id: 'subnet', dir: '02-subnet', title: 'IPアドレスとサブネット', subtitle: 'ネットワークの境界を計算する', level: 'FOUNDATION', available: true, minutes: 45, goal: 'IPアドレスとプレフィックス長から、ネットワークアドレス・ブロードキャストアドレス・使えるホストの範囲を計算できる。',
    playground: { text: 'Visualステップのサブネット計算機・VLSMプランナー・練習問題を使います。プレフィックス長を1つずつ変えて、ネットワークアドレスやホストの範囲がどう変わるかを確かめましょう。', to: '/learn/subnet?stage=1', label: 'Visualのツールを開く' },
    mastery: { type: 'form' },
    quiz: [
      { question: 'PCに 192.168.10.70/27 を設定しました。同じサブネットの中で、別のPCに割り当てられるアドレスはどれですか？', options: ['192.168.10.64', '192.168.10.94', '192.168.10.96'], answer: 1, explanation: '/27は32個ずつのブロックなので、192.168.10.70 は .64〜.95 のサブネットに入ります。.64はネットワークアドレス、.95はブロードキャストアドレスなので、PCに使えるのは .65〜.94 です。.96は隣の番号ですが、次のサブネット（192.168.10.96/27）の先頭です。' },
      { question: 'ゲートウェイ（ルータ）を含めて100台をつなぐLANを作ります。100台が入る中で、いちばん小さいサブネットになるプレフィックス長はどれですか？', options: ['/26', '/25', '/24', '/27'], answer: 1, explanation: '/25は使えるホストが126台なので、100台が入ります。/26は62台までなので足りません。/24（254台）でも入りますが、必要以上に大きくなります。' },
      { question: '次のうち、プライベートアドレス（組織の中で自由に使えるアドレス）の範囲に含まれないものはどれですか？', options: ['10.20.30.40', '172.31.0.1', '172.32.0.1', '192.168.255.1'], answer: 2, explanation: '172で始まるプライベートアドレスは 172.16.0.0/12、つまり 172.16.0.0〜172.31.255.255 です。172.32.0.1 はこの範囲の外です。172.31.0.1 は範囲の最後のブロックに入るので、プライベートアドレスです。' },
      { question: 'IPv6の説明として正しいものはどれですか？', options: ['ブロードキャストで相手のMACアドレスを調べる', 'LANのサブネットは原則 /64 にする', 'ルータが大きすぎるパケットを分割する', 'アドレスの長さは64ビット'], answer: 1, explanation: 'IPv6のLANは原則 /64 で、後半64ビットがインターフェースID（ホスト部にあたる部分）です。アドレス全体は128ビットなので、「64ビット」は誤りです。ブロードキャストはなくNDP（近隣探索）を使い、パケットの分割も送信元だけが行います。' },
      { question: 'VLSM（用途ごとに違う大きさで切り分ける方法）で、192.168.10.0/24 を部署ごとに分けます。隙間や重なりを作りにくい割り当ての順番はどれですか？', options: ['小さいサブネットから順に', '大きいサブネットから順に', '部署名の五十音順', 'どの順番でも結果は同じ'], answer: 1, explanation: '各ブロックは、自分のサイズの倍数の位置からしか始められません。大きい順に置けば、前のブロックの終わりが次の境目に必ずそろいます。小さい順に置くと境目がずれ、隙間や重なりが生まれやすくなります。' },
    ] },
  { id: 'routing', dir: '03-routing', title: 'ルーティング', subtitle: '経路表で次の行き先を決める', level: 'FOUNDATION', available: true, minutes: 60, goal: '経路表を読んで、パケットが次にどのルータへ渡され、どこで止まったかを説明できる。',
    playground: { text: 'OSPF（ルータどうしが経路を自動で交換する仕組み）で4台のルータをつないだ構成を開きます。ケーブルをダブルクリックしてリンクを切り、「show ip route」で経路が迂回路に切り替わる様子を確かめましょう。', to: '/simulator?template=ospf', label: 'OSPFテンプレートを開く' },
    mastery: { type: 'lab', labId: 'routing-01' },
    quiz: [
      { question: 'PC1 – R1 – R2 – PC2 の構成で、R1だけにPC2側（192.168.2.0/24）への経路を追加しました。Echo RequestはPC2に届くのに、pingは失敗します。原因はどれですか？', options: ['TCPの3-way handshakeが終わっていない', 'R2に、PC1側（192.168.1.0/24）へ戻る経路がない', 'PC1が、PC2のMACアドレスをARPで調べていない'], answer: 1, explanation: 'pingは、Echo Replyが送信元に戻って初めて成功します。R2は192.168.1.0/24を知らないので、PC2からのReplyを捨ててしまいます。PC1がARPで調べるのは同じリンクにいるR1だけで、PC2のMACアドレスは必要ありません（pingはTCPも使いません）。' },
      { question: 'ルータの経路表に 0.0.0.0/0、10.0.0.0/8、10.1.0.0/16、10.1.2.0/24 の4つの経路があります。宛先 10.1.2.3 のパケットに使われる経路はどれですか？', options: ['0.0.0.0/0', '10.0.0.0/8', '10.1.0.0/16', '10.1.2.0/24'], answer: 3, explanation: '4つとも宛先に一致しますが、ルータは最も長く一致する経路を選びます（Longest Prefix Match）。/24が最も範囲が狭く具体的なので、10.1.2.0/24が使われます。0.0.0.0/0は、ほかに一致する経路がないときだけ使われます。' },
      { question: 'ルータが 192.168.2.0/24 への経路を、Static Route（AD 1）とOSPF（AD 110）の両方で知っています。プレフィックス長は同じです。使われるのはどちらですか？', options: ['Static Route', 'OSPFの経路', '両方を使って負荷分散する', 'Metricが小さいほう'], answer: 0, explanation: 'プレフィックス長が同じなら、次にAD（Administrative Distance：情報源の信頼度）を比べ、小さいほうを使います。StaticのAD 1はOSPFの110より小さいので、Staticが選ばれます。Metricは同じプロトコルの経路どうしで比べる値で、StaticとOSPFの間では比べません。' },
      { question: '2台のルータでOSPFを設定しましたが、「show ip ospf neighbor」に相手が表示されず、経路も交換されません。原因として考えられるものはどれですか？', options: ['インターフェースのエリア番号が相手と違う', 'Router IDの値が大きい', 'リンクのコスト（Metric）が大きい', '経路表の行数が多い'], answer: 0, explanation: 'OSPFのルータは、同じリンクの相手とHelloを交換して隣接（Neighbor）になります。エリア番号やサブネットが一致しないと隣接にならず、経路も交換されません。コストが大きいとその経路が選ばれにくくなるだけで、隣接はできます。' },
      { question: '2台のルータが互いにDefault Routeを向け合い、ルーティングループが起きました。それでもパケットが永遠に回り続けないのはなぜですか？', options: ['ルータが自動で経路を直すから', 'TTLが転送のたびに1減り、0になったところで捨てられるから', 'スイッチがループを止めるから', 'ARPが失敗するから'], answer: 1, explanation: 'ルータは転送のたびにTTLを1減らし、0になったパケットを捨てて、送信元にICMPのTime Exceededを返します。ループ自体は自動では直らないので、経路の設定は人が直します。tracerouteで同じルータが交互に表示されたら、ループを疑います。' },
    ] },
  { id: 'ethernet-vlan', dir: '04-ethernet-vlan', title: 'Ethernet / VLAN', subtitle: 'スイッチとVLANでLANを分ける', level: 'CORE NETWORKING', available: true, minutes: 60, goal: 'スイッチがフレームをどのポートへ出すかを、MACアドレステーブルとVLANから説明できる。',
    playground: { text: '2台のスイッチをトランク（複数のVLANを運ぶリンク）でつなぎ、1台のルータでVLAN間をつなぐ構成（Router on a Stick）を開きます。pingの後にスイッチで「show mac address-table」や「show vlan brief」を実行し、どのVLANのどのポートで学習されたかを確かめましょう。', to: '/simulator?template=vlan', label: 'VLANテンプレートを開く' },
    mastery: { type: 'lab', labId: 'vlan-02' },
    quiz: [
      { question: 'スイッチのg0/1に、PC1からフレームが届きました。スイッチがMACアドレステーブルに記録（学習）するのはどれですか？', options: ['宛先MACアドレスと受信ポート', '送信元MACアドレスと受信ポート', '宛先IPアドレスと送信ポート', '送信元IPアドレスと受信ポート'], answer: 1, explanation: 'スイッチは、機器がどのポートの先にいるかを、その機器が送ってきたフレームからしか知ることができません。そのため、送信元MACアドレスを受信ポート（とVLAN）に結び付けて記録します。宛先MACアドレスは、記録済みのテーブルを引いて転送先を決めるときに使います。' },
      { question: 'スイッチが受け取ったフレームの宛先MACアドレスが、MACアドレステーブルにまだありません。スイッチはこのフレームをどうしますか？', options: ['破棄する', '同じVLANの、受信ポート以外のすべてのポートへ送る（フラッディング）', 'ルータへ送る', 'ARPで宛先を問い合わせる'], answer: 1, explanation: '宛先がどのポートの先にいるかわからないので、同じVLANの受信ポート以外のすべてのポートへ送ります。これをフラッディングと呼びます。フレームを転送するためにスイッチがARPを送ることはありません。ARPは、IPアドレスからMACアドレスを調べたいPCやルータが送るものです。' },
      { question: 'PC-A（192.168.10.11/24）をVLAN 10のアクセスポートに、PC-B（192.168.10.12/24）をVLAN 20のアクセスポートにつなぎました。IPアドレスは同じサブネットです。PC-AからPC-Bへpingするとどうなりますか？', options: ['通信できる', 'ARPが届かず、通信できない', 'ルータが自動で転送して、通信できる', 'IPアドレスが自動で変わる'], answer: 1, explanation: 'VLANが違うとブロードキャストドメインが分かれるので、PC-AのARP Request（ブロードキャスト）はPC-Bに届きません。PC-BのMACアドレスがわからず、フレームを送れません。PC-Aは同じサブネットの相手には直接送ろうとするので、ルータにも渡しません。' },
      { question: 'スイッチどうしをつなぐトランクポートで、802.1Qタグを付けずに送受信されるのはどのVLANのフレームですか？', options: ['VLAN 1だけ', 'ネイティブVLAN', 'すべてのVLAN', '許可リストにないVLAN'], answer: 1, explanation: 'トランク上でタグを付けずに運ぶのは、ネイティブVLANのフレームです。Cisco機器の既定はVLAN 1ですが、設定で変えられるので「VLAN 1だけ」とは限りません。両端でネイティブVLANが違うと、相手側では別のVLANとして受け取られ、VLAN間でフレームが漏れます。' },
      { question: 'スイッチ3台を三角形につなぐと、STP（Spanning Tree Protocol）が一部のポートの転送を止めます。その目的はどれですか？', options: ['帯域を節約するため', 'L2のループで起きるブロードキャストストームを防ぐため', 'VLANを分けるため', 'MACアドレスの学習を止めるため'], answer: 1, explanation: 'EthernetフレームにはTTLがないので、ループがあるとブロードキャストが複製され続けます（ブロードキャストストーム）。STPは一部のポートの転送を止めて、ループのない木の形にします。LANを分けるのはVLANの役割で、STPの役割ではありません。' },
    ] },
  { id: 'dns', dir: '05-dns', title: 'DNSと名前解決', subtitle: '名前からIPアドレスを調べる', level: 'CORE NETWORKING', available: true, minutes: 50, goal: '名前解決で「誰が誰に問い合わせるか」と、キャッシュ（TTL）のせいで変更の反映が遅れる理由を説明できる。',
    playground: { text: 'Rootサーバー・TLDサーバー・権威DNSサーバー・再帰リゾルバがそろった構成を開きます。PC1で「dig」→「sleep 60」→「dig」の順に実行してTTLが減るのを確かめたり、「dig +trace www.example.com」で委任をたどったりしましょう。', to: '/simulator?template=dns', label: 'DNSテンプレートを開く' },
    mastery: { type: 'lab', labId: 'dns-02' },
    quiz: [
      { question: 'LinuxのPCでは、名前解決の問い合わせ先を /etc/resolv.conf に書きます。ここに書くのは、どの役割のDNSサーバーですか？', options: ['Rootサーバー', '再帰リゾルバ（フルサービスリゾルバ）', '権威DNSサーバー', 'TLDサーバー'], answer: 1, explanation: 'PCの中のスタブリゾルバは自分では聞いて回らず、再帰リゾルバに「答えだけください」と1回頼みます。Root → TLD → 権威サーバーと順に聞いて回るのは、再帰リゾルバの仕事です。Rootサーバーは次に聞く相手を案内するだけで、PCの代わりに最後まで調べてはくれません。' },
      { question: '再帰リゾルバが www.example.com を調べる途中で、comのTLDサーバーに問い合わせました。TLDサーバーが返すのはどれですか？', options: ['www.example.com のAレコード', 'example.com を担当する権威サーバーのNSレコード（とglue）', 'SOAレコードだけ', 'エラー'], answer: 1, explanation: 'TLDサーバーは、www.example.com の答えそのものは持っていません。「example.com は ns1.example.com に聞いて」という案内（委任の応答）として、NSレコードとglue（そのサーバーのアドレス）を返します。Aレコードを返すのは、example.com の権威サーバーです。' },
      { question: '「dig www.example.com」を実行するとTTLは300でした。60秒後にもう一度実行すると、すぐに応答が返り、TTLは240でした。何が起きていますか？', options: ['権威サーバーの処理が速くなった', '再帰リゾルバが、キャッシュから残り時間付きで応答した', 'TTLは毎回ランダムに決まる', 'PCが前回の答えを記憶していた'], answer: 1, explanation: '再帰リゾルバは、答えをTTLの秒数だけキャッシュします。キャッシュから返すときのTTLは残り時間なので、60秒たって240に減っています。digは答えを保存せず毎回リゾルバに問い合わせるので、PCが記憶していたわけではありません。' },
      { question: '権威サーバーでAレコードを新しいIPアドレスに変更しました。しかし社内のPCで引くと、古いIPアドレスが返ります。最も可能性が高い原因はどれですか？', options: ['リゾルバのキャッシュに、TTLが切れていない古い値が残っている', 'NSレコードがない', 'MXレコードが間違っている', 'UDPが遅い'], answer: 0, explanation: 'リゾルバは、TTLが切れるまでキャッシュした古い値を返し続けます。権威サーバーに直接聞く「dig @権威サーバーのIP 名前」で新しい値が返れば、キャッシュが原因だと確かめられます。IPアドレスを切り替えるときは、数日前にTTLを短くしておくのが定石です。' },
      { question: 'example.com 宛てのメールを、どのサーバーに配送するかを示すレコードはどれですか？', options: ['A', 'CNAME', 'MX', 'PTR'], answer: 2, explanation: 'MXレコードは、メールの配送先のホスト名と優先度（小さいほど優先）を示します。Aはホスト名のIPv4アドレス、CNAMEは別名、PTRはIPアドレスから名前を調べる逆引きに使います。' },
    ] },
  { id: 'nat-firewall', dir: '06-nat-firewall', title: 'NAT / Firewall', subtitle: 'アドレスを書き換え、通信を選んで通す', level: 'CORE NETWORKING', available: true, minutes: 60, goal: 'NATテーブルとファイアウォールのルールを読んで、パケットが書き換えられるか・通るかを説明できる。',
    playground: { text: 'PAT（多数のPCで1つのグローバルアドレスを共有するNAT）、ポートフォワード、ステートフルFirewallを設定済みの構成を開きます。通信の後にFWで「show ip nat translations」「show firewall」「show conntrack」を実行し、変換の記録とルールの判定を確かめましょう。', to: '/simulator?template=firewall', label: 'Firewall / DMZ テンプレートを開く' },
    mastery: { type: 'lab', labId: 'fw-01' },
    quiz: [
      { question: '社内のPC1（192.168.1.10）とPC2（192.168.1.11）が、PATで同じグローバルアドレス 203.0.113.2 を共有してインターネットに出ています。戻ってきたパケットがどちら宛てかを、ルータはどう区別しますか？', options: ['MACアドレスで区別する', 'ポート番号を変換・記録しておき、それで区別する', 'TTLで区別する', 'DNSで区別する'], answer: 1, explanation: '戻りのパケットはどれも宛先が 203.0.113.2 なので、IPアドレスだけではどちら宛てか区別できません。PATは送信元ポートを必要に応じて別の番号に書き換え、その対応をNATテーブルに記録します。戻りの宛先ポートでテーブルを引き、元のPCのアドレスとポートに戻します。' },
      { question: 'ステートフルFirewallで、社内PCからDMZのWebサーバー（443番）へ接続を始める通信だけを許可しました。戻り用のルールはありませんが、サーバーからのSYN-ACKは通ります。なぜですか？', options: ['戻りのパケットは、常にどれかの許可ルールに一致するから', '許可した接続を接続追跡（conntrack）に記録し、その応答だと判断するから', 'TTLが小さいから', 'NATがあるから'], answer: 1, explanation: 'ステートフルFirewallは、許可した通信を接続追跡のテーブルに記録します。SYN-ACKはその記録に一致するので、戻り用のルールがなくても通ります。ステートレスなフィルタには記録がないので、戻りを許可するルールを自分で書く必要があります。' },
      { question: 'ACLのルールは上から順に評価されます。先頭（ルール10）に「deny ip any any」を置き、その後ろにWebを許可するルールを書きました。このACLを通る通信はどうなりますか？', options: ['すべて許可される', 'すべて拒否される', '何も変わらない', 'ステートフルな判定に切り替わる'], answer: 1, explanation: 'ACLは上から順に評価され、最初に一致したルールで結果が決まります。「deny ip any any」はどのパケットにも一致するので、後ろの許可ルールは使われません。狭い条件のルールを先に、広い条件のルールを後に置きます。' },
      { question: 'インターネットから、社内のWebサーバーを見られるようにしたい。必要な設定はどれですか？', options: ['SNAT（送信元NAT）だけ', 'DNAT（ポートフォワード）と、そのポートを通すFirewallの許可ルール', 'ARPの設定', 'STPの設定'], answer: 1, explanation: 'DNATで、公開用アドレス宛てに来た通信の宛先を内側のサーバーに書き換えて届けます。DNATは書き換えるだけで通してよいかは判断しないので、Firewallで必要なポートだけを許可します。SNATは社内から外へ出るときに送信元を書き換える仕組みで、外から入る通信を届けるものではありません。' },
      { question: '公開Webサーバーを、社内LANとは別の区画（DMZ）に置く主な目的はどれですか？', options: ['通信を速くするため', '公開サーバーが侵害されても、社内LANへの被害を広げないため', 'IPアドレスを節約するため', 'DNSを冗長化するため'], answer: 1, explanation: '公開サーバーは、外から攻撃を受けやすい場所です。DMZに分け、DMZから社内LANへの通信を原則拒否しておけば、侵害されても攻撃者は社内LANへ直接は進めません。DMZは被害の範囲を区画で限定する考え方で、速度やアドレスの節約のためのものではありません。' },
    ] },
  { id: 'linux', dir: '07-linux', title: 'Linuxネットワーク', subtitle: '「つながらない」を層ごとに切り分ける', level: 'PRACTICE', available: true, minutes: 90, goal: '「つながらない」を、NICからアプリケーションまで下の層から順に確かめ、最初に失敗した層を特定できる。',
    playground: { text: 'DNSサーバーとWebサーバーがある構成で、PC1のTerminalを使います。「ip addr」「ip route」「dig」「nc -zv」「curl -v」の順に実行し、下の層から1段ずつ結果を確かめましょう。', to: '/simulator?template=dns', label: 'DNS / Webのテンプレートを開く' },
    mastery: { type: 'lab', labId: 'linux-mastery' },
    quiz: [
      { question: 'curlでWebサーバーに接続すると、すぐに「Connection refused」と表示されました。最も可能性が高いのはどれですか？', options: ['DNSの名前解決に失敗した', '宛先への経路がない', '相手には届いたが、そのポートで待ち受けていない（RSTかICMP port unreachableが返った）', '証明書が正しくない'], answer: 2, explanation: 'refusedは、相手（または途中のFirewallのREJECT）から拒否の応答が返ったことを表します。つまり、パケットは相手の近くまで届いています。途中で無言で捨てられたならtimed out、名前解決の失敗なら「Could not resolve host」と、別の表示になります。' },
      { question: 'curlが何度か待った後に「Connection timed out」で失敗しました。ここから推測できることはどれですか？', options: ['応答が何も返ってこなかった（途中で捨てられた、戻りの経路がない、相手が止まっている、など）', 'ポートが閉じていて、拒否の応答が返った', '名前解決できなかった', 'HTTPの500エラーが返った'], answer: 0, explanation: 'timed outは、SYNを再送しても何も返ってこなかったことを表します。無言で捨てるFirewall（DROP）や、行き・帰りの経路の問題を疑います。ポートが閉じているだけなら、RSTが返ってすぐにConnection refusedになります。' },
      { question: 'サーバーで「ss -tlnp」を実行すると、アプリが 127.0.0.1:443 で待ち受けていました。このアプリには、どこから接続できますか？', options: ['外部のホストからも接続できる', '同じホストの中からしか接続できない', 'UDPで待ち受けているので、TCPでは接続できない', 'アプリは停止しているので、どこからも接続できない'], answer: 1, explanation: '127.0.0.1はループバック（自分自身）のアドレスで、ホストの外には出ません。そのため同じホストの中からしか接続できず、外から接続するとRSTが返ってConnection refusedになります。外から使うなら、0.0.0.0（すべてのアドレス）かそのホストのIPアドレスで待ち受けるよう設定します。' },
      { question: '「ip route get 8.8.8.8」を実行すると「8.8.8.8 via 192.168.1.1 dev eth0 src 192.168.1.10」と表示されました。ここからわかることはどれですか？', options: ['8.8.8.8 からの応答時間', '8.8.8.8 へ送るときのNext Hop（次に渡す相手）・出ていくインターフェース・送信元IPアドレス', 'DNSの問い合わせ結果', 'ARPテーブルの中身'], answer: 1, explanation: 'ip route get は、経路表の中からOSが実際に選んだ結果を表示します。via が次に渡す相手（Next Hop）、dev が出ていくインターフェース、src が送信元に使うIPアドレスです。パケットは送らないので、応答時間や相手に届くかどうかはわかりません（それはpingで確かめます）。' },
      { question: 'Webサイトが開けないと相談されました。調べ方として適切なのはどれですか？', options: ['怪しい設定を一度に全部変える', '下の層から1つずつ確かめ、変更は1回に1つだけにして再確認する', '直るまで再起動を繰り返す', 'Firewallを無効にして様子を見る'], answer: 1, explanation: '下の層から順に確かめれば、最初に失敗した層に調べる範囲を絞れます。変更を1回に1つにすれば、何が効いたのか、何が新しい問題を生んだのかがわかります。Firewallは丸ごと無効にするのではなく、必要なポートだけを許可します。' },
    ] },
  { id: 'capture', dir: '08-capture', title: 'パケット解析', subtitle: 'キャプチャから通信の事実を読み取る', level: 'PRACTICE', available: true, minutes: 60, goal: 'キャプチャから「実際に流れたもの」を読み取り、観測した事実と仮説を分けて説明できる。',
    playground: { text: 'Packet Analyzerで、シミュレータで記録したフレームや手元のPCAPファイルを開きます。「udp port 53」などのフィルタで絞り込み、1行を選んで階層表示とHex dump（バイト列）を見比べましょう。', to: '/analyzer', label: 'Packet Analyzerを開く' },
    mastery: { type: 'lab', labId: 'capture-01' },
    quiz: [
      { question: 'キャプチャで、TCPのSYNが同じSeqのまま、間隔を広げて3回送られています。SYN, ACKもRSTも見えません。何が起きていると考えられますか？', options: ['正常な通信', '応答が届かず、SYNを再送している', 'ポートが閉じている', 'DNSの名前解決に失敗している'], answer: 1, explanation: '同じSeqのSYNが繰り返されるのは、返事がないため同じ接続の申し込みを送り直している状態です。ポートが閉じているだけならRSTが返り、名前解決の失敗ならSYN自体が送られません。途中での破棄や、SYN, ACKが戻れない経路の問題を疑います。' },
      { question: 'tcpdumpで、DNSの通常の問い合わせと応答だけを記録したい。キャプチャフィルタはどれですか？', options: ['port 80', 'udp port 53', 'icmp', 'arp'], answer: 1, explanation: 'DNSの通常の問い合わせはUDPの53番を使うので、「udp port 53」で絞れます。TCPの53番も含めたいときは「port 53」と書きます。port 80はHTTPの通信です。' },
      { question: 'HTTPS（TLS 1.3）の通信をキャプチャしました。Server Hello以降のパケットで、キャプチャから読めないものはどれですか？', options: ['IPアドレス', 'TCPのポート番号', '証明書やHTTPの中身', 'パケットの長さ'], answer: 2, explanation: 'TLS 1.3では、Server Hello以降の証明書もHTTPの中身も暗号化されます。IPアドレス・ポート番号・パケットの長さは暗号化されないので、そのまま見えます。なお、最初のClient HelloにあるSNI（接続先のホスト名）は、ECHを使っていなければ読めます。' },
      { question: 'あるパケットへの応答として、ICMP Destination Unreachable（Port Unreachable）が返ってきました。これは、どのプロトコルの通信への応答として典型的ですか？', options: ['UDP', 'ARP', 'Ethernet', 'STP'], answer: 0, explanation: '待ち受けていないUDPのポートに送ると、ホストはICMPのPort Unreachableを返します。TCPの場合は、代わりにRSTが返るのが一般的です。LinuxのUDP方式のtracerouteでも、最後の宛先がこれを返します。' },
      { question: 'キャプチャを調べた結果を、チームに報告します。大切なことはどれですか？', options: ['推測も事実として書く', '観測した事実（パケット番号付き）と、そこからの推測を分けて書く', 'スクリーンショットだけを貼る', '結論だけを書く'], answer: 1, explanation: '「No.1〜3でSYNが3回、SYN, ACKはない」は観測、「Firewallが落としている」は仮説です。根拠のパケット番号を添えて分けて書くと、ほかの人が同じキャプチャで検証できます。キャプチャに見えないことは観測点やフィルタの誤りでも起きるので、「見えない」を「送られていない」と断定しません。' },
    ] },
  { id: 'topology', dir: '09-topology', title: 'ネットワーク構築', subtitle: '構成を組み、1ホップずつ確かめる', level: 'PRACTICE', available: true, minutes: 60, goal: '機器を配置・配線・設定して通信を通し、1ホップごとにMAC・VLAN・IP・TTLのどれが変わるかを説明できる。',
    playground: { text: '「新規作成」で構成に名前を付け、何もない状態から始めます。パレットからPC・スイッチ・ルータを置いてケーブルでつなぎ、IPアドレスと経路を設定したらpingを送り、Packet Debuggerで1ホップずつヘッダの変化を追いましょう。', to: '/simulator', label: 'プレイグラウンドを開く' },
    mastery: { type: 'lab', labId: 'topology-01' },
    quiz: [
      { question: 'PC1 → SW1 → R1 → R2 → PC2 とpingが進みます（NATなし）。IPヘッダの送信元・宛先IPアドレスはどうなりますか？', options: ['ホップごとに変わる', '最初から最後まで変わらない', 'ルータを通るたびに送信元と宛先が入れ替わる', 'スイッチを通るたびに変わる'], answer: 1, explanation: 'IPアドレスは最初の送信元と最終的な届け先を表すので、NATがなければ途中で変わりません。リンクごとに変わるのは、EthernetヘッダのMACアドレスです。ルータはMACアドレスを付け替え、TTLを1減らします。' },
      { question: 'パケットがL2スイッチを1台通過しました。IPヘッダのTTLはどうなりますか？', options: ['1減る', '変わらない', '初期値の64に戻る', '0になる'], answer: 1, explanation: 'TTLを減らすのは、IPを見て転送するルータ（L3）です。L2スイッチはMACアドレスを見てフレームを転送するだけで、IPヘッダを書き換えません。そのためTTLは変わりません。' },
      { question: 'スイッチどうしをつなぐトランクを流れるフレームに付くものはどれですか？', options: ['TTL', '802.1QのVLANタグ（ネイティブVLANのフレームを除く）', 'NATの変換情報', 'ポート番号'], answer: 1, explanation: 'トランクは複数のVLANを運ぶので、どのVLANのフレームかを示す802.1Qタグ（4バイト）を付けます。ただし、ネイティブVLANのフレームはタグなしで流れます。TTLはIPヘッダの中の値で、トランクで付け足されるものではありません。' },
      { question: '作ったネットワークの論理構成図に、必ず書いておきたいものはどれですか？', options: ['ケーブルの色', 'サブネット・VLAN・Gateway・経路の関係', '機器の価格', '設置場所の温度'], answer: 1, explanation: '論理構成図は「パケットがどう流れるか」に答える図なので、サブネット、VLAN、Gateway、ルーティングの範囲を書きます。どこに何が刺さっているかは物理構成図に書き、両方をそろえて管理します。経路の問題は論理構成図で、配線の障害は物理構成図で追います。' },
    ] },
  { id: 'aws', dir: '10-aws', title: 'AWS VPC', subtitle: 'VPCの経路とフィルタを設計する', level: 'PROFESSIONAL', available: true, minutes: 90, goal: 'インターネットからEC2までの通信が届くかを、ルートテーブル・NACL・Security Groupの判定を行きと帰りでたどって説明できる。',
    playground: { text: 'AWS VPC Designerで「3層構成の例を開く」を選び、Web・アプリ・DBに分けたVPCを使います。送信元・宛先・ポートを選んで「分析」を実行し、行きと帰りのどのホップで止まるかを確認しましょう。ルートテーブルやNACLを変えて、結果の変化も確かめられます。', to: '/aws', label: 'AWS VPC Designerを開く' },
    mastery: { type: 'lab', labId: 'aws-03' },
    quiz: [
      { question: 'AWSのサブネットが「パブリックサブネット」になるかどうかを決めるものはどれですか？', options: ['サブネットの名前', '関連付けたルートテーブルに、アタッチ済みのInternet Gatewayへの経路があるか', 'サブネットを置いたAZ', 'CIDRの大きさ'], answer: 1, explanation: 'パブリックかどうかは、サブネットの種類ではなく経路の結果です。ルートテーブルに 0.0.0.0/0 → igw- のような、アタッチ済みのIGWへの経路があればパブリックサブネットになります。名前に public と付けても、この経路がなければプライベートのままです。' },
      { question: 'Security Group（SG）の説明として正しいものはどれですか？', options: ['ステートレスで、戻りの通信にもルールが必要', '許可ルールだけを書き、許可した通信の戻りは自動で通す（ステートフル）', '番号順に評価し、拒否ルールも書ける', 'サブネット単位で付ける'], answer: 1, explanation: 'SGは、インスタンス（のENI）ごとに付くステートフルな許可リストです。許可した通信の戻りは、ルールに関係なく自動で通ります。番号順に評価して拒否ルールも書けるのは、サブネットの境界に付くNetwork ACLのほうです。' },
      { question: 'Network ACL（NACL）のインバウンドで443番を許可したのに、Webサイトが表示されません。戻りの通信のために、アウトバウンドで必要になりやすい設定はどれですか？', options: ['エフェメラルポート（1024〜65535）宛ての許可', 'ICMPの許可', 'Security Groupの参照', '追加の設定は要らない'], answer: 0, explanation: 'NACLはステートレスなので、行きを許可しても帰りは自動では通りません。帰りのパケットの宛先はクライアントが選んだエフェメラルポート（一時的なポート）なので、アウトバウンドで1024〜65535宛てを許可するのが一般的です。SGならステートフルなので、この設定は要りません。' },
      { question: 'プライベートサブネットのサーバーを、NAT Gateway経由でインターネットに出したい。NAT Gatewayはどこに作りますか？', options: ['そのプライベートサブネット', 'パブリックサブネット（IGWへの経路があるサブネット）', 'DBサブネット', 'どこでもよい'], answer: 1, explanation: 'NAT Gateway自身も、変換したパケットをInternet Gatewayへ送る必要があります。そのため、IGWへの経路があるパブリックサブネットに作り、Elastic IPを割り当てます。守りたいプライベートサブネットに置くと、NAT Gateway自身が外へ出られません。' },
      { question: 'VPC AとVPC B、VPC BとVPC Cを、それぞれVPC Peeringでつなぎました。VPC AからVPC Cへは通信できますか？', options: ['Bを経由して通信できる', 'AとCを直接ピアリングしない限り通信できない（推移的ルーティング不可）', 'ルートを書けば通信できる', 'NACLしだいで通信できる'], answer: 1, explanation: 'VPC Peeringは推移的ではなく、BはAとCの間の通信を中継しません。AのルートテーブルにCの範囲を書いても、Bが転送しないので届きません。AからCへ届けるには、AとCを直接ピアリングするか、Transit Gatewayのようなハブを使います。' },
    ] },
  { id: 'vpn-bgp', dir: '11-vpn-bgp', title: 'VPN / BGP', subtitle: '拠点とクラウドを、トンネルとBGPでつなぐ', level: 'PROFESSIONAL', available: true, minutes: 90, goal: 'VPNトンネルに通信を流すための経路とBGPの経路広告の関係を、トンネル障害時の切り替えまで説明できる。',
    playground: { text: '拠点とクラウドを2本のIPsecトンネルでつなぎ、それぞれの上でBGPを動かした構成を開きます。片方のトンネルを止めて、「show ip bgp」で残ったトンネル経由の経路がBest Path（最良の経路）に切り替わる様子を確かめましょう。', to: '/simulator?template=vpn', label: 'VPN + BGP テンプレートを開く' },
    mastery: { type: 'lab', labId: 'bgp-02' },
    quiz: [
      { question: '拠点とVPCを、IPsecのトンネルモードでつないでいます。インターネット上でキャプチャしたとき、IPヘッダに見える送信元・宛先IPアドレスはどれですか？', options: ['元のパケットの送信元・宛先（社内のアドレス）', 'トンネル両端（ゲートウェイ）のアドレス', 'MACアドレスだけ', '何も見えない'], answer: 1, explanation: 'トンネルモードでは、元のパケット全体をESPで暗号化し、外側にゲートウェイどうしのIPヘッダを付けます。インターネットのルータは、この外側の宛先だけを見て転送します。内側の社内アドレスやポートは暗号化されて見えませんが、外側のIPアドレスまで隠れるわけではありません。' },
      { question: 'ルートベースVPNで、どの通信をトンネルに入れるかを決めるものはどれですか？', options: ['暗号化ACL', 'ルーティングテーブル（トンネルインターフェースへの経路）', 'DNS', 'NAT'], answer: 1, explanation: 'ルートベースVPNでは、トンネルを1本の仮想インターフェース（tunnel1など）として扱い、経路表でそこへ向けた通信がトンネルに入ります。経路は静的に書くことも、BGPで受け取ることもできます。暗号化ACLで条件を書くのは、ポリシーベースVPNのやり方です。' },
      { question: 'AS 65001のルータが、eBGPで受け取った経路のAS_PATH（経路が通ってきたASの並び）に「65001」が含まれていました。このルータはどうしますか？', options: ['その経路を優先する', 'ループとみなして破棄する', 'LOCAL_PREFを上げる', 'MEDを下げる'], answer: 1, explanation: 'AS_PATHに自分のASNがあるのは、自分から出た経路が回り回って戻ってきたということです。BGPはこれをループとみなして破棄します。AS_PATHは、経路の長さ比べだけでなく、ループ防止にも使われます。' },
      { question: '自ASから外へ出ていく通信の出口を、2つの回線のどちらにするか決めたい。使う属性はどれですか？', options: ['MED', 'LOCAL_PREF', 'NEXT_HOP', 'ORIGIN'], answer: 1, explanation: 'LOCAL_PREFは自AS内で共有される優先度で、大きいほど優先されます。出ていく通信は自分たちが送るので、受け取る経路のLOCAL_PREFで出口を選べます。MEDは、入ってくる通信の入口を隣のASに「お願い」するための属性です。' },
      { question: 'BGPで「network 172.16.0.0/16」と書いたのに、経路が広告されません。ルータの経路表には 172.16.2.0/24 だけがあります。理由はどれですか？', options: ['network文は、経路表（RIB）に完全一致する経路がないと広告しない', 'MEDが大きい', 'AS_PATHが長い', 'BGPはIGPの経路を使わない'], answer: 0, explanation: 'Cisco IOSなどのnetwork文は、同じプレフィックスの経路が経路表に完全一致であるときだけ広告します。/16と/24は別のプレフィックスなので、172.16.2.0/24 があっても 172.16.0.0/16 は広告されません。まとめて広告したいなら、Null0への静的経路で/16を作るか、aggregate-address を使います。' },
    ] },
  { id: 'terraform', dir: '12-terraform', title: 'Terraform', subtitle: 'ネットワークをコードで管理する', level: 'PROFESSIONAL', available: true, minutes: 90, goal: 'terraform plan の記号を読んで、何が作成・変更・作り直しになるかを apply の前に説明できる。',
    playground: { text: 'Terraform Labで、VPCやサブネットのコードを書きます。「terraform plan」で変更の予告を読み、「terraform apply」の結果がVPC図に反映される様子を確かめましょう（教育用のシミュレーションで、実際のAWSには何も作られません）。', to: '/terraform', label: 'Terraform Labを開く' },
    mastery: { type: 'lab', labId: 'tf-04' },
    quiz: [
      { question: 'terraform plan の出力に「id = (known after apply)」と表示されました。これはどんな値ですか？', options: ['エラーになった値', 'リソースを作成するまで決まらない値（IDなど）', '変数の既定値', '削除される値'], answer: 1, explanation: 'VPCやサブネットのIDは、AWSのAPIで作成されて初めて決まります。そのため、planの時点では「(known after apply)」と表示されます。エラーではなく、そのIDを参照している側の値も、作成時に確定します。' },
      { question: 'サブネットの cidr_block を変えたら、planに「# forces replacement」が付きました。このまま apply すると何が起きますか？', options: ['その場で設定だけ更新される', 'リソースを削除して作り直す（-/+）', '何も起きない', 'stateだけが変わる'], answer: 1, explanation: 'サブネットのCIDRのように、作成後に変更できない属性を変えると、置き換え（-/+：削除して作り直し）になります。新しいリソースはIDが変わるので、参照している関連付けなども作り直しになることがあります。その場で変更できるのは、planに ~ と表示される変更です。' },
      { question: 'aws_subnet のコードで vpc_id = aws_vpc.main.id と書いています。apply するとき、作成される順番はどうなりますか？', options: ['ランダム', 'VPC → サブネット（参照による暗黙の依存関係）', 'サブネット → VPC', '同時'], answer: 1, explanation: 'サブネットはVPCのIDを参照していますが、そのIDはVPCを作るまで決まりません。Terraformは参照をたどって依存グラフを作り、VPCを先に作ります。ファイルに書いた順番ではなく、参照が順番を決めます。' },
      { question: '誰かがAWSのコンソールで、Terraformで管理しているSecurity Groupに22番の許可ルールを手で追加しました。次に terraform plan を実行すると何が起きますか？', options: ['何も起きない', 'drift（コードの外での変更）として検出され、コードの状態に戻す変更が計画される', 'stateが削除される', 'applyできなくなる'], answer: 1, explanation: 'planの前のrefresh（実物の読み直し）で、実物とstateのずれ（drift）が見つかります。コードには22番がないので、planはコードどおりに戻す変更、つまり22番のルールを削除する変更を提案します。stateが消えたり、applyできなくなったりするわけではありません。' },
      { question: 'チームでS3などのリモートバックエンドにstateを置くとき、stateをロックする目的はどれですか？', options: ['処理を速くする', '2人が同時にapplyして、stateが壊れるのを防ぐ', 'stateを暗号化する', 'importできるようにする'], answer: 1, explanation: 'stateは、コード上のリソースと実物の対応の記録です。2人が同時にapplyすると、この記録が食い違って壊れることがあります。ロックがあれば、実行中はほかの人が同時に実行できません。' },
    ] },
];
export const lessonStages = ['Theory', 'Visual', 'Playground', 'Guided Lab', 'Challenge', 'Troubleshooting', 'Professional Notes', 'Quiz', 'Mastery Check'];
export const chapterById = (id: string) => curriculum.find(c => c.id === id);
