# PATH — Network Learning Lab

ネットワークを「読む → 動かす → 壊す → 調べる → 直す」で学ぶ、React + TypeScript製の学習サービスです。全12章（TCP/IP → サブネット → Routing → Ethernet/VLAN → DNS → NAT/Firewall → Linux → パケット解析 → 構築 → AWS VPC → VPN/BGP → Terraform）と6つのCapstoneを、ブラウザ内の教育用シミュレーションで学べます。

PC（デスクトップ）のブラウザ専用です。幅1024px以上を対象にし、スマートフォンの表示には対応しません。

本番は`dist/`の静的ファイルだけです。外部API、バックエンド、実Linuxシェル、raw socket、実AWS、Terraform CLIは使いません。AWS認証情報を入力・保存する画面もありません。フォントを含め、実行時の外部配信サービスにも依存しません。

## 起動

Node.js 22.12以上を使用します。依存バージョンは`package-lock.json`に固定しています。

```sh
npm ci
npm run dev
```

```sh
npm test          # Core / CLI / AWS / Terraform / 全ラボの採点
npm run build    # strict TypeScript + 本番ビルド
npm run preview  # distの確認
```

ブラウザテスト（開発時のみ）:

```sh
npx playwright install chromium
npm run build
npm run test:e2e
```

インストール済みGoogle Chromeを使う場合は`PLAYWRIGHT_CHANNEL=chrome npm run test:e2e`。テスト用サーバーは`tests/serve.mjs`で、`dist/`を`/network-test/`以下に置いて検証します。本番環境では使用しません。

## まず試すこと

`/#/lab/routing-01`で、IP・Gateway・配線済み、静的ルート未設定のラボを開きます。

| Device | Interface / address | Gateway |
| --- | --- | --- |
| PC1 | eth0: 192.168.1.10/24 | 192.168.1.1 |
| R1 | g0/0: 192.168.1.1/24, g0/1: 10.0.0.1/30 | — |
| R2 | g0/0: 10.0.0.2/30, g0/1: 192.168.2.1/24 | — |
| PC2 | eth0: 192.168.2.10/24 | 192.168.2.1 |

PC1 → R1 → R2 → PC2をEthernetリンクで接続しています。

1. PC1で`ping 192.168.2.10`。R1の経路不足で失敗します。
2. R1を選択して、Terminalで次を実行します。右のGUIフォームでも設定できます。

   ```text
   enable
   configure terminal
   ip route 192.168.2.0/24 10.0.0.2
   end
   show ip route
   ```

3. PC1でping。RequestはPC2へ届きますが、まだReplyは戻りません。
4. R2で次を実行します。

   ```text
   enable
   configure terminal
   ip route 192.168.1.0/24 10.0.0.1
   end
   ```

5. PC1のpingが成功します。`traceroute 192.168.2.10`も試してください。GUIのpingボタンならDebuggerが自動で開きます。CLIから実行した場合はDebuggerタブを選びます。
6. Event LogとDebuggerでARP、経路の最長一致、MACの変化、TTL 64 → 63 → 62、復路を調べます。Packet Captureではフレームの階層と実際にエンコードされたHexを確認できます。
7. R1で`configure terminal` → `no ip route 192.168.2.0/24`。再度pingすると失敗します。再設定で復旧させます。
8. 「到達度を確認」で、双方向疎通・Next Hop・不要な広域経路を判定します。コマンド履歴では判定せず、/32ホストルートなど複数の解法を許容します。

### 冗長化と帯域を試す

- `/#/lab/lag-01`: SW1–SW2の2本のケーブルをLACPで1つの論理リンク（po1）に束ねます。`interface range g0/7-8` → `channel-group 1 mode active`、`show etherchannel summary`。PCで `iperf3 -c 192.168.10.13 -P 4` を実行すると、合計は2本分になり、1本の接続はメンバー1本分のままであることが確かめられます。
- `/#/lab/ecmp-01`: 同じ宛先への等コストの経路を2本にし、`show ip route` で複数のNext Hop、Debuggerの「Path」表示でフローごとの経路を確認します。`/#/lab/ecmp-ts-01` では、静的ECMPが2つ先の故障に気づかず「一部の接続だけ失敗する」障害を調べます。
- 第9章のVisualステップ「単一障害点を探す」では、構成ごとに機器・リンクを1つずつ壊して、どこが止まるかと合計の容量をシミュレータで調べます。

## 画面

