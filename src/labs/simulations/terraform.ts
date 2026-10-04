import { subnetExposure } from '../../aws/model';
import type { TerraformWorkspace } from '../../terraform/engine';
import { terraformSimulation } from '../simulation';

type W = TerraformWorkspace;

// The chapter's running example, file by file (the Theory shows the same code).
const HEAD = `terraform {
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
`;
const VPC = `
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"

  tags = {
    Name = "path-vpc"
  }
}
`;
const SUBNET = `
resource "aws_subnet" "public" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.1.0/24"
  availability_zone = "ap-northeast-1a"

  tags = {
    Name = "path-public-a"
  }
}
`;
const PUBLIC = `
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
`;
const SG = `
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
`;
const DNS_VPC = VPC.replace('  cidr_block = "10.0.0.0/16"', '  cidr_block           = "10.0.0.0/16"\n  enable_dns_hostnames = true');
const VAR_HEAD = HEAD.replace('region = "ap-northeast-1"', 'region = var.region');
const VAR_VPC = DNS_VPC.replace('"10.0.0.0/16"', 'var.vpc_cidr').replace('Name = "path-vpc"', 'Name = "${var.project}-vpc"');
const VARIABLES = `variable "region" {
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
`;
const OUTPUTS = `output "vpc_id" {
  value = aws_vpc.main.id
}

output "public_subnet_id" {
  value = aws_subnet.public.id
}
`;
const AZS = `
variable "azs" {
  type    = list(string)
  default = ["ap-northeast-1a", "ap-northeast-1c"]
}
`;
const PRIVATE = `resource "aws_subnet" "private" {
  count             = length(var.azs)
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + 11)
  availability_zone = var.azs[count.index]

  tags = {
    Name = "\${var.project}-private-\${count.index}"
  }
}
`;
const PRIVATE_OUTPUT = `
output "private_subnet_ids" {
  value = aws_subnet.private[*].id
}
`;
const MODULE = `variable "name" {
  type = string
}

variable "cidr" {
  type = string
}

resource "aws_vpc" "this" {
  cidr_block = var.cidr

  tags = {
    Name = "\${var.name}-vpc"
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
`;
const STG = `module "stg" {
  source = "./modules/network"
  name   = "path-stg"
  cidr   = "10.1.0.0/16"
}

output "stg_vpc_id" {
  value = module.stg.vpc_id
}
`;
const START = `# 第12章 Simulation の作業ファイルです。Theory と同じ順に、ここへ書き足していきます。
${HEAD}
# ↓ ステップ1: この下に、VPC（resource "aws_vpc" "main"）を書きます。
`;
const hcl = (code: string) => `\`\`\`hcl\n${code.trim()}\n\`\`\``;
const text = (code: string) => `\`\`\`text\n${code.trim()}\n\`\`\``;
const RECHECK = 'コードを編集しただけでは判定されません。validate / plan / apply などのコマンドを実行したときに判定されます。';

