import { useEffect } from 'react';
import { driver, type Driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';

const keys = '<kbd>←</kbd> <kbd>→</kbd> で移動、<kbd>Esc</kbd> でいつでも閉じられます。';
const tours = {
  playground: [
    { popover: { title: 'プレイグラウンドへようこそ', description: `画面の使い方を1分で案内します。<br>${keys}` } },
    { element: '.design-controls', popover: { title: '構成を選ぶ・保存する', description: '「<b>テンプレートを開く</b>」で完成済みのネットワークから始められます。「新規作成」なら空の状態から。編集中の内容はブラウザに自動保存されます。', side: 'bottom' } },
    { element: '.device-palette', popover: { title: '機器を置く', description: 'クリックで追加、キャンバスへ<b>ドラッグ</b>すれば好きな位置に置けます。', side: 'right' } },
    { element: '.topology', popover: { title: 'ケーブルでつなぐ', description: '機器の<b>ポート（左右の丸い点）から別のポートへドラッグ</b>して配線します。<br>ケーブルを<b>ダブルクリック</b>でリンクの Down / Up、選んで <kbd>Delete</kbd> で削除。ホイールでズームできます。' } },
    { element: '.workspace-inspector', popover: { title: '機器を設定する', description: '機器をクリックすると、ここでIPアドレス・経路・VLANを設定できます。上のタブで「状態」「Debugger」「切り分け」に切り替えます。', side: 'left' } },
    { element: '.send-packet-bar', popover: { title: 'パケットを送る', description: '送信元・種類・宛先を選んで実行すると、ping などが流れます。結果は<b>Debugger</b>で1ホップずつ再生できます。', side: 'top' } },
    { element: '.bottom-tabs', popover: { title: 'コマンドとログ', description: '<b>Terminal</b>でCLIを直接入力、<b>Packet Capture</b>でフレームの中身を確認、<b>Event Log</b>で起きたことを順番に追えます。', side: 'top' } },
    { element: '.toolbar-actions', popover: { title: 'いつでも見返せます', description: '書き出し・読み込み・リセットはここ。このガイドも「操作ガイド」からもう一度開けます。<br>まずはテンプレートを開いて ping を送ってみましょう！', side: 'bottom', align: 'end' } },
  ],
  aws: [
    { popover: { title: 'VPC Designerへようこそ', description: `AWSのネットワーク（VPC）をブラウザの中で組み立てる画面です。実際のAWSには接続しません。<br>${keys}` } },
    { element: '.design-controls', popover: { title: '構成を選ぶ・保存する', description: '「<b>テンプレートを開く</b>」で基本のVPCや3層構成から始められます。「新規作成」なら空の状態から。編集中の内容はブラウザに自動保存されます。', side: 'bottom' } },
    { element: '.aws-add', popover: { title: '部品を追加する', description: 'VPC → Subnet → Route Table → Internet Gateway … の順に足していくと組み立てやすくなります。ボタンにマウスを乗せると、部品の説明が出ます。', side: 'right' } },
    { element: '.aws-diagram', popover: { title: '構成図で確かめる', description: '追加した部品がVPC・AZ・サブネットの入れ子で描かれます。<b>部品をクリック</b>すると選択できます。' } },
    { element: '.aws-props', popover: { title: '部品を設定する', description: '選んだ部品のCIDR・ルート・セキュリティグループのルールなどを、ここで編集します。', side: 'left' } },
    { element: '.aws-analyzer', popover: { title: '通信が届くか分析する', description: '送信元・宛先・ポートを選んで「<b>分析</b>」。ルートテーブル・NACL・SGを<b>行きと帰りの両方</b>でたどり、止まった場所が構成図でも強調されます。', side: 'top' } },
    { element: '.tour-button', popover: { title: 'いつでも見返せます', description: 'このガイドは「操作ガイド」からもう一度開けます。<br>まずは3層構成で、Internet → ALB の 443 を分析してみましょう！', side: 'bottom', align: 'end' } },
  ],
  terraform: [
    { popover: { title: 'Terraform Labへようこそ', description: `HCLでインフラのコードを書き、plan / apply の流れを体験する画面です。本物の Terraform CLI やAWSは動かしません。<br>${keys}` } },
    { element: '.design-controls', popover: { title: '構成を選ぶ・保存する', description: '「<b>テンプレートを開く</b>」でVPCだけの最小構成や3層構成のコードから始められます。「新規作成」なら空の main.tf から。編集中の内容はブラウザに自動保存されます。', side: 'bottom' } },
    { element: '.file-tabs', popover: { title: 'ファイルを切り替える', description: 'タブでファイルを切り替えます。右の欄に <code>network.tf</code> や <code>modules/net/main.tf</code> と入力すると、ファイルを追加できます。', side: 'bottom' } },
    { element: '.code-editor', popover: { title: 'コードを書く', description: 'HCLのコードを編集します。コメント（# …）に、各ブロックの意味を書いてあります。', side: 'right' } },
    { element: '.tf-commands', popover: { title: 'コマンドを実行する', description: '<b>init → validate → plan → apply</b> の順に押してみましょう。ボタンにマウスを乗せると説明が出ます。下の欄には <code>state show …</code> なども入力できます。', side: 'top' } },
    { element: '.tf-output', popover: { title: '結果を読む', description: 'plan の <b>+</b>（作成）・<b>~</b>（変更）・<b>-</b>（削除）を確かめてから apply を承認します。', side: 'top' } },
    { element: '.tf-events', popover: { title: '運用のトラブルを試す', description: 'コンソールでの手作業（ドリフト）や、チームメイトの state ロックを再現できます。「初期状態に戻す」でやり直せます。', side: 'top' } },
    { element: '.tf-side', popover: { title: 'できたものを見る', description: 'apply 後の<b>構成図</b>、リソースを作る順番（<b>依存関係</b>）、<b>state</b> の中身、<b>到達性</b>の分析を切り替えて確かめます。', side: 'left' } },
    { element: '.tour-button', popover: { title: 'いつでも見返せます', description: 'このガイドは「操作ガイド」からもう一度開けます。<br>まずは terraform init を押してみましょう！', side: 'bottom', align: 'end' } },
  ],
} satisfies Record<string, DriveStep[]>;
export type TourId = keyof typeof tours;

let active: Driver | undefined;
const seenKey = (id: TourId) => `path:${id}-tour`;

export function stopTour() { active?.destroy(); }

export function startTour(id: TourId) {
  active?.destroy();
  // Lab pages lack some parts (e.g. design controls); drop steps whose target isn't on screen so the progress count stays honest.
  const available = (tours[id] as DriveStep[]).filter(s => !s.element || document.querySelector(s.element as string));
  active = driver({
    steps: available, showProgress: true, progressText: '{{current}} / {{total}}',
    nextBtnText: '次へ', prevBtnText: '戻る', doneBtnText: 'はじめる',
    popoverClass: 'path-tour', overlayColor: '#10231c', overlayOpacity: 0.55, stagePadding: 6, stageRadius: 10,
    animate: !matchMedia('(prefers-reduced-motion: reduce)').matches,
    onPopoverRender: (popover, { state }) => popover.wrapper.style.setProperty('--tour-progress', `${((state.activeIndex ?? 0) + 1) / available.length * 100}%`),
  });
  active.drive();
  // Once shown counts as seen (driver.js skips onDestroyed when closed mid-animation). The 操作ガイド button replays it.
  try { localStorage.setItem(seenKey(id), '1'); } catch { /* storage disabled: shown again next visit */ }
}

/** Starts the tour once, on the first visit with a desktop-size screen, as soon as `ready`; closes it when the page goes away. */
export function useFirstVisitTour(id: TourId, ready: boolean) {
  useEffect(() => {
    let seen = true;
    try { seen = !!localStorage.getItem(seenKey(id)); } catch { /* storage disabled: don't auto-start */ }
    const timer = ready && !seen && !matchMedia('(max-width: 800px)').matches ? setTimeout(() => startTour(id), 400) : undefined;
    return () => { clearTimeout(timer); stopTour(); };
  }, [id, ready]);
}
