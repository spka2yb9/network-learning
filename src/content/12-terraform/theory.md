## この章で学ぶこと

博士：ノード君、第10章では、AWSのコンソール（ブラウザで操作する管理画面）からVPCを作ったな。VPC、サブネット、ルートテーブル、Internet Gateway、セキュリティグループ。1つずつ画面を開いて、ボタンを押して作っていった。

ノード：はい。クリックする場所が多くて、けっこう大変でした。

博士：では、ある日上司からこう頼まれたとしよう。「同じネットワークを、検証用にもう1つ作っておいて。それと、先週だれが何を変えたのか教えて」。

ノード：え〜っと……同じ画面操作を最初からもう一度やって……先週の変更は……うっ、覚えてないッス。

博士：手作業で作ったネットワークは、この2つの問いにとても答えにくいのだ。そこでこの章では、ネットワークをテキストファイルに書いて管理する道具、**Terraform（テラフォーム）** を学ぶ。くわしい定義は次のページでするから、今は「ネットワークをファイルに書いておくと、そのとおりに作ってくれる道具」と思っておけばよい。

ノード：ファイルに書くと、作ってくれる……。プログラミングみたいですね。

博士：近いが、少し違う。そこも順に話そう。

### この章が答える問い

博士：この章の問いは、ひとつだけだ。

> **ポイント**
> 「このファイルを実行したら、何が新しく作られ、何が変わり、何が消えるのか」を、**実行する前に** 読めるか。

ノード：実行する前に、ですか？ 実行してみればわかるのに。

博士：ネットワークは、実行してから「しまった」では遅いのだ。サブネットを1つ消したら、その上のサーバーも通信できなくなる。Terraformは、実行の前に「これからこう変えます」という予告を見せてくれる。その予告を正しく読めるようになるのが、この章のゴールなのだ。

### 読み終えるとできること

- VPCやサブネットを、Terraformのファイルで書ける（書き方は第3ページから）
- 実行前の予告（`terraform plan` の出力）を読んで、「作る」「その場で変える」「作り直す」「消す」を見分け、作り直しになる理由を説明できる
- Terraformが付けている記録（state）の役割と、だれかが画面から手で変えたときに何が起きるかを説明できる
- 値を外から渡す仕組み・繰り返し・部品化を使って、同じ形のネットワークを値だけ変えて作れる
- チームで使うときに守ること（記録の共有とロック、予告のレビュー）を説明できる

### 前提

この章では、次の章で学んだことを使います。

- **第2章**: CIDR（`10.0.0.0/16` のように、アドレスの範囲を「先頭何ビットがネットワーク部か」で書く方法）と、大きな範囲を小さなサブネットに分ける計算
- **第10章**: VPC（AWSの中に作る自分専用のネットワーク）、サブネット、ルートテーブル、Internet Gateway、セキュリティグループ、リージョンとAZ

忘れていても大丈夫です。使う場面で、もう一度短く説明します。

### この章の例のネットワーク

博士：この章では、最初から最後まで、次のネットワークを使う。第10章で画面から作ったものとほぼ同じ形だが、今回はすべてファイルに書いて作るのだ。

```theory-diagram
terraform-target-tree
```

ノード：VPCの中に、パブリックサブネットが1つ、プライベートサブネットが2つ。それに、インターネットへの出入口とセキュリティグループですね。

博士：うむ。これを、次のような順で少しずつ書き足していく。

1. VPCを1つだけ書いて、作る
2. パブリックサブネット・Internet Gateway・ルートテーブル・セキュリティグループを足す
3. 設定を変えてみて、「その場で変わる」変更と「作り直し」になる変更を見比べる
4. 値を変数に出し、プライベートサブネット2つを繰り返しで書く
5. 画面から手で変えられたときの扱いと、チームでの使い方を知る
6. 同じ形の検証用VPCを、部品（module）からもう1つ作る

博士：Simulationタブでは、この順番のとおりに、自分の手でファイルを書いて実行してもらう。各ページで出てくる出力は、Simulationで実際に表示されるものと同じ形だ。

> **シミュレータ**
> このサイトのTerraformは、ブラウザの中で動く教育用のシミュレータです。本物のTerraformやAWSは動かさず、AWSのアカウントも要りません。「apply」すると、ブラウザの中の「シミュレートされたAWS」にVPCなどが作られ、右側の構成図に描かれます。出力の形は本物に似せていますが、細部は異なります。

ノード：本物のAWSにお金がかからないなら、安心していろいろ試せますね。

博士：うむ。壊して覚えるのが一番だ。では始めよう。

## 手作業のネットワークは、なぜ困るのか

博士：まず、さっきの上司の頼みごとを、もう少し具体的に考えてみよう。第10章で作ったネットワークを、ノード君はどうやって記録しておく？

ノード：え〜っと、作るときの手順をメモしておきます。「VPCの画面を開く → 名前に path-vpc → CIDRに 10.0.0.0/16 → 作成ボタン」みたいに。

博士：いわゆる **手順書** だな。では、その手順書があれば、困りごとは全部解決するかね？

### 手順書だけでは答えられない3つの問い

博士：手作業と手順書だけで運用していると、次の3つの問いに答えにくくなる。

```text
問い1  同じものを、もう1つ作れるか？
       → 手順書を見ながら、全部の画面操作をもう一度。どこかで1か所打ち間違えると、少し違うネットワークができる。

問い2  いまの実物は、手順書と同じか？
       → 先週だれかが画面から1行ルールを足していたら、手順書はもう実物と合っていない。
         確かめるには、全部の画面を開いて見比べるしかない。

問い3  だれが、いつ、なぜ変えたのか？
       → 画面操作の記録は残りにくい。理由はほぼ残らない。
```

ノード：問い2がこわいですね……。手順書を信じて作業したら、実物が違っていた、ってことですよね。

博士：そうだ。手順書は「作ったときの手順」の記録であって、「いまの実物」を表していないのだ。

### インフラをコードで書く：IaC

博士：そこで生まれた考え方がある。サーバーやネットワークのような、システムの土台になる部分を **インフラ**（インフラストラクチャ）と呼ぶ。そのインフラの「あるべき姿」を、テキストファイルに書いておくのだ。

> **用語：IaC**（アイエーシー／Infrastructure as Code）
> ネットワークやサーバーなどのインフラの「あるべき姿」をテキストファイル（コード）に書き、そのファイルをもとにインフラを作ったり変えたりする考え方。ファイルが、いまのインフラの正しい姿の記録になる。

ノード：ファイルに書くだけで、さっきの3つの問いに答えられるんですか？

博士：1つずつ見ていこう。問い1の「もう1つ作れるか」。ファイルがあれば、同じファイルを、値だけ変えてもう一度使えばよい。画面操作の打ち間違いは起きない。くわしいやり方は、この章の最後のほうで見る。

ノード：あ、それはわかります。あるべき姿がファイルに全部書いてあるから、何度でも同じ形のものが作れるんですね。

博士：問い2と問い3には、ファイルの変更履歴を管理する道具が効いてくる。ノード君、Gitは知っているかね？

ノード：名前は聞いたことがあります。プログラムのファイルを管理するものですよね？

博士：うむ。

> **用語：Git**（ギット）
> ファイルの変更履歴を記録する道具。「いつ・だれが・どの行を・なぜ（コメント）」変えたかが残り、過去のどの時点の内容にも戻せる。プログラムのソースコードの管理で広く使われている。

博士：インフラをファイルに書いてGitで管理すれば、「先週だれが何を変えたか」は、Gitの履歴を見れば1行単位でわかる。これが問い3の答えだ。

ノード：問い2の「いまの実物と同じか」は？

博士：それは、この章の後半で出てくる **drift** という話で答える。Terraformには、ファイルと実物を見比べる仕組みがあるのだ。今は「答えられる仕組みがある」とだけ覚えておきたまえ。

博士：もう1つ、Gitと組み合わせてよく使う仕組みがある。

> **用語：プルリクエスト**（Pull Request）
> ファイルの変更を、本番に反映する前にほかの人に見てもらう（レビューしてもらう）ための依頼。変更した行が一覧で表示され、承認されてから取り込まれる。

博士：インフラの変更もプルリクエストにすれば、「この変更でサブネットが消えないか」を、実行の前に別の人がチェックできる。

ノード：画面操作だと、操作する人しか見てないですもんね。

### Terraformは、AWSに「頼む」道具

博士：では、IaCを実現する道具のひとつ、Terraformをきちんと定義しよう。

> **用語：Terraform**（テラフォーム）
> IaCのための代表的な道具。HashiCorp社が開発している。インフラのあるべき姿を書いたファイルを読み、いまの実物との差を計算して、足りないものを作り、違うものを直し、要らないものを消す。AWSのほか、さまざまなクラウドやサービスに対応する。

ノード：Terraformは、どうやってAWSにVPCを作るんですか？ 画面のボタンを自動で押すんですか？

博士：いいところに気づいたな。画面のボタンを押すわけではない。AWSには、プログラムから操作を頼むための窓口が用意されているのだ。

> **用語：API**（エーピーアイ／Application Programming Interface）
> プログラムからサービスを操作するための窓口。「VPCを作って。CIDRは 10.0.0.0/16」のような依頼を決まった形式で送ると、サービスがその操作をして結果を返す。

博士：実は、ノード君が第10章で使ったコンソールも、裏ではこのAPIを呼んでいる。ボタンを押すと、画面がAPIに「VPCを作って」と頼んでいるのだ。Terraformは、その同じAPIに、ファイルの内容をもとに頼むわけだな。

```theory-diagram
terraform-api-path
```

ノード：入口が違うだけで、最後に頼む相手は同じなんですね。

### 手順ではなく、完成図を書く

博士：さて、Terraformのファイルには、もう1つ大事な性格がある。手順書との違いを比べてみよう。

| 手順書：手順を書く | Terraform：完成図を書く |
| --- | --- |
| VPCを作る（10.0.0.0/16） | VPCが1つある。CIDRは10.0.0.0/16 |
| サブネットを作る（10.0.1.0/24） | サブネットが1つある。CIDRは10.0.1.0/24 |
| サブネットをVPCに入れる | サブネットは上のVPCの中にある |

ノード：右側には「作る」って書いてないですね。「ある」って書いてある。

博士：そこが肝心なのだ。右側のように、手順ではなく「最終的にこうなっていてほしい」を書くやり方を **宣言的** と呼ぶ。

> **用語：宣言的**（せんげんてき／declarative）
> 「どうやって作るか（手順）」ではなく「最終的にどうなっていてほしいか（完成図）」を書くやり方。どの順で何をするかは、道具の側が考える。

ノード：完成図だけ渡して、作り方は任せる……。でも、それって何がうれしいんですか？

博士：同じファイルを2回実行したときを考えてみたまえ。手順書を2回実行したら？

ノード：VPCが2つできちゃいます。

博士：完成図なら？

ノード：「VPCが1つある」状態は、もうできてるから……何もしない？

博士：その通り。完成図と実物を比べて、差があるところだけを直す。だから何度実行しても、完成図どおりの状態に落ち着くのだ。

博士：たとえるなら、レストランの注文だな。客は「カレーを1つ」と完成品を注文する。作り方は厨房の仕事だ。カレーがもうテーブルにあるのに「カレーが1つある状態にして」と頼まれたら、厨房は何もしない。

ノード：なるほど！ ……でも、もし「カレー1つ」の注文なのに、テーブルにカレーが2つあったら？

博士：鋭いな。Terraformは、自分が作って管理しているものについては、余分なものを片付ける。ここがレストランとの違いで、Terraformは「注文にないもの」を消すこともあるのだ。どれを自分が管理しているかの記録（state）は、第5ページで話す。

> **注意**
> 「AWSを操作するコマンドを並べたスクリプト」は、IaCのように見えても手順書と同じ性格です。2回実行すると2回作ろうとします。Terraformのファイルは完成図なので、何度実行しても同じ状態に落ち着きます。

> **まとめ**
>
> - 手作業と手順書だけでは「もう1つ作れるか」「実物は手順書と同じか」「だれがなぜ変えたか」に答えにくい
> - IaCは、インフラのあるべき姿をファイルに書き、Gitとプルリクエストで履歴とレビューを残す考え方
> - Terraformは、ファイルを読んでAWSのAPIに作成・変更・削除を頼む道具
> - Terraformのファイルは宣言的（完成図）。実物との差だけを直すので、何度実行しても同じ状態になる

## HCLで、VPCを1つ書いてみる

博士：では、いよいよ完成図を書いてみよう。Terraformのファイルは、専用の書き方で書く。

> **用語：HCL**（エイチシーエル／HashiCorp Configuration Language）
> Terraformのファイルを書くための言語。「名前 = 値」の行と、それを `{ }` で囲んだまとまりで、インフラのあるべき姿を書く。ファイルの拡張子は `.tf`。

ノード：プログラミング言語を1つ覚えないといけないんですか……。

博士：焦るでない。HCLの形は、ほとんど2種類しかない。まずは完成形を見てしまおう。例のネットワークのVPCを1つ作るファイル、`main.tf` だ。

```hcl
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "ap-northeast-1"
}

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"

  tags = {
    Name = "path-vpc"
  }
}
```

ノード：`{ }` がたくさんありますね。

博士：うむ。一番下の `resource` から読んでいこう。いちばん大事なところだからな。

### 形1：ブロック

博士：`resource "aws_vpc" "main" { ... }` のように、「種類 → `"` で囲んだ名札 → `{ }` の中身」という形のまとまりを、**ブロック** と呼ぶ。

> **用語：HCLのブロック**（block）
> HCLの基本の単位。`種類 "名札" "名札" { 中身 }` の形で書く。種類（`resource`・`provider` など）で役割が決まり、`{ }` の中に設定を書く。

博士：種類の後ろの `"aws_vpc"` と `"main"` が、そのブロックの名札だ。これを **ブロックのラベル** と呼ぶ。