| URL | 内容 |
| --- | --- |
| `/#/learn/<章>` | 9ステップの教材（Theory / Visual / Playground / Guided Lab / Challenge / Troubleshooting / Professional Notes / Quiz / Mastery Check） |
| `/#/simulator`、`/#/lab/<id>` | ネットワークのプレイグラウンドとラボ（トポロジー編集・Terminal・Debugger・Capture・切り分け） |
| `/#/aws`、`/#/aws/<id>` | AWS VPC Designer（構成図・編集・往復の到達性分析） |
| `/#/terraform`、`/#/terraform/<id>` | Terraform Lab（HCLサブセット・plan / apply / drift / import / state lock） |
| `/#/analyzer`、`/#/analyzer/<id>` | Packet Analyzer（PCAP / pcapng の読み込み、デコード、フィルタ、失敗分析） |
| `/#/labs` | 全74ラボ（Guided 15・Challenge 6・Troubleshooting 36・Mastery 11・Capstone 6） |

プレイグラウンドと AWS VPC Designer には共通の構成管理があります。「新規作成」では構成名を指定して、機器・接続・AWSリソースがない状態から編集できます（名前はあとからでも可）。「テンプレートを開く」では定義済みの構成を読み込みます。AWSは基本のVPC・Webサーバー・3層構成から選べます。

「名前を付けて保存」で、編集中の構成をブラウザ内に保存し、「保存した構成を開く」から復元できます。同じ名前での保存はその保存済み構成を更新し、名前を変えると別の構成を作成します。テンプレート自体は変更されません。編集中の自動保存は1つの作業領域なので、別の構成に切り替える前に名前を付けて保存してください。保存データは現在のブラウザ内にのみ保持されます。

「保存した構成を管理」では、保存済みの構成を一覧から選んで削除できます。削除には確認があり、編集中の内容は残ります。保存済みデータの削除は取り消せませんが、開いている内容は再度名前を付けて保存できます。

AWSの構成図とリソース追加ボタンには、AWS Architecture Iconsを収録する第三者パッケージ`@aws-icons/svg`を使用しています。対応する素材がないリソースは汎用アイコンで表示します。素材はビルドに同梱し、外部CDNには依存しません。出典・ライセンスは[依存ライブラリ](docs/dependencies.md)を参照してください。

## 実装済み

- **Network Core**（UI非依存のTypeScript）: L2ブリッジ（MAC学習300秒・flooding・802.1Q access/trunk・allowed/native VLAN）、定常状態のSTP、ループ時のブロードキャストストーム上限、Link Aggregation（LACP active/passive・static on、メンバーの速度・相手の一致判定、suspended / down、L2・L3のPort-channel、STPからは1ポート、フロー単位のメンバー選択）、ARP（120秒）、Connected/Static/OSPF風/BGPの経路選択（最長一致 → AD → metric）とECMP（同じAD・metricの複数Next Hopを5-tupleのハッシュでフロー単位に選択、OSPFの maximum-paths）、リンク速度に基づく教育用の帯域モデル（ボトルネック・max-min公平な分配）、Line protocol downでのConnected経路削除、TTL、ICMPエラー、TCP（handshake・データ・FIN・RST・SYN再送）、UDP、DNS（権威・委任とglue・再帰リゾルバ・TTLキャッシュ・ネガティブキャッシュ）、TLS 1.3風のhandshakeと証明書検査、HTTP、NAT（PAT・static・port forward）、ACL、ステートフルFirewall（conntrack）、Linux iptables INPUT、GRE/IPsecのroute-basedトンネル。
- **CLI**: Linux（ip / ping / traceroute / ss / dig / nslookup / curl / nc / iperf3 / ethtool / tcpdump / iptables / systemctl など）とCisco IOS風（show / configure / interface / interface range / channel-group / interface po / speed / port-channel load-balance / router ospf（maximum-paths）/ router bgp / vlan / ACL / NAT / tunnel、show etherchannel summary / show ip cef exact-route）。`help`で一覧を表示します。出力はCoreの状態から生成します。Terminalでは、文字を選択してCtrl+C（Macは⌘C）でコピー、Ctrl+V（⌘V）で貼り付けできます。何も選択していないCtrl+Cは入力中の行の中断（^C）です。複数行を貼り付けても1行にまとめ、勝手に実行はしません。
- **Capture**: 実際のバイト列（checksum付き）へのエンコード、バイトオフセット付きデコード、BPF風フィルタ（`udp port 53`、`tcp and host 10.0.0.1` など）、PCAP書き出し、PCAP / pcapng読み込み（Ethernet・Linux cooked・raw IP）。
- **AWS**: VPC・Subnet・Route Table・IGW・NAT GW・SG・NACL・EC2・ALB/NLB・Peering・Gateway Endpoint・VGW の教育用モデルと、往路・復路の両方を評価する到達性分析。
- **Terraform**: HCLサブセットのparser / evaluator、23種類の`aws_*`リソース・データソース、変数・locals・output・module・count・関数（cidrsubnet等）、plan（create / update / replace / delete）、apply、drift検出、import、state lock、fmt。apply結果はAWSモデルに変換され、構成図と到達性分析に使えます。
- **学習**: 12章の教材と章ごとの可視化ツール（レイヤー展開、TCPタイムライン、サブネット計算機・VLSM・IPv6、経路検索とSPF、ECMPのフロー振り分けと故障、MAC学習・ブロードキャストドメイン、リンク速度とボトルネック、ポート・モジュールの互換性、LAGのメンバーとフロー、DNS解決とキャッシュ、NAT表・ルール評価、切り分けラダー、LACPとECMPの比較、単一障害点の探索、トンネルのキャプチャ比較、BGPのベストパス、plan差分など）。冗長化・帯域は既存の章（第3章ルーティング・第4章Ethernet/VLAN・第9章ネットワーク構築）に統合し、Capstone 1の要件にも含めています。
- **Debugger**: イベントの再生（Step）、ホップごとのヘッダ比較（Hop）に加え、LAGのメンバーとECMPのNext Hopを「どのフローがどこへ・なぜ（候補とハッシュの入力）」で一覧する Path 表示。構成図では、束ねたメンバーと使っていないメンバーを色と線種で区別します。Quizと実技（Mastery Check）は別に判定し、実技は最終状態で採点します。
- **採点**: 全ラボは「開始時は不合格・参考解で合格」をテストで保証しています。Troubleshootingは修復後に「原因の層」を答えて完了。自動診断（切り分けラダー）は完了後の答え合わせとしてだけ使えます。
- **保存**: 設定・トポロジー・進捗・Quiz・CLI履歴・AWS/Terraformのワークスペースを IndexedDB（Dexie）に自動保存。JSONの書き出し・検証付き読み込み。

