import { analyzePath, type AwsEndpoint } from '../../aws/analyzer';
import { byId, emptyModel, reservedAddresses, subnetExposure, type AwsModel, type Instance, type SgRule } from '../../aws/model';
import { allowAllNacl } from '../../aws/scenarios';
import { contains } from '../../simulator/l3/ipv4';
import { awsSimulation } from '../simulation';

const PUBLIC = '10.0.1.0/24', PRIVATE = '10.0.2.0/24';
const CLIENT: AwsEndpoint = { kind: 'internet', ip: '198.51.100.77' };
const UPDATES: AwsEndpoint = { kind: 'internet', ip: '198.51.100.10' };

// The GUI generates random IDs and default names, so the checks find things by address and relationship.
const vpc = (m: AwsModel) => m.vpcs.length === 1 && m.vpcs[0].cidr === '10.0.0.0/16' ? m.vpcs[0] : undefined;
const subnet = (m: AwsModel, cidr: string) => m.subnets.find(s => s.cidr === cidr && s.vpcId === vpc(m)?.id);
const inSubnet = (m: AwsModel, cidr: string) => m.instances.filter(i => byId(m.subnets, i.subnetId)?.cidr === cidr);
/** web: an instance in public-a with a public IP. db: any instance in private-a. */
const webs = (m: AwsModel) => inSubnet(m, PUBLIC).filter(i => i.publicIp);
const dbs = (m: AwsModel) => inSubnet(m, PRIVATE);
const to = (i: Instance): AwsEndpoint => ({ kind: 'instance', id: i.id });
const tcp = (m: AwsModel, from: AwsEndpoint, dst: AwsEndpoint, port: number) => analyzePath(m, from, dst, 'tcp', port);
const open = (r: SgRule) => r.cidr === '0.0.0.0/0';
const placed = (m: AwsModel, i: Instance) => { const s = byId(m.subnets, i.subnetId); return !!s && contains(s.cidr, i.privateIp) && !reservedAddresses(s.cidr).includes(i.privateIp); };
const webToDb = (m: AwsModel) => webs(m).some(w => dbs(m).some(d => tcp(m, to(w), to(d), 5432).reachable));
const dbOut = (m: AwsModel) => dbs(m).some(d => { const r = tcp(m, to(d), UPDATES, 443); return r.reachable && r.hops.some(h => h.component === 'NAT Gateway'); });