> **用語：ブロックのラベル**（label）
> ブロックの種類の後ろに `" "` で囲んで付ける名札。いくつ付けるかはブロックの種類で決まっていて、resourceブロックには2つ付ける。

博士：名札がいくつかはブロックの種類で決まっている。resourceブロックは2つだ。

ノード：`"aws_vpc"` と `"main"`、2つにどんな違いがあるんですか？

博士：1つ目は「何を作るか」、2つ目は「このファイルの中で何と呼ぶか」だ。まず、Terraformが作って管理する1つ1つのものを **リソース** と呼ぶ。

> **用語：リソース**（resource）
> Terraformが作成・変更・削除を管理する、1つ1つのもの。VPC1つ、サブネット1つ、ルートテーブル1つが、それぞれ1つのリソース。resourceブロック1つで、リソースを1つ書く。

博士：そして1つ目の名札 `"aws_vpc"` が、リソースの種類だ。

> **用語：リソースタイプ**（resource type）
> リソースの種類を表す名前。`aws_vpc`（VPC）、`aws_subnet`（サブネット）、`aws_route_table`（ルートテーブル）のように、AWS用のものには先頭に `aws_` が付く。使える名前は決まっていて、自分で新しく作ることはできない。

ノード：2つ目の `"main"` は？ VPCの名前ですか？

博士：いや、そこがよくある勘違いなのだ。`main` は、このファイルの中でこのVPCを呼ぶための名前にすぎない。AWSの画面に表示される名前は、下の `tags` の `Name = "path-vpc"` のほうだ。

> **注意**
> resourceブロックの2つ目の名札（`main`）は、Terraformのファイルの中だけで使う呼び名です。AWS上の名前（コンソールに出る Name）ではありません。`main` を `primary` に変えても、AWSから見た名前は変わりません（ただし、後で見るように Terraform は「別のもの」と考えます）。

博士：そして、リソースタイプと呼び名をドットでつないだ `aws_vpc.main` が、Terraformの中でこのリソースを指す住所になる。

> **用語：リソースアドレス**（resource address）
> Terraformの中で1つのリソースを指す住所。`リソースタイプ.名前` の形で書く。例: `aws_vpc.main`。同じアドレスのリソースは、1つのファイル群の中に1つしか書けない。

ノード：`aws_vpc.main` で「VPCの、mainって呼んでるやつ」ですね。サブネットを作ったら、`aws_subnet.なんとか` になる、と。

博士：その通り。このアドレスは、出力を読むときにも、ほかのリソースから指すときにも、何度も出てくるぞ。

### 形2：「名前 = 値」

博士：ブロックの `{ }` の中に並んでいる `cidr_block = "10.0.0.0/16"` のような行が、もう1つの形だ。

> **用語：引数**（ひきすう／argument）
> ブロックの中に「名前 = 値」の形で書く設定。例: `cidr_block = "10.0.0.0/16"`。どんな名前の引数を書けるか、どれが必須かは、リソースタイプごとに決まっている。

ノード：`cidr_block` は、第10章でVPCを作ったときに入力したCIDRですね。

博士：そうだ。画面の入力欄の1つ1つが、引数の1行1行にあたると思えばいい。値の書き方も見ておこう。

| 値の例 | 型・書き方 |
| --- | --- |
| "10.0.0.0/16" | 文字列。" " で囲む |
| true / false | 真偽値（はい／いいえ） |
| 80 | 数値 |
| ["0.0.0.0/0"] | リスト（[ ] の中に値を並べる） |
| { Name = "path-vpc" } | マップ（{ } の中に「キー = 値」を並べる） |

博士：`tags` は、マップの値を持つ引数だ。キーが `Name`、値が `"path-vpc"`。AWSのコンソールの一覧に表示される名前は、この `Name` タグの値だ。

ノード：あれ、`tags = { ... }` と `resource "..." { ... }` は、どっちも `{ }` ですけど、同じものですか？

博士：よく見ているな。`tags =` のように **イコールがある** ものは引数（値がマップ）、`resource "..." {` のように **イコールがない** ものはブロックだ。見分けはイコールの有無だけでよい。

### provider ブロックと terraform ブロック

博士：さて、上の2つのブロックに戻ろう。Terraform自身は、AWSのAPIの細かい呼び方を知らない。それを知っているのは、AWS用に作られた追加の部品、**provider**（プロバイダ）だ。

> **用語：provider**（プロバイダ）
> TerraformとAPIの間に入る追加部品（プラグイン）。AWS用のプロバイダは、`aws_vpc` などのリソースタイプと、それをAWSのAPIでどう作るかを知っている。Terraform本体とは別に入手する。

博士：`provider "aws" { region = "ap-northeast-1" }` は、そのAWSプロバイダの設定だ。`region` は、第10章で学んだ **リージョン**（東京・大阪のような、AWSの地域）だな。`ap-northeast-1` は東京だ。

ノード：じゃあ、一番上の `terraform { ... }` は？

博士：Terraform自身の設定だ。「このファイルは `hashicorp/aws` というプロバイダの、`~> 5.0` のバージョンを使う」と宣言している。`~> 5.0` は「5.x の範囲で新しいもの。6.0 以上は使わない」という意味だ。

ノード：どうしてバージョンを決めておくんですか？ 新しいほうがよさそうなのに。

博士：プロバイダが大きく変わると、同じファイルでも動きが変わることがあるからだ。チームの全員が同じ範囲のバージョンを使うように、ファイルに書いておくのだ。

### ファイルは「まとめて」読まれる

博士：最後に、ファイルの置き方だ。Terraformは、コマンドを実行したフォルダにある `.tf` ファイルを、すべてまとめて1つの完成図として読む。

> **用語：作業ディレクトリ**（working directory）
> Terraformのコマンドを実行するフォルダ。その中の `.tf` ファイルが全部まとめて読み込まれ、1つの完成図として扱われる。ファイルの分け方や、ブロックを書く順番は、結果に影響しない。

ノード：じゃあ、VPCを `main.tf` に、サブネットを `network.tf` に書いてもいいんですか？

博士：かまわない。読みやすいように分ければいい。よく使う分け方はこうだ。

| ファイル | 役割 |
| --- | --- |
| main.tf | terraform / provider ブロックと、主なリソース |
| variables.tf | 外から受け取る値（第10ページ） |
| outputs.tf | 外へ見せる値（第10ページ） |

> **シミュレータ**
> このシミュレータでは、プロバイダは `aws` だけが使えます。リソースタイプも `aws_vpc`・`aws_subnet`・`aws_internet_gateway`・`aws_route_table`・`aws_security_group`・`aws_instance` など、ネットワークの学習に使うものに絞っています。

> **まとめ**
>
> - HCLの形は「ブロック（`種類 "名札" { }`）」と「引数（`名前 = 値`）」の2つ。イコールの有無で見分ける
> - `resource "aws_vpc" "main"` は「VPC（リソースタイプ）を、mainという呼び名で1つ」。住所（リソースアドレス）は `aws_vpc.main`
> - プロバイダはTerraformとAWSのAPIの間に入る部品。terraformブロックでバージョンの範囲を決める
> - 作業ディレクトリの `.tf` はまとめて読まれ、書く順番は関係ない

## init・validate・plan：実行する前に、予告を読む

```theory-visual
terraform-cycle
```

博士：ファイルが書けたら、いよいよTerraformのコマンドを実行する。ただし、いきなり作りはしない。順番はこうだ。

```theory-diagram
terraform-command-order
```

ノード：実行するまでに、4つもコマンドがあるんですね。

博士：ほとんどは一瞬で終わる。1つずつ見ていこう。

### init：プロバイダを用意する

ノード：さっそく plan を実行してみたいです！

博士：やってみたまえ。

```text
$ terraform plan
╷
│ Error: Inconsistent dependency lock file / Required plugins are not installed
│
│ まだ terraform init を実行していません。
│ terraform init でプロバイダ（AWSと話すプラグイン）を準備してから、もう一度実行してください。
╵
```

ノード：うわ、エラーです。

博士：前のページで、プロバイダは「Terraform本体とは別に入手する」と言ったな。その入手と準備をするのが、最初のコマンドだ。

> **用語：init**（terraform init）
> 作業ディレクトリで最初に実行するコマンド。ファイルに書かれたプロバイダを探して入手し、使える状態にする。後で出てくる module（部品）やstateの置き場所を変えたときにも、もう一度実行する。

```text
$ terraform init
Initializing the backend...
Initializing provider plugins...
- Finding hashicorp/aws versions matching "~> 5.0"...
- Installing hashicorp/aws (simulated)...

Terraform has been successfully initialized!
```

博士：`Finding hashicorp/aws versions matching "~> 5.0"` の行を見たまえ。terraformブロックに書いた「5.x の範囲」で、プロバイダを探しているのがわかる。

ノード：最初の `Initializing the backend...` は何ですか？

博士：stateの置き場所の準備だ。stateはまだ説明していないから、第13ページまで取っておこう。

> **現場では**
> 本物の init は、プロバイダを作業ディレクトリの `.terraform` フォルダにダウンロードし、選んだバージョンを `.terraform.lock.hcl` というファイルに記録します。`.terraform` は各自が init で作るのでGitに入れず、`.terraform.lock.hcl` はGitに入れて、チーム全員が同じバージョンを使うようにします。

### fmt と validate：書き間違いを先に見つける

博士：次の2つは、ファイルの点検だ。まず、書式を整えるコマンドがある。

> **用語：fmt**（terraform fmt）
> ファイルの書式（字下げや、`=` の位置そろえ）を、Terraformの標準の形に自動で整えるコマンド。中身の意味は変えない。`terraform fmt -check` は、整っていないファイル名を表示するだけで、書き換えない。

ノード：見た目を整えるだけなら、なくてもいいのでは？

博士：全員が同じ書式で書けば、Gitで差分を見るときに「書式だけの変更」が混ざらない。レビューが楽になるのだ。そして、もっと大事なのがこちらだ。

> **用語：validate**（terraform validate）
> ファイルの書き方が正しいかを確かめるコマンド。ブロックの形、引数の名前、必須の引数、ほかのリソースの指し方などを調べる。AWSには問い合わせないので、実物があるかどうかは確かめない。

博士：たとえば、`cidr_block` を `cidr` と書き間違えたとしよう。

```text
$ terraform validate
╷
│ Error: Unsupported argument: "cidr" は aws_vpc の引数ではありません（名前の打ち間違いか、このシミュレータが対応していない引数です）
│
│   on main.tf line 15:
╵
```

ノード：`on main.tf line 15` で、どのファイルの何行目かまで教えてくれるんですね。

博士：うむ。引数の名前はリソースタイプごとに決まっている、と前のページで言ったな。プロバイダがその一覧を持っているから、ここで間違いがわかるのだ。正しく書けていれば、こう表示される。

```text
$ terraform validate
Success! The configuration is valid.
```

### plan：何が起きるかの予告

博士：さて、主役の登場だ。

> **用語：plan**（terraform plan）
> ファイル（あるべき姿）といまの実物を比べて、「何を作り、何を変え、何を消すか」の予告を表示するコマンド。表示するだけで、AWSには何も作らず、何も変えない。この予告を実行計画（execution plan）とも呼ぶ。

```text
$ terraform plan
Terraform used the selected providers to generate the following execution plan.
Resource actions are indicated with the following symbols:
  + create

Terraform will perform the following actions:

  # aws_vpc.main will be created
  + resource "aws_vpc" "main" {
      + cidr_block                = "10.0.0.0/16"
      + tags                      = { Name = "path-vpc" }
      + enable_dns_support        = true
      + enable_dns_hostnames      = false
      + id                        = (known after apply)
      + arn                       = (known after apply)
      + main_route_table_id       = (known after apply)
      + default_network_acl_id    = (known after apply)
      + default_security_group_id = (known after apply)
    }

Plan: 1 to add, 0 to change, 0 to destroy.
```

ノード：うっ、英語がいっぱい……。

博士：焦るでない。上から順に、4つのかたまりに分けて読めばよい。

| 読む順番 | 表示の例 | 意味 |
| --- | --- | --- |
| ① 記号の凡例 | `Resource actions are indicated with the following symbols:` / `+ create` | この予告で使う記号。「+ は作成」 |
| ② リソースの見出し | `# aws_vpc.main will be created` | どのリソースアドレスに、何が起きるか |
| ③ リソースの中身 | `+ resource "aws_vpc" "main" {` / `+ cidr_block = "10.0.0.0/16"` | 行頭の記号が、その行で起きること |
| ④ 合計 | `Plan: 1 to add, 0 to change, 0 to destroy.` | 作成1・変更0・削除0 |

ノード：②の `# aws_vpc.main will be created` は、「aws_vpc.main が作られます」ですね。リソースアドレスがここで出てくるんだ。

博士：その通り。そして③の中身を見てみよう。`cidr_block` と `tags` は、ファイルに書いた値そのままだな。

ノード：でも、`enable_dns_support = true` とか、ファイルに書いてない行もありますよ？

博士：いいところに気づいたな。書かなかった引数には、プロバイダが決めている **既定値** が入る。VPCの `enable_dns_support`（VPCの中でDNSを使えるようにするか）は、書かなければ `true` になる、ということが、予告の段階でわかるわけだ。

ノード：じゃあ、`id = (known after apply)` は？ これも書いてないですけど、値がありません。

博士：それが、この予告を読むうえで大事な表示だ。

> **用語：known after apply**（ノウン・アフター・アプライ）
> plan の中で、値の代わりに表示される `(known after apply)`。「実行（apply）した後でわかる」という意味。VPCのIDのように、AWSが作成したときに初めて決める値は、予告の時点ではまだ決まっていない。

博士：VPCのID（`vpc-` で始まる番号）は、だれが決めると思う？

ノード：AWSですよね。作った後に、`vpc-` で始まるIDが付くはずです。

