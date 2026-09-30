# シミュレーションの意味と制約

## 本物の通信と区別する

ブラウザはICMP、ARP、Ethernet、TCP、DNS、raw socketを送信していません。Terminalはxtermで表示し、コマンドはTypeScriptのCliEngineが解釈します。`ping` / `traceroute` / `dig` / `curl` / `tcpdump`は仮想機器の状態に対する操作です。実OS・実機・AWSへ接続せず、到達性を推測して固定の成功文字列を返すこともしません。すべての結果は、仮想ネットワークでパケットを実際に処理した結果（イベントとキャプチャ）から作ります。

AWSとTerraformも同じです。AWS APIは呼ばず、認証情報を扱う画面もありません。Terraform CLI・AWS Providerは実行せず、限定したHCLを教育用の評価器で処理し、「シミュレートされたクラウド」に反映します。

## ネットワーク（NetworkSimulator）

| 項目 | 現在の振る舞い / 簡略化 |
| --- | --- |
| Devices | PC・Server（ホスト、転送しない）、Router、L2 Switch、L3 Switch、Firewall、Internet（ISP役のルータ）。機器数は最大128 |
| Links | 1ポート1ケーブルの双方向Ethernet。LinkがDown・両端いずれかのInterfaceがDownならcarrierなし |
| Line protocol | ルーテッドポートでcarrierがない（ケーブルなし・Link Down・対向Down）と、そのConnected経路を削除（`lineDown`）。SVIは、そのVLANを運ぶUpかつSTP forwardingのポートが1つもないとDown（autostate）。実機のkeepalive等のタイミングは再現しない |
| L2 bridging | 送信元MACを学習（仮想時刻300秒でエージング）、未学習・ブロードキャストは同一VLANへflooding、受信ポート側の宛先はフィルタ。MAC移動を検出してログに出す |
| VLAN | 802.1Q access / trunk、allowed VLAN、native VLAN（タグなし）、VLAN DB。native VLANの不一致は実機同様にVLANをまたいでフレームが漏れる。VTP・DTP・voice VLANは未実装 |
| STP | ルートブリッジ・ルートポート・指定ポート・ブロッキングを**収束後の定常状態**として計算（priority・コスト設定可）。BPDUの送受信、Listening/Learningのタイマー、RSTPの提案/合意は再現しない |
| Broadcast storm | STPなしのループでは実機ではフレームが無限に増える。ここではフレーム数256で打ち切り、`BROADCAST_STORM`イベントとして示す |
| ARP | 出力ポート単位のキャッシュ（仮想時刻120秒）。request/replyを実際のL2（スイッチ・VLAN経由）で配送。設定変更時・復元時はクリア。Gratuitous ARP・Proxy ARP・重複IP検出は未実装 |
| IPv4 forwarding | ingress ACL → NAT（outside→inside）→ 自分宛て/トンネル終端 → 転送可否 → TTL → 経路選択 → Firewall → TTL減算 → NAT（inside→outside）→ egress ACL → トンネル化 → リンク → ARP → L2、の順（IOSのNAT順序に準拠） |
| Route selection | 最長一致 → AD（Connected 0 / Static 1 / eBGP 20 / OSPF 110 / iBGP 200）→ metric。再帰的なNext Hop解決と循環検出。Next Hopを解決できない経路は使わず（表示もしない）、次の候補へフォールバック。AD 255の経路はインストールしない。ECMPは表示上も1本のみ、policy routing・VRFなし |
| ICMP | Echo、Time Exceeded、Destination Unreachable（code 0 net / 1 host / 3 port / 13 administratively prohibited）。元のIPヘッダ＋8バイトを引用。rate limitなし |
| traceroute | ICMP（`-I`）・UDP（既定、33434〜）・TCP（`-T -p`）。応答も実際の復路を通り、返らなければ`*` |
| TCP | 3-way handshake、データ、FIN、RST（閉じたポート）、SYN再送（間隔を倍増、実際のOSより回数は少ない）。window・輻輳制御・再送タイマーの詳細・Nagle等は未実装 |
| UDP / sockets | サービスごとのlisten（bind アドレス付き）。閉じたUDPポートはICMP port unreachable。`ss`はサービス定義と仮想時刻のソケット表から生成 |
| DNS | 権威サーバー（SOA・NS・A・AAAA・CNAME・MX・TXT・PTR）、委任とglue、再帰リゾルバ（ルートヒントから反復）、許可ネットワーク（REFUSED）、TTLキャッシュ、ネガティブキャッシュ（RFC 2308: SOAのTTLとminimumの小さい方）。EDNS・DNSSEC・TCPフォールバック・ゾーン転送は未実装 |
| TLS | TLS 1.3風のClientHello（SNI）/ ServerHello / 暗号化データの流れと、証明書の名前・期限・自己署名の検査。**暗号処理は行わない**。キャプチャ上の中身は教育用に表示するだけ |
| HTTP | リクエスト行・ステータス・ヘッダ・本文。サービス停止・ポート違い・名前解決失敗を区別して失敗させる |
| NAT | PAT（overload）、static NAT、port forward。変換表は仮想時刻で失効。ポート割り当てと保持時間は実機・OSごとに異なる |
| ACL / Firewall | ルール番号順の最初の一致、暗黙のdeny。ACLはステートレス（`established`はACK/RSTの有無のみ）。Firewallはステートフル（conntrack、INVALIDは破棄）。Linuxは`iptables`のfilter / INPUTチェーンのみ（`-m conntrack --ctstate`対応） |
| OSPF風 | ネイバー、Router LSA、SPF（Dijkstra）、コスト（参照帯域100Mbps）、passive-interface、default-information originate。エリアは隣接の制限にだけ使い、エリア間もひとつのSPFで計算する（Summary LSA・集約なし）。Hello/Dead・DR/BDR選出・LSAの種類ごとの動作は再現しない |
| BGP | eBGP / iBGP、ループバックからのiBGP（update-source）、network文、AS_PATHループ拒否、next-hop-self、prefix-list（in/out）、LOCAL_PREF・MED・AS_PATH prepend（教育用の簡略構文。実機はroute-map）、ベストパス選択（到達可能性 → LOCAL_PREF → 自生成 → AS_PATH長 → MED → eBGP優先 → Router ID）。Weight・ORIGIN・IGPメトリック・タイマー・UPDATEの詳細は省略。同期ラウンドで収束するまで計算 |
| Tunnels | route-basedのGRE / IPsec（ESP）。両端の送信元・宛先、PSK、proposalの一致で「確立」。**IKEのネゴシエーションと暗号は再現しない**。ESPの中身はダミーのバイト列 |
| Simulation clock | リンク遅延だけを加算する仮想時間。`sleep`や「時間を進める」でキャッシュ・変換表・conntrackが失効する。帯域はメタデータのみ |
| Packet debugger | 決定的に実行した結果のイベントを再生する。Stepは次のイベントへの移動で、稼働中のネットワークを一時停止する機能ではない |
| Persistence | 機器・設定・トポロジーはJSON保存。ARP・MAC表・NAT表・conntrack・DNSキャッシュ・キャプチャは実行時の状態として保存せず、復元時は空から始まる |