## 簡略化と未実装

**実機と同じ動作であると解釈しないでください。** 詳細は[simulation-scope.md](docs/simulation-scope.md)。

- 時刻は仮想時間。帯域は「リンク速度から求めた理論上限」だけを扱い（iperf3）、キュー・輻輳・パケットロス・MTU/fragmentation・TCPのwindow制御は未実装です。
- STPとLACPは収束後の状態だけを計算します（BPDU・LACPDUのやり取りやタイマーは再現しません）。OSPFは単一のSPF計算、BGPは同期ラウンドでの収束です。障害の検出と経路の切り替えは瞬時です。ECMP・LAGのハッシュは教育用の関数で、実機の振り分け結果とは一致しません。BGP multipath、FHRP（VRRP/HSRP）、MLAG・スタックはありません。
- TLSとIPsecは暗号処理を行いません。ESPのペイロードはダミーのバイト列です。
- IPv6は計算・分析ツールとPCAPデコードの範囲で、転送はしません。DHCPは概念説明のみです。
- AWSとTerraformは教育用モデルです。実際のAPI・料金・クォータ・全リソース・Terraform/HCLの全構文には対応しません。
- 進捗はブラウザ・originごとの保存です。クラウド同期はありません。IndexedDB利用不可時もセッションは動作し、保存エラーを表示します。重要なラボはJSONで書き出してください。

## GitHub Pages

1. コードをGitHubリポジトリへpushします（この作業環境ではリポジトリは未接続です）。
2. GitHubのSettings → Pages → Sourceを**GitHub Actions**にします。
3. `main`へのpushまたはworkflow dispatchで、テスト・ビルド・`dist/`配信が実行されます。PRではテスト・ビルドだけを実行します。

`vite.config.ts`の`base: './'`とHashRouterにより、ユーザーページ・リポジトリのサブパス・独自ドメインで同じ成果物を使えます。`/#/...`へのURLにリポジトリ名を埋め込みません。まだ実際のGitHub公開は行っていません。

## 設計資料

- [現状・構成・実装順序](docs/architecture.md)
- [シミュレーションの対応範囲と制約](docs/simulation-scope.md)
- [ライブラリ選定と公式資料](docs/dependencies.md)
- [今後の拡張と受け入れ条件](docs/roadmap.md)
- [実施したテストと検証結果](docs/verification.md)

ライブラリの著作権・ライセンスは各パッケージに従います。React Flowのクレジット表示を保持しています。