博士：そうだ。作る前にはIDは存在しない。だから予告には「後でわかる」と書いてある。エラーでも、値が空になるわけでもない。

ノード：なるほど。`arn` とか `main_route_table_id` も、作ってから決まるものなんですね。メインルートテーブルは、第10章でVPCを作ったら自動でできていました。

博士：よく覚えていたな。VPCを作ると、AWSがメインルートテーブルや、既定のネットワークACL（`default_network_acl_id`）・セキュリティグループ（`default_security_group_id`）を自動で用意する。そのIDも、作った後でしかわからないのだ。`arn`（Amazon Resource Name）は、AWS全体の中でそのリソースを指す長い名前で、これもAWSが作成時に付ける。

> **注意**
> plan は予告です。plan を何度実行しても、AWSには何も作られません。逆に、plan を読まずに実行するのは、中身を確かめずに書類にハンコを押すのと同じです。

> **シミュレータ**
> plan の出力は、本物のTerraformに似せた教育用の表示です。属性の並び順や、最後に付く「（教育用シミュレーション…）」の行など、細部は本物と異なります。

> **まとめ**
>
> - 順番は init（準備）→ fmt（書式）→ validate（書き方の点検）→ plan（予告）→ apply（実行）
> - init はプロバイダを用意する。最初に1回、プロバイダや module を変えたらもう一度
> - validate はAWSに問い合わせずに書き方を点検し、plan は何も変えずに予告だけを表示する
> - plan は「凡例 → `# アドレス will be ...` → 中身 → `Plan:` の合計」の順に読む。`(known after apply)` は作成後に決まる値

## apply と state：作ったものを覚えておく

博士：予告を読んで、問題がなければ実行だ。

> **用語：apply**（terraform apply）
> plan と同じ予告を表示し、人が「yes」と承認したら、その予告どおりにAWSのAPIを呼んでリソースを作成・変更・削除するコマンド。承認しなければ何もしない。

ノード：さっき plan で予告を見たのに、apply でもう一度予告が出るんですか？

博士：うむ。plan を実行してから apply するまでの間に、だれかが別の変更をしているかもしれない。だから apply は、その瞬間の予告を改めて作って見せ、「これを実行してよいか」と聞くのだ。承認するのは、目の前に表示された予告だ。

### apply を実行する

```text
$ terraform apply
（plan と同じ予告が表示される）

Plan: 1 to add, 0 to change, 0 to destroy.

Do you want to perform these actions?
  Terraform will perform the actions described above.
  Only 'yes' will be accepted to approve.
```

博士：本物のTerraformでは、ここで `yes` と打ち込む。`y` や `Yes` ではだめで、`yes` だけが承認だ。

ノード：うっかりEnterを押しても実行されないように、ですね。

博士：そういうことだ。承認すると、こう続く。

```text
aws_vpc.main: Creating...
aws_vpc.main: Creation complete [id=vpc-09e3779b1]

Apply complete! Resources: 1 added, 0 changed, 0 destroyed.
```

ノード：`Creation complete [id=vpc-09e3779b1]`！ ここでIDが決まったんですね。さっきの `(known after apply)` の正体だ。

博士：その通り。IDの値は例だが、Simulationで同じ順に作れば、同じ形のIDが表示されるはずだ。

> **シミュレータ**
> このサイトでは、apply を押すと予告の下に「yes: 実行する」「no: 中止」のボタンが出ます。yes を押すと実行されます。予告を表示した後でファイルを書き換えると、古い予告は実行されず、もう一度 apply からやり直しになります。

### もう一度 plan すると

博士：では、実験だ。何も変えずに、もう一度 plan を実行してみたまえ。

```text
$ terraform plan
No changes. Your infrastructure matches the configuration.

Terraform has compared your real infrastructure against your configuration and found no differences.
```

ノード：「変更なし。インフラはファイルのとおりです」……。VPCがもうあるから、何もしないんですね。第2ページの「カレーがもうテーブルにある」だ。

博士：うむ。何度実行しても同じ状態に落ち着く。この性質には名前がある。

> **用語：冪等**（べきとう／idempotent）
> 同じ操作を何回くり返しても、1回だけ行ったときと同じ結果になる性質。Terraformでは、ファイルどおりの状態になった後に何度 apply しても、何も変わらない（No changes）。

ノード：でも、ちょっと不思議です。Terraformは、どうして「VPCはもう作った」とわかったんですか？ AWSにはVPCがたくさんあるかもしれないのに。

博士：いい疑問だ。実はTerraformは、自分が作ったものを、別の場所に記録しているのだ。

### state：ファイルと実物をつなぐ記録

> **用語：state**（ステート）
> Terraformが、「ファイルのどのリソースアドレスが、AWSのどの実物（ID）か」と、その実物の設定値を記録したもの。apply のたびに更新される。標準では作業ディレクトリの `terraform.tfstate` というファイルに保存される。

博士：中身を見るコマンドがある。

```text
$ terraform state list
aws_vpc.main

$ terraform state show aws_vpc.main
# aws_vpc.main:
resource "aws_vpc" "main" {
    cidr_block                   = "10.0.0.0/16"
    tags                         = { Name = "path-vpc" }
    enable_dns_support           = true
    enable_dns_hostnames         = false
    id                           = "vpc-09e3779b1"
    arn                          = "arn:aws:ec2:ap-northeast-1:123456789012:vpc/vpc-09e3779b1"
    main_route_table_id          = "rtb-07956733a"
    default_network_acl_id       = "acl-0178deceb"
    default_security_group_id    = "sg-0b5c5669c"
}
```

ノード：`aws_vpc.main` は `vpc-09e3779b1` です、っていう対応表なんですね。plan のときは `(known after apply)` だったIDも、ちゃんと入ってる。

博士：そうだ。図にするとこうなる。

```theory-diagram
terraform-state-mapping
```

博士：plan は、この3つを使って予告を作る。手順はこうだ。

```theory-diagram
terraform-plan-steps
```

ノード：だから、ファイルにVPCが書いてあって、stateにもVPCがあって、実物も同じなら「No changes」なんですね。

博士：その通り。逆に、ファイルにあってstateにないものは「新しく作る」、stateにあってファイルにないものは「消す」と判断される。

ノード：……ということは、stateをうっかり消しちゃったら？

博士：Terraformは「自分はまだ何も作っていない」と思い込む。そして次の apply で、同じVPCをもう1つ作ろうとするのだ。

ノード：うわ、VPCが2つに……。stateって、すごく大事なファイルなんですね。

> **注意**
> state はTerraformの記憶です。消したり、手で書き換えたりしてはいけません。state がないと、Terraformは自分が作った実物を見失い、二重に作ったり、管理できなくなったりします。

博士：もう1つ注意がある。stateには、実物の設定値がそのまま書かれている。リソースによっては、データベースのパスワードのような秘密の値も入るのだ。

ノード：じゃあ、ファイルと一緒にGitに入れるのは……。

博士：だめだ。ファイル（`.tf`）はGitで管理するが、stateはGitに入れない。では、チームではどこに置くのか。それは第13ページで話そう。

> **シミュレータ**
> このシミュレータでは、state はファイルではなく、ブラウザの中のワークスペースに保存されます。右側の「state」タブで、リソースアドレスとIDの対応を見られます。「serial」は、state が更新されるたびに増える版番号です。

> **まとめ**
>
> - apply は予告を表示し、`yes` の承認があったときだけ実行する。実行するとIDなどの値が決まる
> - ファイルどおりになった後は何度実行しても No changes（冪等）
> - state は「リソースアドレス ↔ 実物のID」と設定値の記録。plan は state・実物・ファイルを比べて予告を作る
> - state を消すとTerraformは実物を見失う。秘密の値も入るので、Gitには入れない

## 参照式で、リソースどうしをつなぐ

```theory-visual
terraform-deps
```

博士：VPCができたので、次はパブリックサブネット `10.0.1.0/24` を足そう。第10章で、サブネットを作るときに必ず決めることがあったな。

ノード：「どのVPCの中に作るか」です。サブネットは、VPCの範囲を分けたものですから。

博士：うむ。サブネットは必ずどこかのVPCの中に作る。だから、サブネットのリソースタイプ `aws_subnet` には、`vpc_id`（どのVPCに作るか）という必須の引数がある。さて、ここに何を書く？

ノード：さっきのIDを書けばいいんですよね。`vpc_id = "vpc-09e3779b1"`。

### IDを直接書くと困ること

博士：それでも、今この環境では動く。だが、困ることが2つある。

```text
困りごと1  検証用にもう1つ作ると、VPCのIDは別の値になる。
           ファイルの "vpc-09e3779b1" を、環境ごとに書き換えないといけない。

困りごと2  VPCとサブネットを同時に書いて、1回の apply で作りたいとき、
           VPCのIDはまだ存在しない（known after apply）。書きようがない。
```

ノード：あ、確かに。まだないIDは書けないですね。

博士：そこでHCLには、「あのリソースの、あの値」と指す書き方がある。

### 参照式：「あのVPCのID」と書く

```hcl
resource "aws_subnet" "public" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.1.0/24"
  availability_zone = "ap-northeast-1a"

  tags = {
    Name = "path-public-a"
  }
}
```

博士：`availability_zone` は、第10章で学んだ **AZ**（リージョンの中にある、電源やネットワークが独立したデータセンター群）だ。サブネットは必ず1つのAZに属するのだったな。ここでは東京リージョンの `ap-northeast-1a` を選んでいる。

博士：そして、`vpc_id = aws_vpc.main.id` に注目したまえ。`"` で囲んでいないぞ。

ノード：`aws_vpc.main` は、VPCのリソースアドレスですよね。その後ろに `.id` が付いてる。

博士：そうだ。これは「`aws_vpc.main` というリソースの、`id` という値」という意味になる。

> **用語：参照式**（さんしょうしき／reference）
> ほかのブロックの値を指す書き方。`aws_vpc.main.id` は「リソースアドレス `aws_vpc.main` の `id`」を意味し、実行するときに実際の値（`vpc-09e3779b1` など）に置き換わる。文字列と違って `" "` で囲まない。

博士：`.id` のように、リソースから読み出せる値には名前が付いている。

> **用語：リソースの属性**（attribute）
> リソースが持っていて、参照式で読み出せる値。ファイルに書いた引数（`cidr_block` など）に加えて、`id` や `arn` のように AWS が作成時に決める値もある。plan の中身に並んでいた行が、そのリソースの属性の一覧。

ノード：plan の中身に `id`、`arn`、`main_route_table_id` が並んでいましたよね。あれが全部、参照式で読めるんですか？

博士：そうだ。たとえば `aws_vpc.main.main_route_table_id` と書けば、AWSが自動で作ったメインルートテーブルのIDも読める。

### 予告では、参照はどう見えるか

博士：では、このサブネットを書き足して plan してみよう。VPCはもう apply 済みだったな。

```text
  # aws_subnet.public will be created
  + resource "aws_subnet" "public" {
      + vpc_id                  = "vpc-09e3779b1"
      + cidr_block              = "10.0.1.0/24"
      + availability_zone       = "ap-northeast-1a"
      + tags                    = { Name = "path-public-a" }
      + map_public_ip_on_launch = false
      + id                      = (known after apply)
      + arn                     = (known after apply)
    }

Plan: 1 to add, 0 to change, 0 to destroy.
```

ノード：`vpc_id = "vpc-09e3779b1"`！ 参照式が、もう本物のIDに置き換わってます。`map_public_ip_on_launch = false` は書いてないから……既定値ですか？

博士：そうだ。「このサブネットで起動したEC2に、自動でパブリックIPを付けるか」という引数で、書かなければ `false` になる。さて、参照式の話に戻ろう。

博士：VPCはすでに作られていて、state にIDが記録されているからだ。では、もしVPCとサブネットを両方まだ作っていない状態で、2つ同時に書いて plan したらどうなると思う？

ノード：VPCのIDはまだ決まってないから……`vpc_id` も `(known after apply)`？

博士：その通り。実際にこうなる。

```text
  # aws_subnet.public will be created
  + resource "aws_subnet" "public" {
      + vpc_id                  = (known after apply)
      + cidr_block              = "10.0.1.0/24"
      ...
```

> **ポイント**
> `(known after apply)` は、そのリソース自身のIDだけに付くわけではありません。まだ作られていないリソースを参照している引数にも付きます。「この値は、参照先ができてから決まる」という意味です。

### 参照があれば、作る順番が決まる

ノード：VPCとサブネットを同時に書いたら、Terraformはどっちから作るんですか？ ファイルに書いた順？

博士：いや、第3ページで「ブロックを書く順番は結果に影響しない」と言ったな。順番を決めるのは参照式だ。サブネットはVPCのIDを使う。IDはVPCを作るまで決まらない。ということは？

ノード：VPCを先に作らないと、サブネットを作れない！

博士：うむ。Terraformは参照式を見て、自動で「VPCが先、サブネットが後」と判断する。わざわざ順番を書かなくても、参照から決まるのだ。

> **用語：暗黙の依存関係**（あんもくのいぞんかんけい／implicit dependency）
> 参照式から自動で決まる「どれを先に作るか」の関係。サブネットが `aws_vpc.main.id` を参照していれば、Terraformは「サブネットはVPCに依存している」と判断し、VPCを先に作る。消すときは逆に、サブネットを先に消す。

ノード：消すときは逆なんですね。中にサブネットが残っているVPCは消せないから……。

博士：その通り。AWSでは、中にサブネットが残っているVPCは削除できない。Terraformはそれを依存関係から判断して、正しい順で消してくれる。

### 依存グラフ

博士：リソースが増えると、依存関係は網の目のようになる。Terraformはそれを1枚の図にまとめて、順番を決めている。

> **用語：依存グラフ**（dependency graph）
> 「どのリソースが、どのリソースに依存しているか」を矢印でつないだ図。Terraformはこの図をもとに、依存先のないものから順に作り、消すときは逆の順で消す。`terraform graph` で表示できる。

