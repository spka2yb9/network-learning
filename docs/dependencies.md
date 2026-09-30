# ライブラリ選定

2026-09-28に公式ドキュメント、公式リポジトリ、npmの配布メタデータを確認。実際の解決バージョンとintegrityは`package-lock.json`を正とします。

## 採用基準

ブラウザ動作、静的配信、メンテナンス状況、ライセンス、独自実装に対する利点を確認しました。実行時の各ライブラリはViteビルドに含まれ、GitHub Pagesでサーバー処理を要求しません。ビルド・テスト系は開発環境 / Actionsだけで使います。

| ライブラリ | 確認した採用版 | ライセンス | ブラウザ / 採用理由 / 公式資料 |
| --- | --- | --- | --- |
| React / React DOM | 19.3.0 | MIT | DOM表示とコンポーネント境界。[公式導入](https://react.dev/learn/build-a-react-app-from-scratch) |
| React Router DOM | 7.18.4 | MIT | HashRouterでサーバーrewrite不要。[HashRouter](https://reactrouter.com/api/declarative-routers/HashRouter) |
| Zustand | 5.0.15 | MIT | 小さいUIストア。Coreの状態を保持しない。[公式repo](https://github.com/pmndrs/zustand) |
| Dexie | 4.4.6 | Apache-2.0 | ブラウザIndexedDB、スキーマ・transactionを独自実装しない。[公式React guide](https://dexie.org/docs/Tutorial/React)、[repo](https://github.com/dexie/Dexie.js) |
| @xyflow/react | 12.12.0 | MIT | ポート、配線、zoom/pan、選択、移動を再利用。[公式](https://reactflow.dev/learn)。Cytoscape等は併用しない |
| @aws-icons/svg | 4.1.1 | パッケージ: MIT / アイコン: AWSの利用条件 | 2026-09-29に追加。AWS公式のArchitecture Iconsを収録する第三者配布パッケージ。必要なSVGのみを直接importし、Vite成果物に同梱。AWS自身が提供するnpmライブラリではありません。[配布元](https://github.com/MKAbuMattar/aws-icons)、[AWS公式素材・利用条件](https://aws.amazon.com/architecture/icons/) |
| @xterm/xterm / addon-fit | 6.0.0 / 0.11.0 | MIT | 入力・描画だけに限定。PTY、WebSocketは導入しない。[公式addon guide](https://xtermjs.org/docs/guides/using-addons/)、[repo](https://github.com/xtermjs/xterm.js) |
| ipaddr.js | 2.5.0 | MIT | IPv4/IPv6の成熟した検証処理。bit ANDの教材表示は自前で実装。[公式](https://github.com/whitequark/ipaddr.js) |
| react-markdown | 10.1.0 | MIT | MarkdownをReact要素として表示。raw HTMLは有効化しない。[公式](https://github.com/remarkjs/react-markdown) |
| remark-gfm | 4.0.1 | MIT | 教材Markdownの表・打ち消し線などGFM記法。react-markdownの公式プラグイン機構で追加し、raw HTMLは引き続き無効。[公式](https://github.com/remarkjs/remark-gfm) |
| codemirror / @codemirror/state・view・language | 6.0.2 / 6.7.6・6.43.13・6.12.4 | MIT | Terraform Labのコードエディタ（行番号・undo・検索・括弧対応・IME）。自前のtextareaでは編集体験と日本語入力の品質を保てないため採用。HCL用のハイライトは`StreamLanguage`で数十行の定義を自作し、言語パッケージは追加しない。Terraformページでのみlazy load。[公式](https://codemirror.net/docs/) |
| @lezer/highlight | 1.2.5 | MIT | CodeMirrorのハイライトタグ（`tags`）。CodeMirror本体の依存で、追加の役割重複はない。[公式repo](https://github.com/lezer-parser/highlight) |
| driver.js | 1.8.0 | MIT | 2026-09-29に追加。プレイグラウンド・AWS VPC Designer・Terraform Labの操作ガイド（スポットライト＋吹き出し、キーボード操作）。依存なし。対象要素への位置合わせ・スクロール追従・リサイズ対応を自作しないため採用。見た目は`features.css`でサイトのトークンに合わせ、各ページのchunkにのみ含む。[公式](https://driverjs.com/)、[repo](https://github.com/kamranahmedse/driver.js) |
| Vite / React plugin | 7.3.6 / 5.2.0 | MIT | 静的ビルド。使用中のNode版をサポート。[静的配信](https://vite.dev/guide/static-deploy)、[build](https://vite.dev/guide/build) |
| TypeScript | 5.9.3 | Apache-2.0 | strict型検査。開発時のみ |
| Vitest | 4.0.18 | MIT | UIなしのCoreテスト、CLI結合検証。[公式](https://vitest.dev/guide/) |
| @playwright/test | 1.63.0 | Apache-2.0 | 本番静的ビルドを実ブラウザで検証。開発時のみ。[公式](https://playwright.dev/docs/intro)、[license](https://github.com/microsoft/playwright/blob/main/LICENSE) |

各プロジェクトの配布版を使用しています（AWS素材のパッケージは上記の第三者配布）。AWSアイコンの著作権・ライセンス表記は`public/aws-icons-NOTICE.txt`からビルド成果物にも同梱します。Viteは使用中の7系、Vitestは4.0.18を使用し、最新majorへ無条件に追従しません。npm 10.9.2でVitest 4.1系のoptional peer依存解決が内部エラーになったため、4.0.18に固定しました。これは実行環境と依存解決の互換性に基づく選択です。

導入後にstrict typecheck、Vite本番ビルド、Vitest、ブラウザ実行で互換性を確認します。第三者コードを再配布する際はライセンス・copyright表記を保持し、依存を更新した場合は再確認してください。

## 採用しなかったもの（自前実装）

- **PCAPパーサー**: pcap / pcapng の読み込みは`src/simulator/capture/pcap.ts`で`DataView`を使い自作しました（約100行）。対応するブロックとリンク種別を限定し、サイズ・パケット数・パケット長の上限、切り詰められたファイルの警告を明示的に扱うためです。既存ライブラリはNode向け（stream / Buffer前提）か、ブラウザで使うには多くのpolyfillが必要なものが中心で、利点が上回りませんでした。デコーダもキャプチャの生成側と同じデータモデルを使うため自作です。
- **HCLパーサー**: 公式のHCL実装はGo製です。ブラウザ向けのJS/WASM移植は、評価（参照・関数・count・module）やTerraformの意味論を含まず、構文木だけを得ても利点が小さいため採用しませんでした。`src/terraform/parser/`は対応構文を明示した限定パーサーで、未対応構文はエラーにします。Terraform本体との互換は主張しません。
- **グラフ / チャート / アニメーション / UIライブラリ**: 追加していません（操作ガイドのdriver.jsを除く）。構成図はReact Flow、それ以外はCSSと小さなSVGで描いています。外部フォント配信にも依存しません。
- **Web Worker化のライブラリ（Comlink等）**: 現状は不要です。Coreは構造化複製可能なデータだけを扱うため、必要になった時点で`postMessage`の薄い層で移せます。

## GitHub Pages検証

`base: './'`で成果物中のasset URLを相対化。HashRouterの経路はHTTPリクエストに含まれません。E2Eでは`/network-test/`配下にdistを置き、hash deep link、再読み込み、lazy chunk、CSSが404にならないことを確認します。実GitHub Pagesへの公開は、リポジトリとActions設定が必要です。
