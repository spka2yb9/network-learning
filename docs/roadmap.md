# 拡張の状況と今後

## 実装済みのPhase

| Phase | 内容 | 受け入れ条件（テストで保証） |
| --- | --- | --- |
| 1〜5 | アプリ基盤、Core、React Flow、Debugger、CLI（最初のVertical Slice） | PC1→R1→R2→PC2の往復、経路削除・診断・修復をGUI/CLIで再現 |
| 6 | Switch、MAC学習、flooding、VLAN access/trunk、native VLAN、STP、L3 Switch、Router on a Stick | MAC学習・未学習宛先・VLAN隔離・trunk許可・native不一致・ループ時の上限 |
| 7 | TCP/UDP、DNS（権威・委任・再帰・キャッシュ）、TLS、HTTP、NAT/PAT、ACL、ステートフルFirewall | 設定に依存する到達性、NAT往復、ルール順序とdefault deny、キャッシュ失効 |
| 8 | Linux調査コマンド、切り分けラダー、10件のLinux障害演習 | NIC→IP→ARP→Route→DNS→TCP→TLS→Appの切り分け。curl/ss/digはCore状態から生成 |
| 9 | Capture拡張（バイト列・デコード・BPF風フィルタ）、PCAP / pcapng読み込み、Packet Analyzer | 生成フレームのchecksum、デコードのオフセット、切り詰め・上限、キャプチャ分析ラボ |
| 10 | 本格トポロジー（全機器種別・テンプレート）、OSPF風Link State | 構築ラボ、SPF、コスト、ネイバー、パッシブ |
| 11 | AWS VPCモデルとVPC Designer | public性はIGWへの経路で判定、SGステートフル / NACLステートレスとエフェメラルポート、往復分析 |
| 12 | VPN（GRE / IPsec）・BGP | トンネル確立条件、ネイバー状態、広告、AS_PATHループ拒否、LOCAL_PREF/MED/prependでのベストパス、フェイルオーバー |
| 13 | CodeMirror、限定HCL、plan / apply / drift / import / lock / module | AWSモデルへの変換、依存順序、未対応構文の拒否、state差分 |

6つのCapstone（企業LAN、複合障害、パケット分析、AWS 3層、Hybrid、Terraform）も実装し、最終状態で採点しています。

## 障害シナリオ（再現できるもの）

Troubleshooting Lab・Capstoneとして用意しているもの、またはプレイグラウンドで再現できるもの（native VLAN不一致・STPなしのループはプレイグラウンドとユニットテストのみ）:

IP・マスク・Gatewayの誤り、Interface / Link Down、ARP未解決、経路不足・戻り経路不足・ループ、VLAN誤り・access/trunk誤り・trunk許可漏れ・native VLAN不一致、STPなしのループ、DNSの設定・レコード・委任・再帰拒否、NAT不足、Firewall/ACLのdrop、Linuxのiptables・サービス停止・bind誤り・証明書、AWSの経路不足・SG拒否・NACL拒否・IGW不足・NAT不足、VPNの経路不足・PSK不一致、BGPのネイバーDown・広告不足・フィルタ。

採点は観測ログではなく最終状態で行い、修正手順の完全一致は求めません。指定範囲以外の通信を許してしまう回避策を合格にしないよう、正の到達性テストと負の到達性テスト（分離）を組み合わせています。

## 今後の候補

優先度は 正確性 > 理解しやすさ > 操作性 > 機能数 > 見た目 の順です。

- **精度**: TCPのwindow・再送タイマー、MTU/fragmentationとPMTUD、ECMP、OSPFのエリア間集約とLSAの種類、BGPのORIGIN・Weight・IGPメトリック。
- **IPv6の転送**: NDP、SLAAC、デュアルスタックの章。現在は分析ツールとデコードのみ。
- **DHCP**: DORAの流れとリレー。現在は概念説明のみ。
- **Worker化**: 大規模トポロジー（100機器超）で操作が重くなった場合、Coreを`postMessage`の境界でWeb Workerへ移す。
- **Capstoneの評価**: 設計理由・運用手順・rollbackはルーブリックと自己/相互レビューで扱う。ブラウザだけで自由記述を高精度に自動判定できるとは仮定しない。
- **ブラウザ互換**: Firefox / Safariでの確認（現在はChromeで検証）。