```text
$ terraform graph
digraph {
  "aws_subnet.public" -> "aws_vpc.main"
}
```

博士：`digraph { }` は、図を文字で表すための書式の決まり文句だ。読むのは中の矢印の行だけでいい。

ノード：`"aws_subnet.public" -> "aws_vpc.main"` は、「サブネットはVPCに依存している」ですね。矢印の向きが「依存先」を指してる。

博士：うむ。いまはリソースが2つだけだから矢印も1本だが、次のページでリソースを足すと、この図が広がっていく。

> **注意**
> Terraformは、ファイルに書いた順や、ファイルの名前の順にリソースを作るのではありません。順番は参照式（依存関係）だけで決まります。サブネットのブロックをVPCより上に書いても、VPCが先に作られます。

> **シミュレータ**
> 右側の「依存関係」タブに、作る順番が段ごとに表示されます。1段目から順に作り、削除は逆の順です。

> **まとめ**
>
> - IDを直接書く代わりに、参照式 `aws_vpc.main.id` で「あのリソースの属性」を指す
> - 参照先がまだ作られていなければ、参照している引数も `(known after apply)` になる
> - 参照式があると暗黙の依存関係が生まれ、参照先が先に作られる（削除は逆順）
> - 依存関係をまとめた依存グラフで順番が決まる。書いた順番は関係ない

## パブリックサブネットに仕上げる

博士：サブネットはできたが、まだ「パブリック」ではない。第10章で、サブネットがパブリックになる条件を学んだな。

ノード：はい。名前じゃなくて、経路で決まるんでした。そのサブネットに関連付けたルートテーブルに、`0.0.0.0/0`（インターネットのすべての宛先）を **Internet Gateway**（VPCとインターネットの出入口）へ向ける経路があれば、パブリックです。

博士：完璧だ。ということは、足りないのは3つだな。

| 足りないリソース | 役割 |
| --- | --- |
| Internet Gateway | VPCの出入口 |
| ルートテーブル | 0.0.0.0/0 → Internet Gateway の経路を持つ |
| 関連付け | サブネットに、そのルートテーブルを使わせる |

### 3つのリソースを書く

```hcl
resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}
```

ノード：ルートテーブルの中に `route { ... }` があります。イコールがないから……これもブロックですか？

博士：その通り。ブロックの中に、さらにブロックを書けるのだ。

> **用語：ネストしたブロック**（nested block）
> ブロックの中に書く、名札のないブロック。ルートテーブルの `route { }` のように、「1つのリソースの中に、同じ形の設定が何個か並ぶ」ものを書くのに使う。経路が2本なら `route { }` を2つ書く。

ノード：`route` の中の `cidr_block = "0.0.0.0/0"` が宛先で、`gateway_id` が行き先ですね。第3章の経路表でいう、宛先とNext Hopだ。

博士：うむ。そして行き先は、IDを直接書かずに参照式 `aws_internet_gateway.main.id` で書いている。関連付けも、サブネットとルートテーブルの両方を参照式で指しているな。

### 依存グラフは、どう広がったか

博士：参照式を矢印にすると、依存グラフはこうなる。

```theory-diagram
terraform-resource-dependencies
```

ノード：ルートテーブルは、VPCとIGWの両方を参照してるから、IGWより後の3段目なんですね。関連付けはサブネットとルートテーブルを参照してるから、さらに後の4段目。

博士：そうだ。では、2段目のサブネットとIGWは、どちらが先だと思う？

ノード：え〜っと……お互いを参照してないから、どっちが先でもいい？

博士：その通り。依存関係のないものどうしは、順番を気にしなくていい。本物のTerraformは、こういうものを **同時に** 作って、時間を短くするのだ。

### 予告を読む：何が「後でわかる」か

博士：VPCとサブネットが作成済みの状態で plan すると、こうなる。

```text
  # aws_internet_gateway.main will be created
  + resource "aws_internet_gateway" "main" {
      + vpc_id = "vpc-09e3779b1"
      + id     = (known after apply)
      + arn    = (known after apply)
    }

  # aws_route_table.public will be created
  + resource "aws_route_table" "public" {
      + vpc_id = "vpc-09e3779b1"
      + route  = [ { cidr_block = "0.0.0.0/0", gateway_id = (known after apply) } ]
      + id     = (known after apply)
      + arn    = (known after apply)
    }

  # aws_route_table_association.public will be created
  + resource "aws_route_table_association" "public" {
      + subnet_id      = "subnet-03c6ef362"
      + route_table_id = (known after apply)
      + id             = (known after apply)
    }

Plan: 3 to add, 0 to change, 0 to destroy.
```

ノード：前のページの話を当てはめると……。`vpc_id` と `subnet_id` は、もうあるVPCとサブネットを指してるから、本物のIDが出てる。`gateway_id` と `route_table_id` は、これから作るIGWとルートテーブルを指してるから `(known after apply)`。

博士：見事だ。予告を読むだけで、「どれが新しく作られるものに依存しているか」までわかるわけだな。承認すると、依存グラフの順に作られる。

```text
aws_internet_gateway.main: Creating...
aws_internet_gateway.main: Creation complete [id=igw-0daa66d13]
aws_route_table.public: Creating...
aws_route_table.public: Creation complete [id=rtb-078dde6c4]
aws_route_table_association.public: Creating...
aws_route_table_association.public: Creation complete [id=rtbassoc-017156075]

Apply complete! Resources: 3 added, 0 changed, 0 destroyed.
```

### セキュリティグループ：書かないと「出られない」

博士：最後に、Webサーバー用のセキュリティグループ `web-sg` を足そう。**セキュリティグループ**（SG）は、第10章で学んだ、インスタンスごとに付けるステートフルなファイアウォールだったな。

```hcl
resource "aws_security_group" "web" {
  name   = "web-sg"
  vpc_id = aws_vpc.main.id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
```

博士：ここにもネストしたブロックが2種類ある。

> **用語：ingress**（イングレス）
> セキュリティグループの、外から入ってくる通信（インバウンド）を許可するルールを書くネストしたブロック。`from_port`〜`to_port` の範囲のポートへ、`cidr_blocks` の送信元からの通信を許可する。

> **用語：egress**（イーグレス）
> セキュリティグループの、インスタンスから出ていく通信（アウトバウンド）を許可するルールを書くネストしたブロック。`protocol = "-1"` は「すべてのプロトコル」で、そのときポートは `0`〜`0` と書く。

ノード：ingress は「80番（HTTP）を、どこからでも受け付ける」ですね。第10章の web-sg と同じだ。でも、egress って書く必要あるんですか？ 第10章では、SGを作ったら最初から「外向きは全部許可」のルールが付いてましたよ。

博士：鋭いな。そこが落とし穴なのだ。AWSのコンソールやAPIでSGを作ると、外向き全許可のルールが自動で付く。ところがTerraformの `aws_security_group` は、作成するときにその自動のルールを **消してしまう**。ファイルに書いたものだけが、あるべき姿だからな。

ノード：じゃあ、egress を書かなかったら……。

博士：インスタンスから始める通信（OSの更新を取りに行く、など）は、すべて止められる。ただしSGはステートフルなので、80番で受け付けた通信への **返事** は、egress がなくても返る。

> **注意**
> Terraformで作るセキュリティグループには、外向き全許可のルールが自動では付きません。インスタンスから外へ通信を始める必要があるなら、egress ブロックを明示的に書きます。「画面で作ったときと同じ」と思い込むと、更新や外部APIへの通信が止まります。

### 参照に表れない依存：depends_on

ノード：参照式さえ書いておけば、順番は全部おまかせでいいんですか？

博士：ほとんどはな。だが、参照式に表れない依存もある。代表例が **NAT Gateway**（第10章で学んだ、プライベートサブネットから外へ出るための出口）だ。NAT Gatewayはパブリックサブネットに置くので、サブネットは参照する。だが、Internet Gateway は参照しない。

ノード：でも、IGWがないと、NAT Gatewayから先のインターネットに出られないですよね。

博士：そうだ。参照はないが、IGWが先にあってほしい。こういうときは、依存を明示的に書く。

```hcl
resource "aws_nat_gateway" "main" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public.id
  depends_on    = [aws_internet_gateway.main]
}
```

博士：`aws_eip.nat` は、NAT Gatewayに付ける固定のパブリックIP（第10章の Elastic IP）のリソースだ。`allocation_id` と `subnet_id` は参照式なので、EIPとサブネットへの依存は自動で決まる。IGWへの依存だけが、ファイルのどこにも表れていない。だから最後の行で書き足すのだ。

> **用語：depends_on**（ディペンズ・オン）
> 参照式には表れない依存を、明示的に書く引数。`depends_on = [aws_internet_gateway.main]` と書くと、Internet Gateway ができてから、このリソースを作る。参照式から決まる暗黙の依存関係に対して、明示的な依存関係と呼ぶ。

ノード：便利ですね！ 迷ったら全部に depends_on を付けておけば安心かも。

博士：まあ待て。depends_on を付けすぎると、本当は同時に作れるものまで順番待ちになり、関係のない変更でも予告が増える。Terraformの公式の説明でも、depends_on は「参照式で表せないときの最後の手段」とされている。まず参照式で表せないかを考えるのだ。

> **シミュレータ**
> 本物のTerraformは、依存関係のないリソースを同時に作ります（標準では最大10個）。このシミュレータは、依存グラフの段の順に1つずつ作ります。作られる順番の考え方は同じです。

> **まとめ**
>
> - パブリックサブネットには、IGW・`0.0.0.0/0 → IGW` のルートテーブル・関連付けの3つが要る。いずれも参照式でつなぐ
> - `route { }`・`ingress { }`・`egress { }` は、ブロックの中に書くネストしたブロック
> - Terraformで作るSGには外向き全許可が付かない。必要なら egress を書く
> - 参照に表れない依存だけ depends_on で書く。依存のないものは同時に作られる

## plan の記号を読む：~ と -/+ と -

```theory-visual
terraform-plan-symbols
```

博士：ここまでの予告は、全部 `+`（作成）だった。だが、実際の仕事では「すでにあるものを変える」ほうがずっと多い。変更の予告には、別の記号が出てくるのだ。今日いちばん大事なページだぞ。

ノード：はい！

### その場で変わる：~

博士：まず、軽い変更からいこう。VPCの中のEC2に、DNSの名前（第5章で学んだ、IPアドレスの代わりに使う名前）を付けたくなったとする。それには、VPCの `enable_dns_hostnames` を `true` にする。ファイルにこう1行足す。

```hcl
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true

  tags = {
    Name = "path-vpc"
  }
}
```

```text
$ terraform plan
Resource actions are indicated with the following symbols:
  ~ update in-place

Terraform will perform the following actions:

  # aws_vpc.main will be updated in-place
  ~ resource "aws_vpc" "main" {
      ~ enable_dns_hostnames      = false -> true
    }

Plan: 0 to add, 1 to change, 0 to destroy.
```

ノード：記号が `~` になってます。`false -> true` は、「false から true に変わる」ですね。

博士：そうだ。`矢印の左が今の値、右が変更後の値` と読む。

> **用語：update in-place**（アップデート・インプレース）
> plan で `~` の記号で表される変更。いまある実物を消さずに、その場で設定だけを書き換える。IDは変わらないので、そのリソースを参照しているほかのリソースにも影響しない。

ノード：中身には `enable_dns_hostnames` の1行しかないですね。`cidr_block` とかは表示されないんですか？

博士：変わらない属性は省かれるのだ。変わる行だけが出るから、読む量が少なくて済む。

### 作り直しになる：-/+

博士：では、次はサブネットのCIDRを `10.0.1.0/24` から `10.0.10.0/24` に変えてみよう。番号を1つ変えるだけだ。

```text
$ terraform plan
Resource actions are indicated with the following symbols:
-/+ destroy and then create replacement

Terraform will perform the following actions:

  # aws_subnet.public must be replaced
-/+ resource "aws_subnet" "public" {
      ~ cidr_block              = "10.0.1.0/24" -> "10.0.10.0/24" # forces replacement
      ~ id                      = "subnet-03c6ef362" -> (known after apply)
      ~ arn                     = "arn:aws:ec2:ap-northeast-1:123456789012:subnet/subnet-03c6ef362" -> (known after apply)
    }

  # aws_route_table_association.public must be replaced
-/+ resource "aws_route_table_association" "public" {
      ~ subnet_id      = "subnet-03c6ef362" -> (known after apply) # forces replacement
      ~ id             = "rtbassoc-017156075" -> (known after apply)
    }

Plan: 2 to add, 0 to change, 2 to destroy.
```

ノード：うわ、さっきと全然違う……。`-/+` っていう記号です。

博士：凡例を読んでみたまえ。

ノード：`destroy and then create replacement`……「削除して、代わりを作る」。えっ、サブネットを消しちゃうんですか！？

博士：そうだ。これが **リソースの置き換え**、略して「置き換え」だ。

> **用語：リソースの置き換え**（replacement）
> plan で `-/+` の記号と `must be replaced` で表される変更。いまある実物を削除し、新しい設定で作り直す。新しい実物は別のIDになる。

ノード：CIDRの番号を1つ変えただけなのに、どうして作り直しなんですか？ `~` でその場で変えればいいのに。

博士：AWSのサブネットは、作った後にCIDRを変えられないのだ。APIに「サブネットのCIDRを変える」という操作がない。だから、変えたければ消して作り直すしかない。

博士：どの引数がそうなのかを教えてくれるのが、行末の印だ。

> **用語：forces replacement**（フォーシズ・リプレースメント）
> plan で、変更する行の末尾に付く `# forces replacement`。「この引数の変更が、置き換え（作り直し）の原因です」という印。どの引数がその場で変えられないかは、プロバイダが知っている。

### 1行ずつ読む

博士：では、この予告を上から1行ずつ読もう。

