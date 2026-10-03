# Architecture

## 前提

開始時の`/home/i_wada/develop/network`にはアプリコードもGitの有効なメタデータもありませんでした（`.git`ディレクトリは空）。Node.js 22.17.1 / npm 10.9.2。最初のVertical Slice（IPv4静的Routing）の上に、既存機能を保ったまま全12章・6 Capstoneへ拡張しています。全面的な書き直しはしていません。

## 責務

| 層 | 責務 | 主なファイル |
| --- | --- | --- |
| React UI | 表示、入力、学習ページ、可視化、選択・再生 | `src/app/`, `src/components/` |
| UI state | 選択機器・リンク・イベント、タブ、通知、保存状態、更新番号 | `src/stores/ui.ts` |
| Application | 操作の受付、CLI呼び出し、保存・読み込み、進捗、採点の実行、切り分け | `src/application/` |
| Network Core | 機器・リンク・L2・LAG・ARP・ルーティング（ECMP）・TCP/UDP・DNS・NAT・Firewall・OSPF・BGP・トンネル・帯域モデル | `src/simulator/core/NetworkSimulator.ts`, `src/simulator/core/flow.ts`, `src/simulator/{l2,l3,services,routing}/` |
| Capture | バイト列エンコード、デコード、フィルタ、PCAP入出力 | `src/simulator/capture/` |
| CLI | 構文分割、Registry、モード、状態からの出力生成（Linux / IOS風） | `src/cli/` |
| AWS | VPCの教育用モデル、設計検証、往復の到達性分析 | `src/aws/` |
| Terraform | HCLサブセットのparser、evaluator、リソーススキーマ、plan/apply/state、AWSモデルへの変換 | `src/terraform/` |
| Labs | 各ラボの初期構成・参考解・最終状態の採点 | `src/labs/` |
| Storage | IndexedDBのスキーマ | `src/db/database.ts` |
| Content | 教材Markdown、カリキュラム、Quiz、VLSM | `src/content/`, `src/lessons/` |

Core（`simulator` / `aws` / `terraform` / `cli` / `labs`）はReact、Zustand、DOM、Dexie、実時間、タイマー、I/Oをimportしません。入力・結果・snapshotはすべてstructured clone可能なデータです。Workerへ移す場合は、Application層の呼び出しをmessage request/responseに置き換える境界になります。ReactコンポーネントにARP・経路選択・TCPなどのプロトコル処理は書かず、可視化ツールもCoreのAPI（`ping` / `http` / `dnsLookup` / `ospf()` / `bgp()` / `analyzePath` / `buildPlan` など）を呼んで結果を表示するだけです。

ビルドでは、UIに依存しないエンジン群を`engine`チャンク、React Flowを`topology`、Dexieを`persistence`に分け、Terminal・CodeMirror・教材・各ページはlazy loadします。

## Network Core

- 設定APIは`addDevice / update / connect / configureInterface / addRoute / setLinkState ...`。入力検証はCoreが行い、UIにもCLIにも依存させません。`snapshot / device`は複製を返します。
- 設定変更のたびに`recompute`で、LAG（`l2/Lag.ts`: メンバーの束ね・suspended・down）・Line protocol・STP（束ねたメンバーはPort-channelの1ポートとして計算）・トンネル状態・OSPF・BGPを定常状態として再計算し、動的経路を機器に反映します。ARPとMAC表はトポロジー変更時にクリアします。
- 経路選択（`l3/RoutingTable.ts` の `resolveRoute`）は、同じプレフィックス・AD・metricの使える経路をECMPの候補としてまとめ、パケットの5-tuple（`core/flow.ts`）のハッシュで1つを選びます。LAGのメンバーも、`port-channel load-balance` の入力のハッシュでフレームごとに選びます。どちらも選択の理由（候補・入力・結果）をイベントに残します。
- `throughput()` は帯域モデルです。各ストリームで実際にTCP接続を開いて通り道を決め、リンク速度から上限を求め、共有するリンクをmax-min公平で分けます（`iperf3`・ラボの採点・可視化が共通で使います）。
- IPv4の転送は「ingress ACL → NAT（外→内）→ 自分宛て/トンネル終端 → 転送可否 → TTL → 経路選択 → Firewall → TTL減算 → NAT（内→外）→ egress ACL → トンネル化 → リンク → ARP → L2」の順です。応答（Echo Reply、SYN/ACK、DNS応答、ICMPエラー）は受信側で新しく作り、独立に復路をルーティングします。宛先が存在するだけで成功にはしません。
- L2はスイッチごとにMAC学習・VLAN・STPの転送可否を評価し、フレームを実際に配送します。ループ時は256フレームで打ち切ります。
- すべての処理は`SimulationEvent`と`Capture`（バイト列）を残します。Debugger、Event Log、Capture、tcpdump、採点、切り分けラダーは同じ記録を共有します。