// Checks read the state and the simulated cloud (what apply produced), not the editor.
const managed = (w: W, type: string) => Object.values(w.state.resources).filter(r => r.type === type);
const vpc = (w: W) => w.state.resources['aws_vpc.main'];
const publicSubnet = (w: W) => w.state.resources['aws_subnet.public'];
/** Root .tf files without comments (the comments of the starting file must not count as code). */
const rootCode = (w: W) => Object.entries(w.files).filter(([f]) => f.endsWith('.tf') && !f.includes('/')).map(([, s]) => s.replace(/#.*$/gm, '')).join('\n');
const declaredVpc = (w: W) => w.buildPlan('validate').changes.find(c => c.address === 'aws_vpc.main')?.after.cidr_block;
const apply = (w: W) => { w.run('apply'); w.confirm(true); };

/** Chapter 12: the running example of the Theory, written and applied one block at a time. */
export const iacSimulation = terraformSimulation({
  id: 'sim-terraform', chapter: 'terraform', minutes: 45,
  title: '例のネットワークを、Terraformのコードで組み立てる',
  mission: 'VPC・パブリックサブネット・SG・プライベートサブネット・検証用VPCを、plan で予告を読んでから apply して作る',
  brief: [
    '`main.tf` には terraform ブロックと provider ブロックだけが書いてあり、まだ何も作られていません（init もまだです）。Theory と同じ順に、ブロックを1つずつ書き足し、plan で予告を読んでから apply します。',
    text(`東京リージョン（ap-northeast-1）
VPC  path-vpc  10.0.0.0/16（aws_vpc.main）
 ├─ パブリックサブネット 10.0.1.0/24（1a） ── ルートテーブル public: 0.0.0.0/0 → Internet Gateway
 ├─ セキュリティグループ web-sg（80/tcp を受け付ける）
 └─ プライベートサブネット 10.0.11.0/24（1a）・10.0.12.0/24（1c）  ← count と cidrsubnet

検証用 VPC path-stg-vpc 10.1.0.0/16（module.stg）  ← module で同じ形をもう1つ`),
    '操作は、エディタでファイルを書き、下のボタン（terraform init / validate / plan / apply など）か、コマンド欄で実行します。apply は予告の下に出る「yes: 実行する」で承認します。新しいファイルは、ファイルのタブの右にある入力欄で作ります。',
    `${RECHECK} 右の「構成図」に apply 後の実物、「依存関係」に作る順番、「state」にリソースアドレスとIDの対応が表示されます。`,
  ].join('\n\n'),
  build: () => ({ files: { 'main.tf': START } }),
  sim: [
    { title: 'VPCのコードを書いて、init する',
      body: [
        'Theory「HCLで、VPCを1つ書いてみる」で書いたVPCを、`main.tf` の最後に書き足します。',
        hcl(VPC),
        '書けたら「terraform init」を押してプロバイダを準備し、続けて「terraform validate」を押します。`Success! The configuration is valid.` と表示されれば、書き方は正しく入っています。',
        RECHECK,
      ].join('\n\n'),
      hints: ['init の前に validate や plan を実行すると「まだ terraform init を実行していません」というエラーになります。先に init を押しましょう。', 'validate のエラーにある「on main.tf line N」の行を見直します。引数の名前は cidr_block、マップの tags は `tags = { ... }` とイコールを付けます。'],
      check: w => w.initialized && (vpc(w)?.attributes.cidr_block ?? declaredVpc(w)) === '10.0.0.0/16',
      solve: w => { w.files['main.tf'] = HEAD + VPC; w.run('init'); } },
    { title: 'plan で予告を読み、apply でVPCを作る',
      body: [
        '「terraform plan」を押し、予告を上から読みます（Theory「init・validate・plan」）。凡例の `+ create`、見出しの `# aws_vpc.main will be created`、中身の `(known after apply)`、最後の `Plan: 1 to add, 0 to change, 0 to destroy.` を確かめましょう。',
        '読めたら「terraform apply」を押し、同じ予告が表示されたら「yes: 実行する」で承認します。次のように表示され、右の構成図にVPCが描かれれば完了です。',
        text('aws_vpc.main: Creating...\naws_vpc.main: Creation complete [id=vpc-…]\n\nApply complete! Resources: 1 added, 0 changed, 0 destroyed.'),
        '「state」タブで、`aws_vpc.main` と `vpc-…` の対応が記録されたことも見ておきましょう。もう一度 plan すると `No changes.` になります（冪等）。',
      ].join('\n\n'),
      check: w => vpc(w)?.attributes.cidr_block === '10.0.0.0/16' && !!w.cloud.resources[vpc(w).id],
      solve: apply,
      quiz: { question: 'apply の前の plan で、VPCの id が (known after apply) と表示されていたのはなぜですか？', options: ['ファイルに id を書き忘れていたから', 'VPCのIDはAWSが作成したときに決めるので、予告の時点ではまだ決まっていないから', 'plan がエラーになり、値を読めなかったから'], answer: 1, explanation: 'IDはAWSが作成時に付ける値です。apply の出力 Creation complete [id=vpc-…] で初めて決まり、state に記録されます。エラーではありません。' } },
    { title: 'サブネットを足して、VPCを参照させる',
      body: [
        'パブリックサブネット 10.0.1.0/24 を書き足します。`vpc_id` には、IDを直接書かずに参照式 `aws_vpc.main.id` を書きます（Theory「参照式で、リソースどうしをつなぐ」）。',
        hcl(SUBNET),
        'plan で予告を読み、apply して承認します。「依存関係」タブでは、サブネットがVPCの次の段に並びます。',
        RECHECK,
      ].join('\n\n'),
      hints: ['`vpc_id = "vpc-…"` のようにIDを文字列で書くと、暗黙の依存関係ができません。`" "` で囲まずに aws_vpc.main.id と書きます。'],
      check: w => { const s = publicSubnet(w); return s?.attributes.cidr_block === '10.0.1.0/24' && s.attributes.vpc_id === vpc(w)?.id && s.dependencies.includes('aws_vpc.main'); },
      solve: w => { w.files['main.tf'] = HEAD + VPC + SUBNET; apply(w); },
      quiz: { question: 'apply の前の plan で、サブネットの vpc_id はどう表示されましたか？', options: ['(known after apply)', '"vpc-…" という、作成済みのVPCの実際のID', 'aws_vpc.main.id という文字', 'null'], answer: 1, explanation: 'VPCは前のステップで作成済みで、state にIDがあるため、参照式は予告の時点で実際のIDに置き換わります。VPCとサブネットを同時に作る場合は、VPCのIDがまだないので (known after apply) になります。' } },
    { title: 'Internet Gateway とルートテーブルで、パブリックにする',
      body: [
        'サブネットは、関連付けたルートテーブルに `0.0.0.0/0 → Internet Gateway` の経路があればパブリックになります（第10章）。3つのリソースを書き足します（Theory「パブリックサブネットに仕上げる」）。',
        hcl(PUBLIC),
        'plan では、作成済みのVPC・サブネットを指す `vpc_id`・`subnet_id` には実際のIDが、これから作るIGW・ルートテーブルを指す `gateway_id`・`route_table_id` には `(known after apply)` が出ます。apply して承認し、構成図でサブネットがパブリックになったことを確かめます。',
        RECHECK,
      ].join('\n\n'),
      hints: ['`route { }` はイコールを付けないネストしたブロックです。', '関連付け（aws_route_table_association）を忘れると、サブネットはメインルートテーブルを使うので、プライベートのままです。'],
      check: w => { const m = w.awsModel(); const s = m.subnets.find(x => x.cidr === '10.0.1.0/24'); return !!s && subnetExposure(m, s).public && managed(w, 'aws_route_table_association').length > 0; },
      solve: w => { w.files['main.tf'] = HEAD + VPC + SUBNET + PUBLIC; apply(w); } },
    { title: 'セキュリティグループ web-sg を足す',
      body: [
        'Webサーバー用のセキュリティグループを書き足します。Terraformで作るSGには、外向き全許可のルールが自動では付かないので、egress も書きます（Theory「パブリックサブネットに仕上げる」）。',
        hcl(SG),
        'plan で `+ resource "aws_security_group" "web"` を確かめ、apply して承認します。',
        RECHECK,
      ].join('\n\n'),
      hints: ['ingress と egress は、どちらもイコールを付けないネストしたブロックです。protocol = "-1" は「すべてのプロトコル」で、ポートは 0〜0 にします。'],
      check: w => managed(w, 'aws_security_group').some(sg => {
        const rules = (k: string) => (sg.attributes[k] as { from_port: number; to_port: number; protocol: string; cidr_blocks?: string[] }[] | undefined) ?? [];
        return sg.attributes.name === 'web-sg' && sg.attributes.vpc_id === vpc(w)?.id
          && rules('ingress').some(r => r.protocol === 'tcp' && r.from_port <= 80 && r.to_port >= 80 && !!r.cidr_blocks?.includes('0.0.0.0/0'))
          && rules('egress').some(r => r.protocol === '-1' && !!r.cidr_blocks?.includes('0.0.0.0/0'));
      }),
      solve: w => { w.files['main.tf'] = HEAD + VPC + SUBNET + PUBLIC + SG; apply(w); } },
    { title: 'VPCの設定を、その場で変える',
      body: [
        'VPCの中のEC2にDNSの名前を付けられるよう、VPCに `enable_dns_hostnames = true` を足します（Theory「plan の記号を読む」）。',
        hcl(DNS_VPC),
        'plan を実行し、記号と矢印の行を読みます。',
        text('  ~ resource "aws_vpc" "main" {\n      ~ enable_dns_hostnames      = false -> true\n    }\n\nPlan: 0 to add, 1 to change, 0 to destroy.'),
        '読めたら apply して承認します。',
      ].join('\n\n'),
      check: w => vpc(w)?.attributes.enable_dns_hostnames === true,
      solve: w => { w.files['main.tf'] = HEAD + DNS_VPC + SUBNET + PUBLIC + SG; apply(w); },
      quiz: { question: 'この変更の予告の記号と、apply の後のVPCのIDはどうなりましたか？', options: ['~（update in-place）。IDはそのまま', '-/+（置き換え）。新しいIDになった', '+（create）。VPCがもう1つ作られた'], answer: 0, explanation: 'enable_dns_hostnames は、その場で変えられる引数です。実物は消えず、IDも変わらないので、VPCを参照しているサブネットなどにも影響しません。' } },
    { title: 'サブネットのCIDR変更を予告で読み、取りやめる',
      body: [
        '今度は、サブネットの `cidr_block` を `"10.0.10.0/24"` に書き換えて、**plan だけ** を実行します。apply はしません（Theory「plan の記号を読む」「危ない変更を、apply の前に止める」）。',
        '予告の `-/+`、`must be replaced`、行末の `# forces replacement`、最後の `Plan:` の行を読みましょう。',
        '読み終えたら `cidr_block` を `"10.0.1.0/24"` に戻し、もう一度 plan して `No changes.` になることを確かめます。',
      ].join('\n\n'),
      hints: ['もし apply してしまったら、cidr_block を "10.0.1.0/24" に戻してもう一度 apply すれば、元のアドレスで作り直されます。'],
      quiz: { question: 'cidr_block を 10.0.10.0/24 にしたときの予告で、置き換え（-/+）になったリソースはどれですか？', options: ['aws_subnet.public だけ', 'aws_subnet.public と aws_route_table_association.public', 'aws_vpc.main を含む、すべてのリソース', 'どれも置き換えにならず、~ でその場で変わる'], answer: 1, explanation: 'サブネットのCIDRはその場で変えられない（# forces replacement）ため、サブネットが作り直されます。新しいサブネットはIDが変わるので、それを参照している関連付けの subnet_id も変わり、関連付けも作り直しになります（Plan: 2 to add, 0 to change, 2 to destroy.）。' } },
    { title: '値を variable に出し、output で見せる',
      body: [
        'Theory「variable・locals・output」のとおり、値を変数に出し、IDを output で見せます。ファイルのタブの右の入力欄で `variables.tf` と `outputs.tf` を作ります。',
        `**variables.tf**\n\n${hcl(VARIABLES)}`,
        `**outputs.tf**\n\n${hcl(OUTPUTS)}`,
        '`main.tf` では、provider の `region` を `var.region` に、VPCの `cidr_block` を `var.vpc_cidr` に、`Name` を `"${var.project}-vpc"` に書き換えます。',
        'plan を実行すると `No changes.` になります。書き方は変わっても、値は前と同じだからです。それでも apply して「yes: 実行する」を押すと、output の値が state に記録され、最後に `Outputs:` として `vpc_id` と `public_subnet_id` が表示されます。`terraform output` でも確かめられます。',
        RECHECK,
      ].join('\n\n'),
      hints: ['plan に ~ や -/+ が出たら、変数の既定値（default）か書き換えた値が、元の値と違っています。', 'output の値は apply したときに state に記録されます。リソースに変更がなくても、apply して「yes: 実行する」を押します。'],
      check: w => /cidr_block\s*=\s*var\.vpc_cidr/.test(rootCode(w)) && w.state.outputs.vpc_id === vpc(w)?.id && w.state.outputs.public_subnet_id === publicSubnet(w)?.id && vpc(w)?.attributes.cidr_block === '10.0.0.0/16',
      solve: w => { w.files['main.tf'] = VAR_HEAD + VAR_VPC + SUBNET + PUBLIC + SG; w.files['variables.tf'] = VARIABLES; w.files['outputs.tf'] = OUTPUTS; apply(w); } },
    { title: 'count と cidrsubnet で、プライベートサブネットを2つ作る',
      body: [
        'AZの一覧を変数にし、1つのブロックからプライベートサブネットを2つ作ります（Theory「count と cidrsubnet」）。`variables.tf` の最後に変数 `azs` を足します。',
        hcl(AZS),
        '新しいファイル `private.tf` を作ります。',
        hcl(PRIVATE),
        '`outputs.tf` に、スプラット式で2つのIDをまとめる output も足しましょう（任意）。',
        hcl(PRIVATE_OUTPUT),
        'plan で `aws_subnet.private[0]` が 10.0.11.0/24（1a）、`[1]` が 10.0.12.0/24（1c）になっていることを確かめ、apply して承認します。',
        RECHECK,
      ].join('\n\n'),
      hints: ['cidrsubnet("10.0.0.0/16", 8, 11) は 10.0.11.0/24 です。count.index は0から始まるので、+ 11 で 11 と 12 になります。', 'var.azs[count.index] で、0番目は ap-northeast-1a、1番目は ap-northeast-1c になります。'],
      check: w => {
        const subs = Object.values(w.state.resources).filter(r => /^aws_subnet\.\w+\[\d+\]$/.test(r.address));
        const has = (c: string, az: string) => subs.some(s => s.attributes.cidr_block === c && s.attributes.availability_zone === az && s.attributes.vpc_id === vpc(w)?.id);
        return has('10.0.11.0/24', 'ap-northeast-1a') && has('10.0.12.0/24', 'ap-northeast-1c') && /cidrsubnet\(/.test(rootCode(w));
      },
      solve: w => { w.files['variables.tf'] = VARIABLES + AZS; w.files['private.tf'] = PRIVATE; w.files['outputs.tf'] = OUTPUTS + PRIVATE_OUTPUT; apply(w); } },
    { title: 'コンソールでの変更（drift）を見つけて、戻す',
      body: [
        'エディタの下の「コンソールで誰かがSGを変更（ドリフト）」ボタンを押します。web-sg に、0.0.0.0/0 からの 22/tcp（SSH）の許可が「手で」足された状態になります（Theory「コードの外で変わったら」）。',
        'plan を実行し、一番上の `Note: Objects have changed outside of Terraform` と、その下の予告を読みます。',
        '今回は、どこからでもSSHを開けておくのは危険なので、ファイルどおりに戻します。apply して承認し、もう一度 plan して `No changes.` になることを確かめましょう。',
      ].join('\n\n'),
      quiz: { question: 'ドリフトの後の plan は、何を予告しましたか？', options: ['web-sg を作り直す（-/+）', 'web-sg の ingress から 22番のルールを消す、その場の変更（~）', '何も予告しない（No changes）', 'ファイルに 22番の ingress を書き足す'], answer: 1, explanation: 'refresh で実物を読み直すと、ファイルにない 22番のルールが見つかります（drift）。Terraformにとって正しいのはいつもファイルなので、22番を消してファイルどおりに戻す ~ の予告になります。Terraformがファイルを書き換えることはありません。' } },
    { title: 'チームメイトの state ロックに出会う',
      body: [
        '「チームメイトが apply 中（stateロック）」ボタンを押してから、plan を実行します（Theory「チームで使う」）。エラーの `Lock Info` の `Who` と `Operation` を読みましょう。',
        '相手の apply が終わった状態にするには「チームメイトのロックを解除」ボタンを押します（相手の処理が止まってロックだけが残った場合に限り、`force-unlock f3c1-77ab` で外します）。解除したら、もう一度 plan して `No changes.` を確かめます。',
      ].join('\n\n'),
      quiz: { question: 'ロック中に plan を実行したとき、何が起き、まずどうするのが正しいですか？', options: ['plan はロックと関係なく実行できた。そのまま apply してよい', 'Error acquiring the state lock で止まった。ロックしている相手（Who）の apply が終わるのを待つ', 'Error acquiring the state lock で止まった。すぐに force-unlock で外す'], answer: 1, explanation: 'ロックは、2人が同時に state を書き換えて壊すのを防ぐ仕組みです。エラーは「守ってくれている」表示なので、まず相手の処理が終わるのを待ちます。force-unlock は、相手の処理が本当に止まっていると確かめてからだけ使います。' } },
    { title: 'module で、検証用のVPCをもう1つ作る',
      body: [
        'VPCとサブネットを部品（module）にし、値を変えて検証用を作ります（Theory「module」）。ファイルのタブの右の入力欄で `modules/network/main.tf` を作ります。',
        hcl(MODULE),
        '作業ディレクトリ（ルートモジュール）には `stg.tf` を作ります。',
        hcl(STG),
        'module を足したので、まず「terraform init」を押します（`Initializing modules...` に `- modules/network` が出ます）。plan で `module.stg.aws_vpc.this`（10.1.0.0/16）と `module.stg.aws_subnet.public`（10.1.1.0/24）だけが `+` になり、本番の `aws_vpc.main` には何も起きないことを確かめてから、apply して承認します。',
        RECHECK,
      ].join('\n\n'),
      hints: ['ファイル名は modules/network/main.tf です。module ブロックの source は "./modules/network" と、./ から書きます。', 'module の中の variable（name と cidr）に、module ブロックの中で値を渡します。出口の値は module.stg.vpc_id で読めます。'],
      check: w => {
        const inModule = Object.values(w.state.resources).filter(r => r.address.startsWith('module.'));
        const stg = inModule.find(r => r.type === 'aws_vpc' && r.attributes.cidr_block === '10.1.0.0/16');
        return !!stg && inModule.some(r => r.type === 'aws_subnet' && r.attributes.cidr_block === '10.1.1.0/24' && r.attributes.vpc_id === stg.id)
          && Object.values(w.state.outputs).includes(stg.id) && vpc(w)?.attributes.cidr_block === '10.0.0.0/16';
      },
      solve: w => { w.files['modules/network/main.tf'] = MODULE; w.files['stg.tf'] = STG; w.run('init'); apply(w); } },
  ],
  debrief: 'VPCから始めて、参照式でつないだパブリックサブネット、SG、count と cidrsubnet のプライベートサブネット、module の検証用VPCまでを、毎回 plan の予告を読んでから apply して組み立てました。+・~・-/+・- の違い、drift とロックの扱いも確かめました。実務では、この予告をプルリクエストに貼ってレビューし、決まった経路から apply します。',
});