```text
# aws_subnet.public must be replaced             サブネットが置き換えになる
-/+ resource "aws_subnet" "public" {
  ~ cidr_block = "10.0.1.0/24" -> "10.0.10.0/24" # forces replacement
                                                  ↑ 原因はCIDRの変更
  ~ id = "subnet-03c6ef362" -> (known after apply)
                                                  ↑ 作り直すので、新しいIDは作った後でわかる
```

ノード：IDも `->` で変わるんですね。作り直すから、新しいIDになる。

博士：そうだ。では、2つ目のかたまりはなぜ出てきた？ 関連付けのファイルは1文字も変えていないぞ。

ノード：え〜っと……関連付けの `subnet_id` も `-> (known after apply) # forces replacement` になってる。あっ、関連付けは `aws_subnet.public.id` を参照してるから！ サブネットのIDが新しくなると、関連付けの `subnet_id` も変わっちゃうんだ。

博士：その通り。そして関連付けの `subnet_id` も、その場で変えられない引数だ。だから関連付けも作り直しになる。1つの変更が、参照をたどって **波及** したのだ。

ノード：最後の `Plan: 2 to add, 0 to change, 2 to destroy.` は……置き換えが2つなのに、add も destroy も2？

博士：置き換えは「1つ消して、1つ作る」だから、add と destroy の両方に数えられる。サブネットと関連付けで、2つずつだな。

> **ポイント**
> `-/+` を見たら、①`# forces replacement` が付いた行で原因を確かめ、②その下に、参照をたどって巻き込まれたリソースがないかを見ます。サブネットを作り直すと、その中のEC2なども作り直しや停止の対象になることがあります。

### 消える：-

博士：最後の記号だ。resourceブロックをファイルから消すと、どうなると思う？

ノード：ファイルにないのに state にはあるから……第5ページの話だと「消す」？

博士：うむ。たとえば関連付けのブロックをファイルから消すと、予告はこうなる。

```text
  # aws_route_table_association.public will be destroyed
  - resource "aws_route_table_association" "public" {
      - subnet_id      = "subnet-03c6ef362" -> null
      - route_table_id = "rtb-078dde6c4" -> null
      - id             = "rtbassoc-017156075" -> null
    }

Plan: 0 to add, 0 to change, 1 to destroy.
```

博士：`-> null` は「何もなくなる」という意味だ。

> **用語：destroy**（デストロイ）
> リソースを削除すること。plan では `-` の記号と `will be destroyed` で表される。ファイルからブロックを消したときに起きるほか、`terraform destroy` コマンドは、Terraformが管理しているリソースをすべて削除する。

ノード：`terraform destroy` で全部消えるんですか……。練習の後片付けには便利そうですけど、本番だとこわいですね。

博士：うむ。destroy も apply と同じく予告を見せて承認を求める。予告に並ぶのが全部 `-` なら、それは「全部消える」という意味だ。

### 4つの記号を整理する

博士：説明が終わったところで、表にまとめておこう。

| 記号 | 凡例の英語 | 起きること | ID | ほかのリソースへの影響 |
| --- | --- | --- | --- | --- |
| `+` | create | 新しく作る | 新しく決まる | なし |
| `~` | update in-place | その場で設定を変える | 変わらない | なし |
| `-/+` | destroy and then create replacement | 消して作り直す | 変わる | 参照している側も変わる（波及） |
| `-` | destroy | 消す | なくなる | 参照している側はエラーや変更になる |

> **注意**
> `~` と `-/+` は、どちらも「変更」に見えますが、まったく違います。`~` は実物が残り、`-/+` は実物が一度消えます。その上で動いているサーバーやデータがあれば、`-/+` は停止やデータの消失につながります。

> **シミュレータ**
> 予告の表示は本物に似せた教育用のものです。どの引数がその場で変えられないか（forces replacement になるか）は、AWS Provider の主な仕様に合わせていますが、すべての引数を再現しているわけではありません。

> **まとめ**
>
> - `~`（update in-place）はその場で変更。IDは変わらず、変わる行だけが表示される
> - `-/+`（置き換え）は消して作り直し。`# forces replacement` の行が原因。新しいIDを参照している側にも波及する
> - `-`（destroy）は削除。ファイルからブロックを消すと起きる。`terraform destroy` は管理しているすべてを消す
> - `Plan:` の合計では、置き換えは add と destroy の両方に数えられる

## 危ない変更を、apply の前に止める

博士：記号が読めるようになったところで、少し怖い予告を見てもらおう。VPCのCIDRを `10.0.0.0/16` から `10.20.0.0/16` に変えたときの予告だ。中身は省いて、見出しの行だけを抜き出す。

```text
  # aws_vpc.main must be replaced
-/+ resource "aws_vpc" "main" {
      ~ cidr_block = "10.0.0.0/16" -> "10.20.0.0/16" # forces replacement

  # aws_subnet.public must be replaced
-/+ resource "aws_subnet" "public" {
      ~ vpc_id = "vpc-09e3779b1" -> (known after apply) # forces replacement

  # aws_internet_gateway.main will be updated in-place
  ~ resource "aws_internet_gateway" "main" {
      ~ vpc_id = "vpc-09e3779b1" -> (known after apply)

  # aws_route_table.public must be replaced
  # aws_route_table_association.public must be replaced
  # aws_security_group.web must be replaced

Plan: 5 to add, 1 to change, 5 to destroy.
```

ノード：ひえっ……。1行変えただけで、ほとんど全部が作り直しです。

博士：VPCのCIDRもその場で変えられない。VPCが作り直されてIDが変わると、`aws_vpc.main.id` を参照しているものすべてに波及する。サブネット、ルートテーブル、SGは `vpc_id` をその場で変えられないから作り直し。前のページで見たとおり、サブネットが変われば関連付けも作り直しだ。

ノード：Internet Gateway だけ `~` なのは？

博士：IGWは、別のVPCに付け替える操作がAPIにあるのだ。だから、消さずに付け替えで済む。予告を読むと、こういう違いまでわかる。

```theory-visual
terraform-replace-ripple
```

### 予告のどこから読むか

ノード：こんな予告がプルリクエストに来たら、どこから見ればいいんですか？

博士：順番を決めておくといい。

```theory-diagram
terraform-plan-review-steps
```

ノード：まず `destroy` の数、ですね。0 でなければ、立ち止まる。

博士：うむ。`+` と `~` だけの予告なら、たいていは安全だ。`-` と `-/+` があったら、それが本当に意図したものかを説明できるまで、apply してはいけない。

> **現場では**
> 予告はレビューの対象そのものです。プルリクエストには、ファイルの差分に加えて plan の結果を貼り、「削除と作り直しの数」と「forces replacement の理由」をレビューします。本物のTerraformでは `terraform plan -out=tfplan` で予告をファイルに保存し、`terraform apply tfplan` でその予告だけを実行できます。レビューした予告と、実際に実行される内容が一致します（このシミュレータでは使えません）。

### lifecycle：消えては困るものに、鍵をかける

ノード：大事なVPCを、うっかり作り直さないようにする方法はないんですか？

博士：ある。resourceブロックの中に、そのリソースの作り方・消し方の決まりを書けるのだ。

> **用語：lifecycle**（ライフサイクル）
> resourceブロックの中に書くネストしたブロック。そのリソースを作り直すときや消すときの扱いを変える。よく使うのは「削除の禁止」「作り直しの順番」「差分の無視」の3つ。

博士：1つ目が、削除の禁止だ。

```hcl
resource "aws_subnet" "public" {
  # （引数は省略）

  lifecycle {
    prevent_destroy = true
  }
}
```

> **用語：prevent_destroy**（プリベント・デストロイ）
> lifecycle に `prevent_destroy = true` と書くと、そのリソースを削除する予告（`-` と `-/+`）がエラーになり、apply できなくなる。消えては困るVPCやサブネットに付ける。

博士：これを付けた状態で、さっきのようにサブネットのCIDRを変えると、予告の段階で止まる。

```text
$ terraform plan
╷
│ Error: Instance cannot be destroyed
│
│ aws_subnet.public には lifecycle.prevent_destroy = true が設定されているため、置き換え（削除を伴う）できません。
│ 本当に削除してよい場合だけ、prevent_destroy を外してから実行します。
│ 置き換えを避けたい場合は、# forces replacement が付いた属性の変更を元に戻します。
╵
```

ノード：これを付けておけば、もう絶対に消えないですね！

博士：相変わらず気が早いな。resourceブロックごとファイルから消したら、どうなる？

ノード：あ……。prevent_destroy もファイルから消えるから……守りも消える？

博士：そうだ。prevent_destroy は「うっかり」を防ぐ鍵であって、絶対の金庫ではない。

博士：2つ目は、作り直しの順番を逆にする指定だ。`-/+` は、ふつう「先に消して、後で作る」だったな。

> **用語：create_before_destroy**（クリエイト・ビフォア・デストロイ）
> lifecycle に `create_before_destroy = true` と書くと、置き換えのとき、新しいものを先に作り、つながりを付け替えてから古いものを消す。作り直しの間に「何もない時間」ができるのを避けられる。

ノード：先に作れば、止まらないで済むんですね。

博士：ただし、古いものと新しいものが同時に存在する時間ができる。名前のように「同じ値を2つ持てない」設定があると、そこでぶつかる。そこは気をつけたまえ。

```theory-visual
terraform-cbd-timeline
```

博士：3つ目は、差分の無視だ。

> **用語：ignore_changes**（イグノア・チェンジズ）
> lifecycle に `ignore_changes = [tags]` のように引数の名前を並べると、その引数については、ファイルと実物が違っても変更を予告しない。Terraform以外の仕組みが正当に書き換える値に使う。

ノード：たとえば、どんなときに使うんですか？

博士：会社によっては、費用の集計用のタグを、別の仕組みが自動で付けることがある。それを毎回「ファイルにないから消します」と予告されたら困るだろう。そういう値に限って使うのだ。

> **注意**
> ignore_changes は「見なかったことにする」指定です。手で変えられたくない設定に付けると、本当に困る変更まで見逃します。何でも付けるのではなく、「Terraform以外が書き換えるのが正しい値」だけに使います。

### apply は途中で止まることがある

博士：最後に、予告では見抜けない失敗の話だ。サブネットのCIDRを `10.0.1.0/24` のつもりで、`10.1.1.0/24` と打ち間違えて apply したとしよう。

```text
aws_route_table_association.public: Destroying... [id=rtbassoc-017156075]
aws_route_table_association.public: Destruction complete
aws_subnet.public: Destroying... [id=subnet-03c6ef362]
aws_subnet.public: Destruction complete
╷
│ Error: creating aws_subnet (aws_subnet.public): AWS API エラー（シミュレーション）: path-public-a: 10.1.1.0/24 はVPC 10.0.0.0/16 の範囲外です。サブネットには、VPCのCIDRを分割した範囲を指定します
╵

Apply stopped with an error.
```

ノード：古いサブネットを消した後で、新しいサブネットを作ろうとしたら、VPCの範囲外でエラー……。第2章の「サブネットは、VPCの範囲を分けたもの」ですね。

博士：うむ。validate はAWSに問い合わせないから、範囲外かどうかまでは見抜けない。APIに頼んで、初めて断られたのだ。では、いまの状態はどうなっている？

ノード：消したところまでは実行されて……新しいのは作られてない。サブネットがなくなっちゃった！

> **用語：部分適用**（ぶぶんてきよう／partial apply）
> apply の途中でエラーが起きたとき、エラーより前の作成・変更・削除は実行されたまま残ること。Terraformは、実行済みの操作を自動では元に戻さない。state には、実行できたところまでが記録される。

博士：直し方は、CIDRを正しく直して、もう一度 plan → apply だ。stateには「サブネットはもうない」と記録されているから、次の予告は「サブネットと関連付けを `+` で作る」になる。

> **現場では**
> apply が失敗しても、Terraformは自動では巻き戻しません。切り戻しの基本は「以前のファイルに戻して、もう一度 plan と apply」です。ただし、削除されたリソースの中のデータ（データベースの中身など）は戻りません。作り直しや削除を含む変更の前には、手順と、データのバックアップを用意します。

> **まとめ**
>
> - 予告は `Plan:` の destroy の数 → `-/+` と `-` → `# forces replacement` → 波及の順に読む
> - lifecycle の prevent_destroy は削除・作り直しの予告をエラーにする。ブロックごと消すと守りも消える
> - create_before_destroy は先に作ってから消す。ignore_changes は正当に外で変わる値だけに使う
> - apply は途中で止まることがあり（部分適用）、自動では元に戻らない

## variable・locals・output：値を外から渡し、結果を外へ見せる

博士：さて、最初の上司の頼みを思い出そう。「同じネットワークを、検証用にもう1つ」。いまの `main.tf` をコピーして、検証用を作るとしたら、どこを書き換える？

ノード：え〜っと、VPCのCIDRを `10.1.0.0/16` に、Nameを `path-stg-vpc` に……。あと、サブネットのCIDRも……。ファイルのあちこちを探して直さないといけないですね。

博士：うむ。環境ごとに違う値が、ファイルのあちこちに散らばっているのが問題なのだ。まず、その値を1か所に集めよう。

### variable：外から受け取る値

> **用語：variable**（ヴァリアブル／入力変数）
> 外から値を受け取るためのブロック。`variable "vpc_cidr" { }` と宣言し、ファイルの中では `var.vpc_cidr` という参照式で使う。`default` に既定値を、`type` に値の型（`string`・`number`・`list(string)` など）を書ける。

博士：`variables.tf` というファイルを作って、こう書く。

```hcl
variable "region" {
  type    = string
  default = "ap-northeast-1"
}

variable "project" {
  type    = string
  default = "path"
}

variable "vpc_cidr" {
  type    = string
  default = "10.0.0.0/16"
}
```

博士：そして `main.tf` の値を、変数の参照式に置き換える。