## キャプチャとPacket Analyzer

| 項目 | 現在の振る舞い / 簡略化 |
| --- | --- |
| Encoding | Ethernet II・802.1Q・ARP・IPv4（checksum）・ICMP・TCP・UDP（checksum）・DNS・GRE・ESP・HTTP/TLSのバイト列を生成。FCS・プリアンブルは省略 |
| Decoding | バイトオフセット付きで各層を表示（Hexと連動）。自前のデコーダで、Wiresharkのdissector互換ではない |
| Filters | BPF風: `arp` `ip` `ip6` `icmp` `tcp` `udp`、`host` `src` `dst` `net`、`port` `src port` `dst port`、`vlan`、`and` `or` `not` と括弧（`and` と `or` は同じ優先度で左から評価）、`-i`。tcpdump / BPFの完全互換ではない |
| PCAP | pcap書き出し。pcap（µs/ns）と pcapng（SHB/IDB/EPB/SPB）の読み込み。リンク種別は Ethernet・Linux cooked（SLL / SLL2）・raw IP。最大20MB・20,000パケット。ファイルはブラウザ外へ送信しない |

## AWS VPC（教育用モデル）

VPC・Subnet（AZ）・Route Table（main / 明示関連付け）・Internet Gateway・NAT Gateway・Security Group（ステートフル、SG参照）・Network ACL（ステートレス、ルール番号順、エフェメラルポート）・EC2・ALB/NLB（リスナー、ターゲット）・VPC Peering・Gateway Endpoint（S3 / DynamoDB）・VPN Gatewayをモデル化します。到達性分析は往路と復路（クライアントのエフェメラルポート50000）の両方を評価し、止まった箇所を示します。