/** Chapter 10: the Theory's path-vpc, built from an empty model in the VPC Designer. */
export const awsVpcSimulation = awsSimulation({
  id: 'sim-aws', chapter: 'aws', minutes: 40,
  title: 'VPCを一から作り、行きと帰りで確かめる',
  mission: 'path-vpc を一から作り、インターネット → web（80）、web → db（5432）、db → 更新サーバー（443）を、行きと帰りの両方で届くようにする',
  brief: [
    '何もない状態から、Theoryで使った **path-vpc** を組み立てます。',
    '```text\n        Internet   client 198.51.100.77 / update server 198.51.100.10\n            |\n       [ path-igw ]\n            |\n+-- VPC path-vpc 10.0.0.0/16  (ap-northeast-1) ---------------+\n|  public-a 10.0.1.0/24          private-a 10.0.2.0/24         |\n|  (public-rt: 0.0.0.0/0 -> igw) (private-rt: 0.0.0.0/0 -> nat)|\n|                                                              |\n|  web   10.0.1.10  ------5432----> db  10.0.2.10              |\n|        203.0.113.10                   db-sg: 5432 from web-sg|\n|        web-sg: 80 from 0.0.0.0/0      db-acl                 |\n|  nat-a 203.0.113.20 <---443------  (OS updates)              |\n+--------------------------------------------------------------+\n```',
    'Theoryの順に、①VPCとサブネット → ②IGWとルートテーブルで「パブリック」を作る → ③SGとEC2でwebを公開し、行きと帰りを分析で読む → ④dbをプライベートサブネットに置き、SG参照で守る → ⑤NAT Gatewayで外へ出す → ⑥NACLで守りを重ねる、と進みます。',
    '左の RESOURCES のボタンで部品を追加し、右の PROPERTIES で設定します。入力欄は Enter を押すか、欄の外をクリックすると確定します。判定は名前やIDではなく、構成と到達性の分析の結果で行います。名前は Theory と同じにしておくと、分析の結果が読みやすくなります。',
  ].join('\n\n'),
  build: emptyModel,
  sim: [
    { title: 'VPCを作り、範囲を 10.0.0.0/16 にする',
      body: 'Theory「クラウドの中に、自分のネットワークを作る」の path-vpc を作ります。VPCの範囲は、ほかのネットワークと重ならないように最初に決めるのでした。\n\n1. 左の RESOURCES で **VPC** を押します。\n2. 右の PROPERTIES で、名前を `path-vpc`、「CIDR（/16〜/28）」を `10.0.0.0/16` にします。\n\nVPCと一緒に、メインルートテーブル（`vpc-1-main`）とデフォルトNACL（`vpc-1-default-acl`）が自動でできます。左の一覧で確かめましょう。\n\nCIDRは、サブネットを作る**前**に変えておきます（サブネットの範囲は、VPCの範囲から自動で選ばれます）。',
      hints: ['VPCの既定のCIDRは 10.20.0.0/16 です。PROPERTIES の「CIDR」を 10.0.0.0/16 に書き換え、Enterで確定します。', 'VPCは1つだけにします。2つ作ってしまったら、要らないほうを選んで「削除」します。'],
      check: m => !!vpc(m),
      solve: m => {
        m.vpcs.push({ id: 'vpc-path', name: 'path-vpc', cidr: '10.0.0.0/16' });
        m.routeTables.push({ id: 'rtb-main', name: 'vpc-1-main', vpcId: 'vpc-path', main: true, routes: [] });
        m.networkAcls.push({ id: 'acl-default', name: 'vpc-1-default-acl', vpcId: 'vpc-path', isDefault: true, entries: allowAllNacl() });
      } },
    { title: '公開用のサブネット public-a を作る',
      body: 'VPCを、公開する区画と隠す区画に分けます。まず、web を置く公開用のサブネットです（Theory「サブネットに分けて、サーバーを置く」）。\n\n1. RESOURCES の **Subnet** を押します。\n2. 名前を `public-a` にし、CIDR が `10.0.1.0/24`、AZ が `ap-northeast-1a` になっていることを確かめます。\n\nPROPERTIES に「インスタンスに使えるアドレスは 251 個です」と表示されます。先頭の4つと最後の1つは、AWSの予約です。見出しの印はまだ **Private** です。名前に public と付けても、パブリックにはなりません。',
      check: m => !!subnet(m, PUBLIC),
      solve: m => { m.subnets.push({ id: 'subnet-public-a', name: 'public-a', vpcId: 'vpc-path', cidr: PUBLIC, az: 'ap-northeast-1a' }); } },
    { title: 'Internet Gatewayを作り、VPCにアタッチする',
      body: 'VPCとインターネットの出入口、IGWを用意します（Theory「Internet Gatewayと『パブリック』の条件」）。\n\n1. RESOURCES の **Internet Gateway** を押します。\n2. 名前を `path-igw` にし、「アタッチ先VPC」が `path-vpc` になっていることを確かめます。\n\nIGWはサブネットの中には置かず、VPCに1つだけアタッチします。アタッチしただけでは、public-a は Private のままです。',
      check: m => m.internetGateways.some(g => !!g.vpcId && g.vpcId === vpc(m)?.id),
      solve: m => { m.internetGateways.push({ id: 'igw-path', name: 'path-igw', vpcId: 'vpc-path' }); } },
    { title: '公開用のルートテーブルを作り、public-a に関連付ける',
      body: 'VPCの外宛てのパケットをIGWへ送る経路を作ります。メインルートテーブルには入れず、公開用のルートテーブルを別に作って、public-a にだけ関連付けるのがポイントです（Theory「ルートテーブル — サブネットごとの経路表」）。\n\n1. RESOURCES の **Route Table** を押し、名前を `public-rt` にします。\n2. 「宛先CIDR」に `0.0.0.0/0`、「ターゲット」に `IGW path-igw` を選んで **経路を追加** を押します。\n3. 左の一覧で public-a を選び、「ルートテーブル」欄で `public-rt` を選びます（これが関連付けです）。\n\npublic-a の見出しが **Public** に変わり、理由に「public-rt の 0.0.0.0/0 → igw-… により…」と表示されれば完成です。',
      hints: ['経路を追加しただけでは足りません。public-a の設定で、ルートテーブルを public-rt に関連付けます。', 'メインルートテーブル（vpc-1-main）に 0.0.0.0/0 → IGW を入れると、このステップは完了しません。関連付けを忘れた新しいサブネットまでパブリックになるからです。'],
      check: m => {
        const s = subnet(m, PUBLIC); const rt = s && byId(m.routeTables, s.routeTableId);
        return !!rt && !rt.main && subnetExposure(m, s!).public && !m.routeTables.some(r => r.main && r.routes.some(x => x.target.startsWith('igw-')));
      },
      solve: m => {
        m.routeTables.push({ id: 'rtb-public', name: 'public-rt', vpcId: 'vpc-path', main: false, routes: [{ destination: '0.0.0.0/0', target: 'igw-path' }] });
        byId(m.subnets, 'subnet-public-a')!.routeTableId = 'rtb-public';
      } },
    { title: 'Webサーバー用のSG（web-sg）を作る',
      body: 'web に付けるSGを、先に作っておきます（Theory「Security Group — サーバーごとのステートフルな門番」）。この後EC2を追加すると、このSGが自動で付きます。\n\n1. RESOURCES の **Security Group** を押し、名前を `web-sg` にします。\n2. 「インバウンド」の行で、プロトコル `TCP`、開始ポート `80`、終了ポート `80`、送信元の種類 `CIDR`、CIDR `0.0.0.0/0` にして **追加** を押します。\n\nアウトバウンドには、作ったときから「All 0.0.0.0/0」が入っています。そのままにします。SSH（22番）など、Web以外のポートを 0.0.0.0/0 に開けると、このステップは完了しません。',
      check: m => m.securityGroups.some(g => g.vpcId === vpc(m)?.id
        && g.ingress.some(r => r.protocol === 'tcp' && r.fromPort === 80 && r.toPort === 80 && open(r))
        && g.ingress.filter(open).every(r => r.protocol === 'tcp' && r.fromPort === r.toPort && [80, 443].includes(r.fromPort))),
      solve: m => { m.securityGroups.push({ id: 'sg-web', name: 'web-sg', vpcId: 'vpc-path', ingress: [{ protocol: 'tcp', fromPort: 80, toPort: 80, cidr: '0.0.0.0/0' }], egress: [{ protocol: '-1', fromPort: 0, toPort: 65535, cidr: '0.0.0.0/0' }] }); } },
    { title: 'Webサーバー web を置き、インターネットから届くようにする',
      body: 'web を public-a に置きます。インターネットから届くには、パブリックIPと、OSの待ち受けも必要でした（Theory「Internet Gatewayと『パブリック』の条件」の条件の表）。\n\n1. RESOURCES の **EC2** を押します。public-a に、プライベートIP `10.0.1.10` で作られます。\n2. 名前を `web`、「役割（Role）」を `web` にします。\n3. 「パブリックIP / EIP」に `203.0.113.10` を入れます。\n4. 「OSが待ち受けるポート」を `tcp/80` にします（既定の tcp/8080 から変更）。\n5. 「セキュリティグループ」で `web-sg` にチェックが入っていることを確かめます。\n\n画面下の REACHABILITY ANALYZER で、送信元 `Internet（198.51.100.77）`、宛先 `EC2 web（web）`、プロトコル `TCP`、ポート `80` を選んで **分析** を押します。「到達可能」と出れば完成です。',
      hints: ['「到達不能」なら、止まった行の説明を読みます。パブリックIPがない、待ち受けポートが 8080 のまま、がよくある原因です。', 'web のサブネットが public-a、SGが web-sg になっているかも確かめます。'],
      check: m => webs(m).some(w => tcp(m, CLIENT, to(w), 80).reachable),
      solve: m => { m.instances.push({ id: 'i-web', name: 'web', subnetId: 'subnet-public-a', privateIp: '10.0.1.10', publicIp: '203.0.113.10', securityGroupIds: ['sg-web'], role: 'web', listening: [{ protocol: 'tcp', port: 80 }] }); } },
    { title: '分析の結果で、行きと帰りの判定を読む',
      body: 'いま分析した結果を、Theory「1つの通信を、行きと帰りでたどる」の表と見比べます。「往」が行き、「復」が帰りです。\n\n- 往: Internet → Instance（パブリックIP宛て）→ Internet Gateway（宛先を 10.0.1.10 に変換）→ Network ACL（public-a のインバウンド）→ Security Group（インバウンド）→ Instance（待ち受け）\n- 復: Security Group → Network ACL（public-a のアウトバウンド）→ Route Table（public-rt）→ Internet Gateway\n\n往には Route Table の行がありません。IGWで宛先がプライベートIPに変わった後は、local経路で届くからです。帰りは public-rt の `0.0.0.0/0 → igw-…` でIGWへ向かいます。',
      quiz: { question: '復（帰り）の Security Group の行には、何と表示されていますか？', options: ['アウトバウンドルール「All to 0.0.0.0/0」に一致するので許可します', 'SGはステートフル（行きの通信を覚えている）なので、許可した通信の戻りはアウトバウンドルールに関係なく通します', 'アウトバウンドルールに一致するものがないため、拒否します'], answer: 1, explanation: 'SGは、インバウンドで許可した接続を覚えていて、その返事はアウトバウンドのルールを見ずに通します。一方、すぐ下の Network ACL の行は、ステートレスなので帰りも改めてルールで判定しています。' } },
    { title: 'DB用のプライベートサブネット private-a を作る',
      body: 'db を置く、外から届かない区画を作ります（Theory「プライベートサブネットに置き、SG参照で守る」）。\n\n1. RESOURCES の **Subnet** を押します。CIDR は `10.0.2.0/24` になります。\n2. 名前を `private-a`、AZ を `ap-northeast-1a` にします。\n3. 「ルートテーブル」欄は「メインルートテーブル（明示的な関連付けなし）」のままにします。\n\n見出しの印と、その下の理由を読みましょう。',
      check: m => { const s = subnet(m, PRIVATE); return !!s && !subnetExposure(m, s).public; },
      solve: m => { m.subnets.push({ id: 'subnet-private-a', name: 'private-a', vpcId: 'vpc-path', cidr: PRIVATE, az: 'ap-northeast-1a' }); },
      quiz: { question: 'private-a の見出しの印と、その理由はどれですか？', options: ['Public（VPCにIGWがアタッチされているから）', 'Private（使っているメインルートテーブルに、IGWへの経路がないから）', 'Private（名前に private と付けたから）'], answer: 1, explanation: 'パブリックかどうかを決めるのは、名前でもIGWの有無でもなく、サブネットが使うルートテーブルです。private-a はメインルートテーブル（local経路だけ）を使うので、プライベートサブネットです。メインに 0.0.0.0/0 → IGW を入れなかったので、関連付けをしなくても安全な側に倒れています。' } },
    { title: 'DB用のSG（db-sg）を、web-sg の参照で作る',
      body: 'db に届いてよいのは、web からの5432番（PostgreSQL）だけです。web のIPアドレスではなく、web-sg を送信元に書く **SG参照** で許可します（Theory「プライベートサブネットに置き、SG参照で守る」）。\n\n1. RESOURCES の **Security Group** を押し、名前を `db-sg` にします。\n2. 「インバウンド」の行で、プロトコル `TCP`、開始ポート `5432`、終了ポート `5432`、送信元の種類で `SG: web-sg` を選んで **追加** を押します。\n\nアウトバウンドは「All 0.0.0.0/0」のままにします（後で、OSの更新に使います）。0.0.0.0/0 からのインバウンドは追加しません。',
      hints: ['「送信元の種類」の選択肢に、作ってあるSGが「SG: web-sg」のように並んでいます。選ぶとCIDRの入力欄が消えます。'],
      check: m => {
        const webSgs = new Set(webs(m).flatMap(w => w.securityGroupIds));
        return m.securityGroups.some(g => g.ingress.some(r => r.protocol === 'tcp' && r.fromPort <= 5432 && r.toPort >= 5432 && !!r.sourceSg && webSgs.has(r.sourceSg)) && !g.ingress.some(open));
      },
      solve: m => { m.securityGroups.push({ id: 'sg-db', name: 'db-sg', vpcId: 'vpc-path', ingress: [{ protocol: 'tcp', fromPort: 5432, toPort: 5432, sourceSg: 'sg-web' }], egress: [{ protocol: '-1', fromPort: 0, toPort: 65535, cidr: '0.0.0.0/0' }] }); } },
    { title: 'DBサーバー db を置き、web から届くことを確かめる',
      body: 'db を private-a に置きます。EC2は、いちばん最初のサブネット（public-a）に、最初のSG（web-sg）付きで作られるので、作った後で置き場所とSGを直します。\n\n1. RESOURCES の **EC2** を押します。\n2. 名前を `db`、「役割（Role）」を `db` にします。\n3. 「サブネット」を `private-a` に、「プライベートIP」を `10.0.2.10` にします。\n4. 「パブリックIP / EIP」は空欄のまま（パブリックIPなし）にします。\n5. 「OSが待ち受けるポート」を `tcp/5432` にします。\n6. 「セキュリティグループ」で、`web-sg` のチェックを外し、`db-sg` にチェックを入れます。\n\n分析で、送信元 `EC2 web（web）`、宛先 `EC2 db（db）`、`TCP` `5432` が「到達可能」になれば完成です。',
      hints: ['サブネットを変えた後でプライベートIPを直さないと、「サブネットの範囲外です」という検証エラーが出ます。', 'db-sg のインバウンドの送信元が web-sg（SG参照）になっているか、db に付いているSGに 0.0.0.0/0 からのインバウンドがないかを確かめます。'],
      check: m => dbs(m).some(d => !d.publicIp && placed(m, d) && d.securityGroupIds.length > 0
        && d.securityGroupIds.every(id => !byId(m.securityGroups, id)?.ingress.some(open))
        && webs(m).some(w => tcp(m, to(w), to(d), 5432).reachable)),
      solve: m => { m.instances.push({ id: 'i-db', name: 'db', subnetId: 'subnet-private-a', privateIp: '10.0.2.10', securityGroupIds: ['sg-db'], role: 'db', listening: [{ protocol: 'tcp', port: 5432 }] }); },
      quiz: { question: 'web → db（TCP 5432）の分析結果に、Network ACL の行はいくつありますか？', options: ['1つ（db のサブネットに入るとき）', '2つ（行きで、出るときと入るとき）', '4つ（行きで2つ、帰りで2つ）'], answer: 2, explanation: 'web と db は別のサブネットにいるので、パケットはサブネットの境界を越えます。行きは public-a のアウトバウンドと private-a のインバウンド、帰りは private-a のアウトバウンドと public-a のインバウンドで、NACLが判定します。いまはどちらもデフォルトNACL（すべて許可）なので、4つとも通ります。' } },
    { title: 'NAT Gatewayを置き、db から外へ出られるようにする',
      body: 'db はプライベートサブネットにいるので、OSの更新サーバー（198.51.100.10 の443番）へ出られません。第6章のPATにあたる NAT Gateway を、**パブリックサブネット** に置いて使います（Theory「NAT Gatewayで外へ出し、NACLで守りを重ねる」）。\n\n1. RESOURCES の **NAT Gateway** を押します。「配置サブネット」が `public-a (Public)`、「Elastic IP」が `203.0.113.20` になっていることを確かめ、名前を `nat-a` にします。\n2. RESOURCES の **Route Table** を押し、名前を `private-rt` にします。宛先 `0.0.0.0/0`、ターゲット `NAT nat-a` の経路を追加します。\n3. private-a の「ルートテーブル」欄で `private-rt` を選びます。\n\n分析で、送信元 `EC2 db（db）`、宛先 `Internet（198.51.100.10）`、`TCP` `443` が「到達可能」になり、NAT Gateway の行が出れば完成です。private-a の印は Private のままです。',
      hints: ['NAT Gateway を private-a に置くと、「NAT Gatewayを置いたサブネットがパブリックではありません」で止まります。NAT Gateway自身もIGWへ出るからです。', 'private-rt を作っただけでは使われません。private-a に関連付けます。'],
      check: m => dbOut(m) && dbs(m).every(d => !d.publicIp) && !subnetExposure(m, subnet(m, PRIVATE)!).public,
      solve: m => {
        m.natGateways.push({ id: 'nat-a', name: 'nat-a', subnetId: 'subnet-public-a', publicIp: '203.0.113.20' });
        m.routeTables.push({ id: 'rtb-private', name: 'private-rt', vpcId: 'vpc-path', main: false, routes: [{ destination: '0.0.0.0/0', target: 'nat-a' }] });
        byId(m.subnets, 'subnet-private-a')!.routeTableId = 'rtb-private';
      },
      quiz: { question: 'db → Internet（198.51.100.10）の分析で、NAT Gateway の行に表示された「変換後の送信元」はどれですか？', options: ['10.0.2.10（db のプライベートIPのまま）', 'NAT Gateway の Elastic IP（203.0.113.20）', 'web のパブリックIP（203.0.113.10）'], answer: 1, explanation: 'NAT Gateway は、送信元を自分の Elastic IP に変換してから、public-a の public-rt に従ってIGWへ送ります。更新サーバーから見た相手は 203.0.113.20 で、db のアドレスは見えません。返事は、NAT Gateway が変換の記録を見て db に戻します。' } },
    { title: 'db のサブネットにNACLを付け、行きと帰りを許可する',
      body: '最後に、private-a の境界にもNACLを付けて、守りを2重にします（Theory「NAT Gatewayで外へ出し、NACLで守りを重ねる」）。NACLはステートレスなので、private-a を出入りする2つの通信それぞれについて、**行きと帰りの両方** を許可します。\n\n1. RESOURCES の **Network ACL** を押し、名前を `db-acl` にします。\n2. 次の4つのルールを、ルール番号・方向・プロトコル・開始/終了ポート・CIDR・allow を入れて、1つずつ **追加** します。\n\n```text\n番号  方向  プロトコル  ポート       CIDR          意味\n100   IN    TCP         5432-5432    10.0.1.0/24   web → db の行き\n110   IN    TCP         1024-65535   0.0.0.0/0     更新の帰り\n100   OUT   TCP         1024-65535   10.0.1.0/24   web → db の帰り\n110   OUT   TCP         443-443      0.0.0.0/0     更新の行き\n```\n\n3. **ルールを入れ終えてから**、private-a の「ネットワークACL」欄で `db-acl` を選びます。\n\n新しく作ったNACLは「すべて拒否」から始まるので、ルールが空のまま関連付けると、private-a の通信がすべて止まり、前のステップのチェックが外れます。web → db（5432）と db → Internet（443）が届いたまま、web → db の22番（SSH）が Network ACL で止まれば完成です。',
      hints: ['web → db の22番を分析して「Security Group」で止まるなら、NACLで広く許可しすぎています。インバウンドは 5432 と 1024-65535 だけにします。', 'db → Internet が止まるなら、アウトバウンドの 443 と、インバウンドの 1024-65535（0.0.0.0/0）があるかを確かめます。'],
      check: m => {
        const s = subnet(m, PRIVATE); const acl = s && byId(m.networkAcls, s.naclId);
        return !!acl && !acl.isDefault && webToDb(m) && dbOut(m) && webs(m).length > 0 && dbs(m).length > 0
          && webs(m).every(w => dbs(m).every(d => tcp(m, to(w), to(d), 22).blocked?.component === 'Network ACL'));
      },
      solve: m => {
        const rule = (ruleNumber: number, egress: boolean, fromPort: number, toPort: number, cidr: string) => ({ ruleNumber, egress, protocol: 'tcp' as const, fromPort, toPort, cidr, action: 'allow' as const });
        m.networkAcls.push({ id: 'acl-db', name: 'db-acl', vpcId: 'vpc-path', isDefault: false, entries: [
          rule(100, false, 5432, 5432, PUBLIC), rule(110, false, 1024, 65535, '0.0.0.0/0'),
          rule(100, true, 1024, 65535, PUBLIC), rule(110, true, 443, 443, '0.0.0.0/0'),
        ] });
        byId(m.subnets, 'subnet-private-a')!.naclId = 'acl-db';
      },
      quiz: { question: 'web → db（TCP 5432）を分析し、復（帰り）の Network ACL（db-acl、private-a のアウトバウンド）の行を見てください。どのルールで許可されていますか？', options: ['インバウンドの「TCP 5432 10.0.1.0/24」のルール（行きを許可したルールが、帰りにも使われる）', 'アウトバウンドの「TCP 1024-65535 10.0.1.0/24」のルール（帰りの宛先ポート 50000 を含む）', 'どのルールも使われない（NACLも行きの通信を覚えていて、帰りを通す）'], answer: 1, explanation: 'NACLはステートレスなので、帰りのパケット（10.0.2.10:5432 → 10.0.1.10:50000）も、アウトバウンドのルールで改めて判定されます。宛先ポートは web が選んだエフェメラルポートなので、1024-65535 を許可するルールに一致します。同じ分析の Security Group の行が「ステートフルなので通します」となっているのと比べてみましょう。' } },
  ],
  debrief: 'VPCとサブネットを作り、IGWへの経路でパブリックサブネットを作り、SG・NACL・ルートテーブルの判定を行きと帰りでたどって確かめました。外に出すのは web だけ、db はプライベートサブネットでSG参照とNACLの2重の守り、外へ出るときは NAT Gateway——これがAWSのネットワークの基本形です。次の章では、VGWの先で拠点とつなぐVPNと、経路を伝え合うBGPを扱います。',
});