```hcl
provider "aws" {
  region = var.region
}

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true

  tags = {
    Name = "${var.project}-vpc"
  }
}
```

ノード：`var.vpc_cidr` は、さっきの参照式と同じ形ですね。`"${var.project}-vpc"` の `${ }` は何ですか？

博士：文字列の中に値を埋め込む書き方だ。

> **用語：文字列補間**（もじれつほかん／interpolation）
> 文字列の中に `${ }` で式を書き、その値を埋め込む書き方。`var.project` が `"path"` なら、`"${var.project}-vpc"` は `"path-vpc"` になる。

### 書き換えても、予告は「変更なし」

博士：ここで plan を実行してみたまえ。何が起きると思う？

ノード：ファイルをけっこう書き換えたから、`~` がいっぱい出る……？

```text
$ terraform plan
No changes. Your infrastructure matches the configuration.
```

ノード：あれっ、変更なし！

博士：`var.vpc_cidr` の値は既定値の `"10.0.0.0/16"`、Nameは `"path-vpc"`。どちらも、書き換える前とまったく同じ値になる。Terraformが比べるのは「書き方」ではなく「最終的な値」だから、変更はないのだ。

> **ポイント**
> ファイルの書き方を整理（リファクタリング）したときは、plan が「No changes」になることを確かめます。値が1つも変わっていない証拠になります。

### 値を渡す：terraform.tfvars

ノード：変数の値を変えたいときは、`default` を書き換えるんですか？

博士：既定値はそのままにして、別のファイルで上書きするのがふつうだ。

> **用語：terraform.tfvars**（テラフォーム・ティーエフバーズ）
> 変数に渡す値を「変数名 = 値」の形で書くファイル。作業ディレクトリにあると自動で読み込まれ、variable の default より優先される。例: `vpc_cidr = "10.1.0.0/16"`

ノード：じゃあ、`terraform.tfvars` に `vpc_cidr = "10.1.0.0/16"` と書けば、検証用のVPCができる？

博士：ここは落ち着いて考えたまえ。この作業ディレクトリの state には、`aws_vpc.main` が `vpc-09e3779b1` として記録されている。同じ場所で `vpc_cidr` を変えたら、予告はどうなる？

ノード：あっ……前のページの、VPCのCIDRを変えたときと同じ。`aws_vpc.main must be replaced` で、全部作り直しです！ 検証用が増えるんじゃなくて、いまのが作り直される……。

博士：その通り。1つの作業ディレクトリと1つの state は、1組のリソースを管理する。検証用を「もう1つ」作るには、別の作業ディレクトリ（別の state）で同じファイルを使うか、第14ページで学ぶ module を使う。変数は「環境ごとの違い」を1か所に集める道具で、増やす道具ではないのだ。

### locals：ファイルの中で使う名前付きの値

博士：変数に似たものに、locals がある。

> **用語：locals**（ローカルズ／ローカル値）
> そのファイル群の中だけで使う、名前付きの値を書くブロック。外からは渡せない。何度も使う式に名前を付けておくのに使い、`local.名前` で参照する。

```hcl
locals {
  name_prefix = "${var.project}-dev"
}

# 使う側: Name = "${local.name_prefix}-vpc"  → "path-dev-vpc"
```

ノード：variable と locals は、どう使い分けるんですか？

博士：外から変えたい値なら variable、ファイルの中で組み立てる値なら locals だ。locals はあくまで「長い式に名前を付ける」ためのものと考えるといい。例のネットワークでは使わないが、ファイルが大きくなると役に立つ。

### output：結果を外へ見せる

博士：最後に、逆向きだ。apply で決まったIDを、外に見せたいことがある。

> **用語：output**（アウトプット／出力値）
> apply の後に表示し、外から読めるようにする値を書くブロック。`output "vpc_id" { value = aws_vpc.main.id }` のように書く。`terraform output` で表示でき、後で学ぶ module では、外へ値を渡す出口になる。

```hcl
output "vpc_id" {
  value = aws_vpc.main.id
}

output "public_subnet_id" {
  value = aws_subnet.public.id
}
```

```text
$ terraform apply
...
Apply complete! Resources: 0 added, 0 changed, 0 destroyed.

Outputs:

vpc_id = "vpc-09e3779b1"
public_subnet_id = "subnet-03c6ef362"

$ terraform output
vpc_id = "vpc-09e3779b1"
public_subnet_id = "subnet-03c6ef362"
```

ノード：`0 added, 0 changed` なのに Outputs が出てる。リソースは何も変わらないけど、output の値は state に記録されたってことですか？

博士：その通り。output も state に書かれる。同じチームのアプリ担当が「EC2を置くサブネットのIDを教えて」と言ってきたら、`terraform output` の結果を渡せばよいわけだ。

### data：AWSにある情報を読むだけ

博士：おまけを1つ。リソースは「作って管理するもの」だったが、すでにある情報を **読むだけ** のブロックもある。

> **用語：データソース**（data source）
> `data` ブロックで書く、既存の情報を読み取るだけのもの。何も作らず、消しもしない。例: `data "aws_availability_zones" "available" {}` で、そのリージョンで使えるAZの一覧が `data.aws_availability_zones.available.names` で読める。

ノード：参照式の頭に `data.` が付くんですね。

博士：うむ。リソースと区別するためだ。たとえばAZの名前をファイルに直接書かずに、AWSから読み取れる。

> **シミュレータ**
> このシミュレータでは、変数の値は `terraform.tfvars` か `xxx.auto.tfvars` に書きます（`-var` オプションは使えません）。また、plan の「Changes to Outputs」に、変わらない output も `+` で表示されます。本物では、値が変わる output だけが表示されます。

> **まとめ**
>
> - variable は外から受け取る値（`var.名前`）。default を terraform.tfvars で上書きする
> - 書き方を整理しても値が同じなら plan は No changes。整理の確認に使う
> - 同じ作業ディレクトリで値を変えると、同じリソースが変わる（増えるのではない）
> - locals はファイル内の名前付きの値、output は外へ見せる値、data は既存の情報を読むだけ

## count と cidrsubnet：同じ形を、番号で繰り返す

博士：次は、例のネットワークにプライベートサブネットを2つ足す。第10章で学んだように、1つのAZが止まっても動き続けられるよう、2つのAZに1つずつ置くのだ。

| 用途 | CIDR | AZ |
| --- | --- | --- |
| プライベートサブネット | 10.0.11.0/24 | ap-northeast-1a |
| プライベートサブネット | 10.0.12.0/24 | ap-northeast-1c |

ノード：resourceブロックを2つ書けばいいですよね。`aws_subnet.private_a` と `aws_subnet.private_c` で。

博士：それでも動く。だが、2つのブロックは、CIDRとAZ以外まったく同じだ。AZが3つになったら3つ、4つになったら4つ。コピーするたびに、どこか1か所だけ直し忘れる危険が増える。

ノード：たしかに……。コピペで作ったところって、だいたい1か所間違えてるんですよね。

### count：同じブロックを何個も作る

博士：そこで使うのが、resourceブロックに書ける **count 引数** だ。

> **用語：count 引数**（カウント）
> resourceブロックに書くと、そのリソースを指定した数だけ作る特別な引数。`count = 2` なら2つ作られ、リソースアドレスは `aws_subnet.private[0]`・`aws_subnet.private[1]` のように番号付きになる。番号は0から始まる。

博士：ブロックは1つのまま、「同じ形を2つ」と書けるわけだ。ただ、2つとも同じCIDRでは困るな。何番目かによって値を変えたい。

> **用語：count.index**（カウント・インデックス）
> count を書いたブロックの中で使える、「いま何番目を作っているか」の番号。0、1、2…と増える。`count.index + 11` のように、計算にも使える。

ノード：じゃあ、0番目はAZを1a、1番目は1cにすればいいんですね。

博士：うむ。まず、AZの一覧を変数にしておこう。`variables.tf` に足す。

```hcl
variable "azs" {
  type    = list(string)
  default = ["ap-northeast-1a", "ap-northeast-1c"]
}
```

博士：`list(string)` は「文字列のリスト」という型だ。リストから1つ取り出すには、`var.azs[0]` のように番号を付ける。この番号も0から始まる。

ノード：`var.azs[0]` が `"ap-northeast-1a"`、`var.azs[1]` が `"ap-northeast-1c"`。だから `var.azs[count.index]` と書けば、0番目のサブネットは1a、1番目は1c！

博士：その通り。そして、いくつ作るかも、リストの長さから決めればいい。

> **用語：組み込み関数**（くみこみかんすう／built-in function）
> Terraformに最初から用意されている計算の道具。`関数名(引数, 引数)` の形で使う。例: `length(var.azs)` はリストの長さ（ここでは2）を返す。自分で関数を作ることはできない。

### cidrsubnet：第2章の計算を、関数でする

博士：残るはCIDRだ。`10.0.11.0/24` と `10.0.12.0/24`。これを番号から計算する関数がある。

> **用語：cidrsubnet**（シーアイディーアール・サブネット）
> 大きなCIDRを分けたうちの1つを計算する組み込み関数。`cidrsubnet(元のCIDR, 延ばすビット数, 番号)` と書く。例: `cidrsubnet("10.0.0.0/16", 8, 11)` は、/16 を 8ビット延ばして /24 にした範囲のうち11番目の `10.0.11.0/24`。番号は0から数える。

ノード：延ばすビット数……。あ、第2章のサブネット計算だ！ /16 を /24 に分けると、2の8乗で256個の /24 ができる。

博士：そうだ。`10.0.0.0/16` を /24 に分けると、`10.0.0.0/24`、`10.0.1.0/24`、`10.0.2.0/24`……と、3つ目の数字が0から255まで並ぶ。その11番目は？

ノード：0から数えて11番目だから……`10.0.11.0/24` ですね！ 番号がそのまま3つ目の数字になるんだ。

博士：/16 から /24 のときは、ちょうどそうなる。では、全部を組み合わせよう。新しいファイル `private.tf` だ。

```hcl
resource "aws_subnet" "private" {
  count             = length(var.azs)
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + 11)
  availability_zone = var.azs[count.index]

  tags = {
    Name = "${var.project}-private-${count.index}"
  }
}
```

博士：`count.index` ごとに、値はこう計算される。

| count.index | cidrsubnetの番号 | cidr_block | availability_zone | Name |
| --- | --- | --- | --- | --- |
| 0 | 0 + 11 = 11 | 10.0.11.0/24 | ap-northeast-1a | path-private-0 |
| 1 | 1 + 11 = 12 | 10.0.12.0/24 | ap-northeast-1c | path-private-1 |

ノード：`+ 11` にしてあるのは、パブリックの `10.0.1.0/24` とぶつからないように、プライベートを11番から始めるためですね。

博士：よく気づいた。番号の範囲を役割ごとに分けておくと、アドレスの台帳が読みやすくなる。予告はこうなる。

```text
  # aws_subnet.private[0] will be created
  + resource "aws_subnet" "private" {
      + vpc_id                  = "vpc-09e3779b1"
      + cidr_block              = "10.0.11.0/24"
      + availability_zone       = "ap-northeast-1a"
      + tags                    = { Name = "path-private-0" }
      ...
    }

  # aws_subnet.private[1] will be created
  + resource "aws_subnet" "private" {
      + vpc_id                  = "vpc-09e3779b1"
      + cidr_block              = "10.0.12.0/24"
      + availability_zone       = "ap-northeast-1c"
      + tags                    = { Name = "path-private-1" }
      ...
    }

Plan: 2 to add, 0 to change, 0 to destroy.
```

ノード：ブロックは1つなのに、見出しは `[0]` と `[1]` の2つ。計算した値が、ちゃんと予告に出てますね。

博士：予告には、計算した **結果** が出る。だから、関数の書き間違いも、apply の前に予告で気づけるのだ。

### 全部のIDをまとめて取り出す

博士：2つのサブネットのIDを output で見せたい。`aws_subnet.private[0].id` と `[1].id` を並べるのは面倒だな。

> **用語：スプラット式**（splat expression）
> `aws_subnet.private[*].id` のように `[*]` を使って、count で作ったすべてのリソースから同じ属性を集め、リストにする書き方。

```hcl
output "private_subnet_ids" {
  value = aws_subnet.private[*].id
}
```

```text
private_subnet_ids = [ "subnet-0538453d7", "subnet-0f1bbcd88" ]
```

### count の落とし穴：番号がずれる

ノード：count、便利ですね！ AZを減らしたいときは、リストから消せばいいんですよね。

博士：そこに落とし穴がある。AZが3つ `["1a", "1c", "1d"]` あって、先頭の `1a` をやめるとしよう。リストは `["1c", "1d"]` になる。何が起きる？

ノード：え〜っと、1aのサブネットが消える……だけじゃないんですか？

博士：番号で考えてみたまえ。

| 添字 | 変更前 | 変更後 | 結果 |
| --- | --- | --- | --- |
| [0] | 1a | 1c | AZ変更なので作り直し（-/+） |
| [1] | 1c | 1d | 作り直し（-/+） |
| [2] | 1d | なし | 削除（-） |

ノード：うわ……。1aだけ消したかったのに、1cと1dまで作り直しに！ 番号で管理してるから、前が抜けると後ろが全部ずれるんだ。

博士：その通り。だから、要素の途中を消す可能性があるものには、番号ではなく名前（キー）で管理する書き方を使う。

> **用語：for_each**（フォー・イーチ）
> count の代わりに使う繰り返しの書き方。番号ではなく、マップのキー（例: `"1a"`、`"1c"`）でリソースを区別する。アドレスは `aws_subnet.private["1a"]` のようになり、途中の要素を消しても、ほかの要素のアドレスは変わらない。

```theory-visual
terraform-count-shift
```

> **シミュレータ**
> このシミュレータは for_each に対応していません。count だけが使えます（1つのブロックで最大64個まで）。for_each は、実際のTerraformで試してください。