Transit Gateway・PrivateLink（Interface Endpoint）・Route 53・IPv6・Direct Connect・クォータ・料金・IAMは扱いません。実際のAWS Reachability Analyzerとは表示と対象範囲が異なります。

## Terraform（限定HCL）

ブロックとラベル、属性、`${}`補間、数値・真偽値・null・リスト・オブジェクト、参照（`a.b[0].c`、`a.b[*].c`）、関数呼び出し（cidrsubnet・cidrhost・length・element・concat・merge・lookup・format・tostring・tonumber・upper・lower・join・slice・range）、算術・比較・論理・条件式、variable・locals・output・module（ローカルパス）・count・depends_on・lifecycle（create_before_destroy / prevent_destroy / ignore_changes）、データソースに対応します。

heredoc・for式・dynamicブロック・for_each・provisioner・リモートモジュールは未対応で、エラーとして示します。`backend`ブロックは構文として受け付けますが無視し、stateは常にブラウザ内のワークスペースに保存します。plan / apply / destroy / import / state / fmt / validate / graph の出力は実際のTerraformの表示とは細部が異なります。ドリフトとstate lockは、画面のボタンで「運用で起きること」を再現します。

## 意図的な欠落を実ネットワーク仕様として教えない

教材では、概念の説明と「このシミュレータで試せること」を区別しています。簡略化した箇所は、各章の本文・可視化ツールの注記・このドキュメントに明記しています。IPv6転送、DHCP、MTU/fragmentation、QoS、無線LANは概念説明のみです。

Mastery CheckとCapstoneは最終状態を自動採点しますが、設計理由の説明や運用手順の良し悪しまでは自動判定しません。プロとしての到達を認定するものではありません。

## 確認に使った公式資料

- [RFC 826 — ARP](https://www.rfc-editor.org/rfc/rfc826)、[RFC 791 — IPv4](https://www.rfc-editor.org/rfc/rfc791)、[RFC 792 — ICMP](https://www.rfc-editor.org/rfc/rfc792)、[RFC 1812 — IPv4 Router Requirements](https://www.rfc-editor.org/rfc/rfc1812)
- [RFC 9293 — TCP](https://www.rfc-editor.org/rfc/rfc9293)、[RFC 768 — UDP](https://www.rfc-editor.org/rfc/rfc768)
- [RFC 1034](https://www.rfc-editor.org/rfc/rfc1034) / [RFC 1035 — DNS](https://www.rfc-editor.org/rfc/rfc1035)、[RFC 2308 — ネガティブキャッシュ](https://www.rfc-editor.org/rfc/rfc2308)
- [RFC 8446 — TLS 1.3](https://www.rfc-editor.org/rfc/rfc8446)、[RFC 4303 — ESP](https://www.rfc-editor.org/rfc/rfc4303)、[RFC 2784 — GRE](https://www.rfc-editor.org/rfc/rfc2784)
- [RFC 2328 — OSPFv2](https://www.rfc-editor.org/rfc/rfc2328)、[RFC 4271 — BGP-4](https://www.rfc-editor.org/rfc/rfc4271)
- [IEEE 802.1 Working Group](https://1.ieee802.org/)（802.1Q: VLAN・ブリッジ・STP）、[RFC 5952 — IPv6表記](https://www.rfc-editor.org/rfc/rfc5952)
- [pcap](https://datatracker.ietf.org/doc/draft-ietf-opsawg-pcap/) / [pcapng](https://datatracker.ietf.org/doc/draft-ietf-opsawg-pcapng/) のファイル形式（IETF opsawg）
- [AWS VPC ユーザーガイド](https://docs.aws.amazon.com/vpc/latest/userguide/)（ルートテーブル、SG、NACL、NAT Gateway、エフェメラルポート）
- [Terraform 言語ドキュメント](https://developer.hashicorp.com/terraform/language)、[AWS Provider](https://registry.terraform.io/providers/hashicorp/aws/latest/docs)

いずれも「全RFC・全仕様に準拠している」という意味ではありません。上の表の範囲で、振る舞いが食い違わないことを確認するために参照しています。