## Application

- `LabController`: ネットワークのワークスペース（プレイグラウンドは`current`、ラボは`lab:<id>`）を開く・保存・変更・実行・リセット。採点は現在の構成の複製に対して行い、Troubleshootingは「原因の層」の回答も必要です。章のMastery用ラボを完了すると`<章>-mastery`を記録します。
- `CloudController`: AWSとTerraformのワークスペース（`workspaces`テーブル）。
- `diagnose`: 切り分けラダー（Link → IP → Gateway → ARP → Route → DNS → TCP → TLS → Application）を構成の複製で実行し、最初に失敗した層で止まります。

## 状態・永続化

ZustandはUI状態と更新通知だけを持ちます。機器・ARP・経路などはNetworkSimulatorが所有し、操作の終了時に一度だけ通知します。

Dexie v3のテーブルは`labs / progress / quizzes / history（labId付き）/ settings / workspaces / designs`です。ネットワークの書き込みは直列化し、250msでまとめて自動保存します。AWSは変更時点のIDとモデルを複製して直列に保存し、ラボ切り替え前に書き込み完了を待ちます。IndexedDBが使えない場合も通知したうえでセッションは動き、JSON書き出しを使えます。破損データで既存DBを自動上書きしません。外部JSONは形式・アドレス・ポート・リンク等を検証してから反映し、任意コードやコマンドは実行しません。PCAPはサイズとパケット数の上限を設けて読み込み、ブラウザ外へ送信しません。

プレイグラウンドとAWSの作業領域には構成名・元テンプレート・名前付き保存先IDを保持します。`DesignControls`が新規作成・テンプレート選択・命名保存・再読込を共通化し、`designs`には明示的に保存した構成のスナップショットを作業領域から独立して格納します。別名保存は新しいIDを生成するため、元の保存済み構成やテンプレートを変更しません。既存データはv3へ移行して引き続き読み込み、構成名の情報がない場合は旧レコード名などで補います。

## 学習の構成

各章は Theory / Visual / Playground / Guided Lab / Challenge / Troubleshooting / Professional Notes / Quiz / Mastery Check の9ステップです。QuizとMastery Checkは別に判定し、Mastery Checkは指定したラボの最終状態（TCP/IPとサブネットは観測値・計算とアドレス設計パズル）で判定します。ラボの採点は入力したコマンドではなく到達性・設定・分離で行い、複数の解き方を許します。Troubleshootingの問題文は「通信できません。原因を特定して直してください」です。

## テスト方針

- Vitest（575件）: CIDR・VLSM、経路選択、ARP・MAC学習・VLAN・STP、Link Aggregation・LACP、ECMP・フローのハッシュ、帯域モデル、ICMP・TCP・UDP・DNS・TLS・HTTP、NAT・ACL・Firewall、OSPF・BGP・トンネル、エンコード/デコード/フィルタ/PCAP、CLI、AWS分析、Terraform（parser・plan・drift・import・module）、切り分け、ポートと媒体の対応表、可視化ツールが示す教育上の主張、そして**全74ラボが「初期状態では不合格・参考解で合格」**であることと、近道（STPに任せる・故障したケーブルを直す・全リンクを増速する・静的ECMPで済ませる・STPを止める）を合格にしないこと。
- Playwright（34件）: `dist/`を`/network-test/`に静的配信し、GUIとTerminalでのVertical Slice、保存と復元、deep link、幅1024pxでの教材、Quiz、Mastery、全章の可視化、AWS・Terraform・Analyzer・ラボ一覧、配線・移動・リンク障害、IndexedDB不可時の動作を確認します。構成管理は両エディタの空の新規作成・テンプレート編集・命名保存・再読込・ラボとの分離・幅1024pxでの操作に加え、削除確認・キャンセル・保存失敗・削除後の再保存を検証します。AWS公式アイコンの読み込みと既存の図の重なり（LAG・ECMP・冗長化のテンプレートを含む）、LAGをTerminalで組んだ結果が構成図の Port-channel 表示と Debugger の Path 表示に出ること、ECMPの可視化で静的ルートとOSPFの故障時の違いが出ることも確認します。ブラウザテストはCoreテストの代わりにはしません。