> **現場では**
> cidrsubnet を使うと、アドレスの割り当てがファイルに残り、レビューできる形になります。一方で、一度割り当てた番号（`+ 11` など）や count の並び順を変えると、既存のサブネットのCIDRが変わって作り直しになります。割り当て済みの番号は固定し、ほかのVPCやオンプレミスのネットワークと重ならないかを、アドレスの台帳（第2章）と照らし合わせます。

> **まとめ**
>
> - count は同じ形のリソースを数だけ作る。アドレスは `[0]`・`[1]` と番号付き、`count.index` で何番目かがわかる
> - cidrsubnet(元のCIDR, 延ばすビット数, 番号) は第2章のサブネット計算。予告には計算結果が出る
> - `[*]`（スプラット式）で、count で作った全部の属性をリストで取り出せる
> - count はリストの途中を消すと番号がずれて作り直しになる。キーで管理する for_each が安全な場面が多い

## コードの外で変わったら：drift と import

```theory-visual
terraform-drift
```

博士：ある夜、障害が起きた。当番の先輩が、調査のためにAWSのコンソールを開き、`web-sg` に「どこからでも22番（SSH）を許可」のルールを手で足した。障害は直ったが、ルールは消し忘れたまま……。

ノード：あるあるですね……。でも、Terraformのファイルには22番なんて書いてないですよ。

博士：そうだ。いま、3つの場所の中身を並べるとこうなる。

| 比較するもの | web-sgのingress | 意味 |
| --- | --- | --- |
| ファイル | 80だけ | あるべき姿 |
| state | 80だけ | 前回applyしたときの記録 |
| AWS | 80と22 | 実物。先輩が手で22を足した |

ノード：実物だけが違ってます。第2ページの「問い2：いまの実物は、手順書と同じか？」の状況だ。

博士：うむ。ここで、あのとき後回しにした答えが出てくるぞ。

### drift：実物が、記録からずれること

> **用語：drift**（ドリフト）
> Terraformを通さずに（コンソールでの手作業など）実物が変えられ、実物と state（とファイル）がずれている状態。

ノード：Terraformは、ずれに気づけるんですか？

博士：第5ページで、plan の手順を説明したのを覚えているかね。「state を読み、その実物をAWSに問い合わせて、いまの設定を読み直す」。

> **用語：refresh**（リフレッシュ）
> plan や apply の最初に行われる、state に記録された実物をAWSに問い合わせて読み直す処理。ここで実物と state の違い（drift）が見つかる。

博士：だから、先輩が手で足した22番は、次の plan でこう表示される。`ingress` の行はとても長いので、2行に折り返し、一部を `...` で省いてある。

```text
$ terraform plan
Note: Objects have changed outside of Terraform

  # aws_security_group.web has changed（Terraform の外で変更された属性: ingress）

Terraform will perform the following actions:

  # aws_security_group.web will be updated in-place
  ~ resource "aws_security_group" "web" {
      ~ ingress = [ { from_port = 80, ... }, { from_port = 22, to_port = 22, protocol = "tcp", cidr_blocks = [ "0.0.0.0/0" ] } ]
               -> [ { from_port = 80, to_port = 80, protocol = "tcp", cidr_blocks = [ "0.0.0.0/0" ] } ]
    }

Plan: 0 to add, 1 to change, 0 to destroy.
```

ノード：一番上に `Note: Objects have changed outside of Terraform`……「Terraformの外で、ものが変わりました」！

博士：これが refresh で見つかった drift の報告だ。そして、その下が予告だ。どう読む？

ノード：`~` だからその場の変更で、`ingress` が「80と22」から「80だけ」に変わる……。あ、22番を消して、ファイルのとおりに戻そうとしてるんだ。

博士：その通り。Terraformにとって正しいのは、いつもファイルだ。だから、実物がずれていれば、ファイルどおりに戻す予告を作る。

### ずれを見つけたら、どちらに合わせるか

ノード：じゃあ、このまま apply すれば解決ですね。

博士：その前に、1つ判断がいる。先輩が足したルールは、消してよいものかね？

ノード：あ……。もしかしたら、「22番は必要だから残して」ってこともある？

博士：そうだ。drift を見つけたら、2つの道がある。

| 判断 | 対応 |
| --- | --- |
| 手での変更が間違い（消し忘れなど） | そのままapplyし、実物をファイルに戻す |
| 手での変更が正しい（必要なルール） | ファイルにingressを書き足し、planがNo changesになることを確かめる |

博士：今回は、どこからでも22番を開けておくのは危険だから、道1だな。apply すれば `web-sg` は80番だけに戻る。

ノード：道2のときも、結局はファイルに書くんですね。

博士：うむ。どちらの道でも、最後は「ファイル＝実物」に戻す。緊急で手を入れたなら、後でファイルにも反映する。それが約束なのだ。

> **現場では**
> drift は、コンソールでの緊急対応などで現実に起きます。本物のTerraformでは `terraform plan -detailed-exitcode` が、差分なしなら終了コード（コマンドが終わるときに返す番号）0、差分ありなら2を返すので、これを毎日自動で実行して drift を通知する運用がよくあります（このシミュレータでは使えません）。

### import：手で作った既存のリソースを取り込む

博士：今度は逆の場面だ。昔だれかがコンソールで手作業で作った運用用のVPC `ops-vpc`（`10.50.0.0/16`、ID は `vpc-0legacy01`）がある。これもTerraformで管理したい。

ノード：resourceブロックを書いて apply すれば……。

博士：やってみよう。

```hcl
resource "aws_vpc" "ops" {
  cidr_block = "10.50.0.0/16"

  tags = {
    Name = "ops-vpc"
  }
}
```

```text
$ terraform plan
  # aws_vpc.ops will be created
  + resource "aws_vpc" "ops" {
      + cidr_block = "10.50.0.0/16"
      ...
Plan: 1 to add, 0 to change, 0 to destroy.
```

ノード：`will be created`！？ もうあるのに、新しく作ろうとしてます！

博士：state に `aws_vpc.ops` がないからだ。Terraformは「ファイルにあって state にないもの」を新しく作る。実物がAWSにあっても、state に書かれていなければ、Terraformは知らないのだ。

ノード：じゃあ、state に「`aws_vpc.ops` は `vpc-0legacy01` です」と書いてあげればいい？

博士：その通り。それをするのがこのコマンドだ。

> **用語：import**（terraform import）
> すでにある実物を、Terraformの管理に取り込むコマンド。`terraform import リソースアドレス 実物のID` と実行すると、state に対応を書き込む。ファイル（resourceブロック）は作らないので、先に自分で書いておく。

```text
$ terraform import aws_vpc.ops vpc-0legacy01
aws_vpc.ops: Importing from ID "vpc-0legacy01"...
Import successful!

$ terraform plan
  # aws_vpc.ops will be updated in-place
  ~ resource "aws_vpc" "ops" {
      ~ enable_dns_hostnames      = true -> false
    }
```

ノード：取り込めたけど、`~` の予告が出ました。`true -> false`？

博士：実物の `ops-vpc` は、DNSホスト名が有効になっていたのだ。ファイルには書いていないから、既定値の `false` に変える予告になった。このまま apply したら？

ノード：運用VPCの設定が勝手に変わっちゃう！ じゃあ、ファイルに `enable_dns_hostnames = true` を書き足して、実物に合わせる。

博士：そうだ。import の後は、plan が No changes になるまで、ファイルを実物に合わせる。そこまでできて、取り込み完了だ。

> **注意**
> `terraform import` は state に対応を書き込むだけで、ファイルは作りません。import の後の plan に `~` や `-/+` が出たら、それはファイルと実物の違いです。そのまま apply せず、まずファイルを実物に合わせます。

### 管理をやめる：state rm

ノード：逆に、Terraformの管理から外したいときは？ ブロックを消すと、第8ページの話だと実物まで消えちゃいますよね。

> **用語：state rm**（terraform state rm）
> state から指定したリソースの記録だけを消すコマンド。実物は消さない。そのリソースは、Terraformの管理から外れ、手作業で管理するものに戻る。

博士：`terraform state rm aws_vpc.ops` を実行してから、ファイルのブロックを消す。そうすれば実物は残る。順番を逆にすると、削除の予告になるから注意したまえ。

> **シミュレータ**
> 画面の「コンソールで誰かがSGを変更（ドリフト）」ボタンで、apply 済みのセキュリティグループに 22/tcp の許可を手で足した状態を再現できます。本物のTerraform 1.5 以降では、ファイルに `import` ブロックを書いて取り込む方法もありますが、このシミュレータは `terraform import` コマンドだけに対応しています。

> **まとめ**
>
> - drift は、Terraformの外で実物が変わり、記録とずれた状態。plan の refresh で見つかり `Objects have changed outside of Terraform` と表示される
> - plan はいつもファイルどおりに戻す予告を作る。手での変更が正しければ、ファイルに書き足す
> - import は既存の実物を state に取り込む。ファイルは自分で書き、No changes になるまで実物に合わせる
> - state rm は管理から外すだけで、実物は残る

## チームで使う：state の置き場所とロック

博士：ここまでは、ノード君が1人で、自分のPCでTerraformを動かしてきた。state は、作業ディレクトリの `terraform.tfstate` というファイルだったな。では、チームの3人で同じネットワークを管理するとしたら？

ノード：ファイル（`.tf`）はGitで共有できます。でも state はGitに入れちゃだめなんですよね……。

博士：そうだ。state がノード君のPCにしかないと、困ることが3つある。

```text
困りごと1  先輩のPCには state がない
           → 先輩が plan すると「全部これから作る」と予告される。apply したら二重に作られる

困りごと2  ノード君のPCが壊れたら、state も消える
           → Terraformは、自分が作った実物を見失う

困りごと3  2人が同時に apply したら？
           → 2人がそれぞれの記録を書き込み、state が食い違って壊れる
```

ノード：困りごと1、こわいですね。先輩が悪いわけじゃないのに。

### バックエンド：state の置き場所

博士：そこで、state をみんなが読み書きできる共有の場所に置く。その「置き場所」を指定する仕組みがある。

> **用語：バックエンド**（backend）
> Terraformが state を保存する場所の設定。何も書かなければ、作業ディレクトリの `terraform.tfstate`（ローカル）に保存される。terraformブロックの中に `backend` ブロックとして書く。

> **用語：リモートバックエンド**（remote backend）
> state を、ネットワーク上の共有の保存場所に置くバックエンド。AWSでは、ファイルを保存するサービス S3 がよく使われる。チームの全員が同じ state を読み書きでき、PCが壊れても state は残る。

博士：S3に置くなら、こう書く。

```hcl
terraform {
  backend "s3" {
    bucket       = "path-terraform-state"
    key          = "network/terraform.tfstate"
    region       = "ap-northeast-1"
    encrypt      = true
    use_lockfile = true
  }
}
```

ノード：`bucket` は保存先の名前で、`key` はその中のファイル名ですね。`encrypt = true` は暗号化？

博士：うむ。state には秘密の値が入ることもある、と第5ページで言ったな。だから、置き場所では暗号化し、読める人も限る。第4ページの init の出力に `Initializing the backend...` という行があっただろう。あれが、このバックエンドの準備だ。バックエンドを変えたら、init をやり直す。

### stateロック：同時に書き込ませない

ノード：最後の `use_lockfile = true` は？

博士：困りごと3の対策だ。

> **用語：stateロック**（state lock）
> plan や apply を実行している間、state に「使用中」の印を付けて、ほかの人が同時に state を書き換える操作をできないようにする仕組み。終われば自動で外れる。

博士：S3のバックエンドでは、昔は DynamoDB（AWSのデータベースのサービス）の表を使ってロックしていた。新しいバージョンでは、`use_lockfile = true` でS3の中にロック用のファイルを置けるようになった。

ノード：ロックされてるときに、僕が plan したらどうなるんですか？

博士：こう断られる。

```text
$ terraform plan
╷
│ Error: Error acquiring the state lock
│
│ ほかの人（または CI）の操作が state をロックしているため、実行できません。
│ Lock Info:
│   ID:        f3c1-77ab
│   Who:       teammate@ci-runner
│   Operation: OperationTypeApply
╵
```

ノード：`Who` がロックしている人、`Operation: OperationTypeApply` は「いま apply 中」ですね。

博士：そうだ。正しい対応は、相手の apply が終わるのを待つことだ。待てば、ロックは自動で外れる。

ノード：もし、相手のPCが apply の途中で固まって、ロックだけが残っちゃったら？

> **用語：force-unlock**（terraform force-unlock）
> 残ってしまったロックを、手で外すコマンド。`terraform force-unlock ロックID` と実行する。相手の処理が本当に止まっているときだけ使う。

博士：force-unlock を使うのは、「相手の処理がもう動いていない」と確かめてからだ。まだ動いている apply のロックを外して自分も apply したら、ロックがない状態と同じ事故になる。

> **注意**
> ロックのエラーは「故障」ではなく「守ってくれている」表示です。すぐに force-unlock せず、まずロックしている人（`Who`）に確認します。

### だれが apply するのか

博士：ロックがあっても、3人がそれぞれのPCから好きなときに apply していたら、どうなると思う？

ノード：ロック待ちが多くなりそう……。あと、プルリクエストでレビューしてない変更が、だれかのPCから apply されちゃうかも。

博士：その通りだ。そこで現場では、apply する経路を1つに決めることが多い。

> **用語：CI**（シーアイ／Continuous Integration）
> ファイルの変更をきっかけに、テストや実行を自動で行う仕組み。Terraformでは、プルリクエストを作ると自動で plan を実行して結果を貼り、承認されて取り込まれたら自動で apply する、という流れを作るのに使う。

ノード：人のPCからは apply しないで、レビューが通ったものだけを CI が apply するんですね。それなら、レビューした予告と実行される内容がずれない。

博士：うむ。さっきのロックのエラーの `Who: teammate@ci-runner` も、CI が apply 中だったという例だ。

> **現場では**
> - state は責任の単位で分けます。ネットワーク（VPC・サブネット）と、その上のアプリ、本番と検証を1つの state にまとめると、小さな変更の予告にも全体が並び、ミスの影響も大きくなります。分けた state どうしは output で値を受け渡します
> - state の置き場所（S3など）は、暗号化・アクセス制限・バージョニング（過去の版を残す機能）を有効にし、壊れたときに前の版へ戻せるようにします
> - output に `sensitive = true` を付けると画面には表示されなくなりますが、state の中では平文（暗号化されていない、そのまま読める文字）のままです。state を読める人を絞ることが大切です
> - Terraform本体とプロバイダのバージョンを固定し、`.terraform.lock.hcl` をGitに入れます

> **シミュレータ**
> このシミュレータでは、`backend` ブロックを書いてもエラーにはなりませんが、無視されます。state は常にブラウザの中のワークスペースに保存されます。画面の「チームメイトが apply 中（stateロック）」ボタンでロックされた状態を、「チームメイトのロックを解除」ボタンで相手の apply が終わった状態を再現できます。`terraform force-unlock f3c1-77ab` も試せます。

> **まとめ**
>
> - state を各自のPCに置くと、二重作成・紛失・同時書き込みが起きる。チームではリモートバックエンド（S3など）に置く
> - stateロックは、同時に apply して state が壊れるのを防ぐ。エラーが出たら、まず相手の処理が終わるのを待つ
> - force-unlock は、相手の処理が止まっていると確かめてからだけ使う
> - apply は CI など決まった経路から行い、state は暗号化してアクセスを絞る

## module：同じ構成を、部品として使い回す

博士：いよいよ最後の本題だ。上司の頼み「同じネットワークを、検証用にもう1つ」に、正面から答えよう。

ノード：第10ページでは、変数の値を変えるだけだと、同じVPCが作り直されちゃう、って話でした。

博士：うむ。必要なのは「同じ形のものを、もう1組」だ。そのために、リソースのまとまりを1つの **部品** にする。

> **用語：module**（モジュール）
> いくつかのリソースと variable・output を1つのフォルダにまとめ、部品として呼び出せるようにしたもの。同じ module を、渡す値を変えて何度も呼び出せる。呼び出すと、中のリソースが呼び出した回数だけ作られる。

### module の中身：入口と出口のある部品

博士：例として、VPCとパブリックサブネットを1つの部品にしてみよう。`modules/network/main.tf` というファイルを作る。

```hcl
variable "name" {
  type = string
}

variable "cidr" {
  type = string
}

resource "aws_vpc" "this" {
  cidr_block = var.cidr

  tags = {
    Name = "${var.name}-vpc"
  }
}

resource "aws_subnet" "public" {
  vpc_id            = aws_vpc.this.id
  cidr_block        = cidrsubnet(var.cidr, 8, 1)
  availability_zone = "ap-northeast-1a"
}

output "vpc_id" {
  value = aws_vpc.this.id
}
```

ノード：中身は、今まで書いてきたのと同じですね。variable が2つ、resource が2つ、output が1つ。

博士：そうだ。ただし、役割が少し変わる。module の variable は「部品の入口」、output は「部品の出口」になる。

```theory-diagram
terraform-module-tree
```

ノード：`aws_vpc.this` の `this` は？

博士：部品の中にVPCは1つしかないから、「この部品のVPC」という意味でよく使われる呼び名だ。`main` でもかまわない。

### module を呼び出す

博士：部品を使う側は、作業ディレクトリに `stg.tf` を作って、こう書く。

```hcl
module "stg" {
  source = "./modules/network"
  name   = "path-stg"
  cidr   = "10.1.0.0/16"
}

output "stg_vpc_id" {
  value = module.stg.vpc_id
}
```

博士：`module` ブロックの `source` は、部品のフォルダの場所だ。残りの `name` と `cidr` が、部品の入口（variable）に渡す値になる。

ノード：部品の出口の `vpc_id` は、`module.stg.vpc_id` で読むんですね。

博士：うむ。ここで言葉を整理しておこう。今まで書いてきた作業ディレクトリのファイル全体も、実は1つの module なのだ。

> **用語：ルートモジュール**（root module）
> コマンドを実行する作業ディレクトリの `.tf` ファイル全体のこと。Terraformは、ルートモジュールから読み始め、そこで呼び出された module を順にたどる。

> **用語：子モジュール**（child module）
> ほかの module から `module` ブロックで呼び出される module。例では `modules/network` が、ルートモジュールから呼ばれる子モジュール。

### init、plan、そしてアドレス

博士：module を足したら、まず init だ。第4ページで「module を変えたら、もう一度 init」と言ったな。

```text
$ terraform init
Initializing the backend...
Initializing modules...
- modules/network
Initializing provider plugins...
...
Terraform has been successfully initialized!
```

```text
$ terraform plan
  # module.stg.aws_vpc.this will be created
  + resource "aws_vpc" "this" {
      + cidr_block                = "10.1.0.0/16"
      + tags                      = { Name = "path-stg-vpc" }
      ...
    }

  # module.stg.aws_subnet.public will be created
  + resource "aws_subnet" "public" {
      + vpc_id                  = (known after apply)
      + cidr_block              = "10.1.1.0/24"
      + availability_zone       = "ap-northeast-1a"
      ...
    }

Plan: 2 to add, 0 to change, 0 to destroy.
```

ノード：リソースアドレスの頭に `module.stg.` が付いてます！ `module.stg.aws_vpc.this`。

博士：子モジュールの中のリソースは、「どの module 呼び出しの中か」が住所の頭に付く。だから、同じ部品を `module "stg"` と `module "dev"` で2回呼んでも、アドレスはぶつからない。

ノード：そして、サブネットは `cidrsubnet("10.1.0.0/16", 8, 1)` で `10.1.1.0/24`。本番の `10.0.1.0/24` と同じ位置に、ちゃんと検証用の範囲で計算されてる。

博士：本番のリソースの予告が1つもないことも、確かめたまえ。`aws_vpc.main` は出てこない。本番には一切触れずに、検証用だけが増えるのだ。

```text
$ terraform state list
aws_internet_gateway.main
aws_route_table.public
aws_route_table_association.public
aws_security_group.web
aws_subnet.private[0]
aws_subnet.private[1]
aws_subnet.public
aws_vpc.main
module.stg.aws_subnet.public
module.stg.aws_vpc.this
```

博士：たとえるなら、module は洋服の **型紙** だな。型紙が1枚あれば、生地の色やサイズ（渡す値）を変えて何着でも作れる。型紙を直せば、次に作る服はすべて直る。

ノード：じゃあ、型紙（module）を直したら、もう作った服（実物）も全部直るんですか？

博士：そこはたとえと少し違う。Terraformでは、module を直して apply すれば、その module から作ったすべての実物に変更が予告される。便利だが、1か所の直しが全環境に波及するということでもある。だから予告をよく読むのだ。

### 住所が変わると、作り直しになる

ノード：本番のVPCも、同じ module で作り直したほうがきれいですよね？ `aws_vpc.main` を消して、`module "prod"` を書けば……。

博士：予告を想像してみたまえ。state には `aws_vpc.main` がある。ファイルからは消えた。代わりに `module.prod.aws_vpc.this` が現れた。

ノード：「`aws_vpc.main` は消す（`-`）」、「`module.prod.aws_vpc.this` は作る（`+`）」……。中身は同じなのに、本番のVPCが作り直しに！

博士：そうだ。Terraformは、リソースアドレスが変わると「別のもの」と考える。中身が同じでも、だ。そこで本物のTerraformには、住所の変更を伝える書き方がある。

> **用語：moved ブロック**（moved block）
> リソースアドレスが変わったことをTerraformに伝えるブロック。`moved { from = aws_vpc.main  to = module.prod.aws_vpc.this }` と書くと、実物を作り直さずに、state の住所だけを書き換える。Terraform 1.1 以降で使える。

ノード：引っ越しの届けを出すようなものですね。「中身は同じで、住所だけ変わりました」って。

博士：うまいことを言うな。

> **シミュレータ**
> このシミュレータでは、`source` に指定できるのは `./` か `../` で始まる、同じワークスペースの中のフォルダだけです（入れ子は3階層まで）。`moved` ブロックと `terraform state mv` には対応していないので、アドレスを変えると作り直しになります。

> **現場では**
> よく使う構成は、Terraform Registry（公開されている module の置き場）の module や、社内で共有する module を使います。その場合は module のバージョンも固定します。環境ごと（本番・検証）に作業ディレクトリと state を分け、それぞれから同じ module を、違う値で呼び出す形がよく使われます。

> **まとめ**
>
> - module は、リソース・variable（入口）・output（出口）をまとめた部品。値を変えて何度でも呼び出せる
> - 呼び出しは `module "名前" { source = "フォルダ" 入力 = 値 }`。出口は `module.名前.output名` で読む
> - 子モジュールのリソースのアドレスは `module.stg.aws_vpc.this` のように頭に module 名が付く
> - アドレスが変わると作り直しになる。本物では moved ブロックで住所だけを変えられる

## この章のまとめ

博士：ノード君、最初の上司の頼みごとを覚えているかね。「同じネットワークを検証用にもう1つ。それと、先週だれが何を変えたか教えて」。

ノード：はい。今なら答えられます！ 検証用は、VPCとサブネットを module にして、`module "stg"` で値を変えて呼び出せば、本番に触れずにもう1組作れます。先週の変更は、ファイルをGitで管理していれば、履歴で1行ずつわかります。

博士：うむ。では「いまの実物は、ファイルと同じか」は？

ノード：plan を実行すれば、最初の refresh で実物を読み直してくれます。だれかが画面から手で変えていたら、`Objects have changed outside of Terraform` と drift が表示されて、ファイルどおりに戻す予告が出ます。

博士：見事だ。この章で積み上げてきたことを、順に振り返ってみよう。

```theory-diagram
terraform-workflow-summary
```

ノード：参照式 `aws_vpc.main.id` で、リソースどうしをつなぐと、依存関係が決まって、作る順番もTerraformが決めてくれる。まだないリソースを指していると `(known after apply)`。

博士：そして、予告のどこを見る？

ノード：まず `Plan:` の destroy の数です。`-/+` があったら `# forces replacement` で原因を探して、参照をたどって何が巻き込まれるかを確かめる。サブネットのCIDRを1つ変えただけで、関連付けまで作り直しになりましたから。

博士：うむ。あとは、variable で値を外に出し、output で結果を見せ、count と cidrsubnet で繰り返しを書いた。チームでは state をリモートバックエンドに置いてロックし、apply は決まった経路から行う。

ノード：stateが、思っていたよりずっと大事でした。Terraformの記憶だから、消したり手で直したりしない。秘密も入っているから、Gitには入れない。

### 講座をふりかえって

博士：さて、ノード君。これで、この講座の12章はすべておしまいだ。

ノード：えっ、もう最後なんですか。

博士：思い返してみるといい。第1章では、通信が層ごとの分業でできている、という話から始めたな。そこからIPアドレスとサブネット、ルーティング、EthernetとVLAN、DNS、NATとファイアウォール。

ノード：Linuxでネットワークを調べて、パケットを読んで、ネットワークの設計をして……。第10章でAWSのVPCに行って、第11章でVPNとBGPでオンプレミスとつないで。そして最後が、全部をファイルに書くTerraformでした。

博士：今日の章にも、前の章がたくさん出てきただろう。cidrsubnet は第2章のサブネット計算そのもの。ルートテーブルの `0.0.0.0/0 → IGW` は第3章の経路と第10章のパブリックサブネット。SGの egress とステートフルな返事は、第6章のファイアウォールだ。

ノード：Terraformの書き方を覚えても、中身のネットワークがわかっていないと、予告を読んでも何が起きるのか説明できないんですね。

博士：その通りだ。道具は変わっていく。だが、パケットがどう流れ、経路がどう選ばれ、何が許可されるのかは変わらない。どこかで迷ったら、前の章に戻って読み直すといい。

ノード：はい。これからは、apply の前に plan を読むみたいに、手を動かす前に「何が起きるか」を読んでから動きます。

博士：うむ。それができれば、もう一人前だ。

ノード：パス博士、ありがとうございました！

path. ネットワーク講座でした〜♪

#### ノード君の今日のポイント

- IaC は、インフラのあるべき姿をファイルに書き、Gitとプルリクエストで履歴とレビューを残す考え方。Terraformのファイルは完成図（宣言的）
- 流れは init → validate → plan → apply。plan は何も変えずに予告だけを表示する。apply は `yes` で承認したときだけ実行される
- state は「リソースアドレス ↔ 実物のID」の記録。消さない・手で直さない・Gitに入れない。チームではリモートバックエンドに置いてロックする
- 作る順番は書いた順ではなく、参照式（暗黙の依存関係）で決まる。参照先がまだなければ `(known after apply)`
- 予告の記号は `+` 作成・`~` その場で変更・`-/+` 作り直し・`-` 削除。`# forces replacement` が作り直しの原因で、参照している側にも波及する
- 手での変更（drift）は plan で見つかり、ファイルどおりに戻す予告になる。既存の実物は import で取り込み、No changes になるまでファイルを合わせる
- variable・output・count・cidrsubnet・module で、同じ形のネットワークを値だけ変えて作れる。アドレスが変わると作り直しになる

### この先へ

この章で、講座の12章はすべて終わりです。次は、トップの「ロードマップ」のページにある **6つの総合課題（Capstone）** に挑戦してみましょう。複数の章で学んだことを組み合わせて、ネットワークの構築、障害の調査、設計の理由の説明に取り組みます。最後の Capstone 6 は、Capstone 4 で画面から作る3層構成のAWSネットワークを、この章で学んだTerraformのファイルで表現する課題です。plan を読んでから apply する、を忘れずに。
