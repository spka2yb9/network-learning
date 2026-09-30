import { analyzePath, type AwsEndpoint } from '../aws/analyzer';
import { byId, subnetExposure, subnetRouteTable, validateModel, type AwsModel } from '../aws/model';
import { baseVpc, singleWeb, threeTier } from '../aws/scenarios';
import { TerraformWorkspace } from '../terraform/engine';
import { starterFiles, threeTierFiles } from '../terraform/examples';
import type { AwsLab, CheckResult, Diagnosis, TerraformLab } from './types';

const INTERNET: AwsEndpoint = { kind: 'internet', ip: '198.51.100.77' };
const clone = <T>(v: T) => structuredClone(v);
function awsGrader(model: AwsModel) {
  const results: CheckResult[] = [];
  const check = (label: string, fn: (m: AwsModel) => boolean) => { let pass = false; try { pass = fn(clone(model)); } catch { pass = false; } results.push({ label, pass }); };
  const reach = (label: string, from: AwsEndpoint | ((m: AwsModel) => AwsEndpoint), to: AwsEndpoint | ((m: AwsModel) => AwsEndpoint), port: number, expect = true) =>
    check(label, m => analyzePath(m, typeof from === 'function' ? from(m) : from, typeof to === 'function' ? to(m) : to, 'tcp', port).reachable === expect);
  check('設計の検証エラーがない（CIDR・予約アドレス・AZなど、AWSの制約を満たしている）', m => validateModel(m).length === 0);
  return { check, reach, done: () => results };
}
const awsLayers = (answer: number, explanation: string): Diagnosis => ({ question: '通信を遮断していたのは、どの部品でしたか？', options: ['Route Table', 'Internet Gateway', 'Security Group', 'Network ACL', 'NAT Gateway'], answer, explanation });
const role = (m: AwsModel, r: string) => m.instances.filter(i => i.role === r);

/** Capstone 4 requirements, independent of resource names and addresses. */
export function gradeThreeTier(m: AwsModel): CheckResult[] {
  const g = awsGrader(m);
  const alb = (x: AwsModel) => x.loadBalancers.find(l => l.type === 'application' && l.scheme === 'internet-facing');
  g.check('internet-facing のALBが2つのAZのパブリックサブネットにある', x => { const lb = alb(x); return !!lb && new Set(lb.subnetIds.map(s => byId(x.subnets, s)?.az)).size >= 2 && lb.subnetIds.every(s => subnetExposure(x, byId(x.subnets, s)!).public); });
  g.check('アプリ（Role=app）が2つのAZに1台以上ずつ、パブリックIPなし', x => { const apps = role(x, 'app'); return new Set(apps.map(a => byId(x.subnets, a.subnetId)?.az)).size >= 2 && apps.every(a => !a.publicIp); });
  g.reach('インターネットからALBへ到達できる（HTTPS 443）', INTERNET, x => ({ kind: 'lb', id: alb(x)!.id }), 443);
  g.check('ALBのターゲット（アプリ）がすべて正常（どのAZのアプリも使える）', x => { const r = analyzePath(x, INTERNET, { kind: 'lb', id: alb(x)!.id }, 'tcp', 443); const h = r.hops.find(h => h.component === 'Load Balancer' && h.detail.startsWith('ターゲット')); return !!h && /^ターゲット (\d+)\/\1 /.test(h.detail); });
  g.check('インターネットからアプリ・DBへ直接は到達できない', x => [...role(x, 'app'), ...role(x, 'db')].every(i => !analyzePath(x, INTERNET, { kind: 'instance', id: i.id }, 'tcp', 8080).reachable && !analyzePath(x, INTERNET, { kind: 'instance', id: i.id }, 'tcp', 5432).reachable));
  g.check('アプリからDB（5432）へ到達できる', x => role(x, 'app').every(a => role(x, 'db').every(d => analyzePath(x, { kind: 'instance', id: a.id }, { kind: 'instance', id: d.id }, 'tcp', 5432).reachable)) && role(x, 'db').length > 0);
  g.check('DBにはアプリ以外から届かない（パブリックサブネットに置いた確認用のサーバーからは遮断される）', x => {
    const pub = x.subnets.find(s => subnetExposure(x, s).public)!;
    x.securityGroups.push({ id: 'sg-probe', name: 'probe', vpcId: pub.vpcId, ingress: [], egress: [{ protocol: '-1', fromPort: 0, toPort: 65535, cidr: '0.0.0.0/0' }] });
    x.instances.push({ id: 'i-probe', name: 'probe', subnetId: pub.id, privateIp: pub.cidr.replace(/\d+\/\d+$/, '200'), securityGroupIds: ['sg-probe'], role: 'generic', listening: [] });
    return role(x, 'db').every(d => !analyzePath(x, { kind: 'instance', id: 'i-probe' }, { kind: 'instance', id: d.id }, 'tcp', 5432).reachable);
  });
  g.check('アプリがNAT Gateway経由でインターネットへ出られる（OSの更新・外部API用）', x => role(x, 'app').every(a => { const r = analyzePath(x, { kind: 'instance', id: a.id }, { kind: 'internet', ip: '198.51.100.10' }, 'tcp', 443); return r.reachable && r.hops.some(h => h.component === 'NAT Gateway'); }));
  g.check('DBのサブネットにはインターネットへの経路（0.0.0.0/0）がない', x => role(x, 'db').every(d => { const s = byId(x.subnets, d.subnetId)!; return !subnetRouteTable(x, s)!.routes.some(r => r.destination === '0.0.0.0/0'); }));
  return g.done();
}

export const awsLabs: AwsLab[] = [
  { id: 'aws-01', chapter: 'aws', kind: 'guided', workspace: 'aws', minutes: 15, title: '「パブリックサブネット」を経路で作る', mission: 'web-subnet をパブリックサブネットにして、インターネットからWebサーバー web にHTTP（80番）で接続できるようにします。',
    brief: '**状況**: Webサーバー web（パブリックIP 198.51.100.20）を web-subnet に置きましたが、インターネットから開けません。このVPCには、まだインターネットとの出入口がありません。\n\n**やること**: web-subnet を、インターネットと直接やり取りできる**パブリックサブネット**にします。\n\n**完了の条件**: インターネット → web（HTTP 80）が到達できること、web-subnet がパブリックサブネットになっていること、インターネットからのSSH（22番）は遮断されたままであること。\n\n**まずは**: 画面下の Reachability Analyzer（教育用）で、送信元「Internet」→ 宛先「EC2 web」、TCP 80 を分析し、どこで止まるかを確認します。',
    steps: ['Reachability Analyzer で Internet → EC2 web、TCP 80 を分析し、どこで止まるかを確認します。', '左の「Internet Gateway」ボタンでIGWを作成し、アタッチ先VPCが lab（vpc-main）になっていることを確認します。', 'メインルートテーブル lab-main に、宛先 0.0.0.0/0 → ターゲット IGW（igw-…）の経路を追加します。web-subnet はルートテーブルを明示的に関連付けていないので、メインルートテーブルを使います。', 'もう一度分析し、往（行き）と復（帰り）のすべての判定を読みます。SG（ステートフル：戻りは自動で許可）とNACL（ステートレス：戻りもルールで判定）の違いを確かめます。'],
    hints: ['サブネットの名前に public と付けても、パブリックにはなりません。分析結果で、最初に止まった部品とその理由を読みます。', 'パブリックかどうかは、サブネットが使うルートテーブルに、アタッチ済みのIGWへの経路があるかで決まります。VPCにIGWはありますか？', 'IGWを作ってVPCにアタッチし、lab-main に 0.0.0.0/0 → igw-… を追加します。SSHの条件があるので、web-sg に22番のルールは追加しません。'],
    debrief: 'パブリックサブネットは名前ではなく「アタッチ済みのIGWへの経路があるか」で決まることを確かめました。インスタンスがインターネットと直接通信するには、この経路に加えて、パブリックIP（またはElastic IP）と、SG・NACLの許可が必要です。今回は簡単のためメインルートテーブルに経路を追加しましたが、実務ではメインに 0.0.0.0/0 → IGW を入れると、関連付けを忘れた新しいサブネットまでパブリックになります。公開用のルートテーブルを別に作り、明示的に関連付けるのが安全です。',
    build: () => { const m = singleWeb(); m.instances[0].listening.push({ protocol: 'tcp', port: 22 }); return m; }, solve: m => { m.internetGateways.push({ id: 'igw-main', name: 'lab-igw', vpcId: 'vpc-main' }); m.routeTables[0].routes.push({ destination: '0.0.0.0/0', target: 'igw-main' }); },
    grade: model => { const g = awsGrader(model); g.reach('インターネットから web にHTTP（80）で到達できる', INTERNET, { kind: 'instance', id: 'i-web' }, 80); g.check('web-subnet がパブリックサブネットになっている（アタッチ済みIGWへの経路がある）', m => subnetExposure(m, byId(m.subnets, 'subnet-web')!).public); g.reach('インターネットからのSSH（22）は遮断されたまま', INTERNET, { kind: 'instance', id: 'i-web' }, 22, false); return g.done(); } },
  { id: 'aws-02', chapter: 'aws', kind: 'guided', workspace: 'aws', minutes: 20, title: 'プライベートサブネットから外へ', mission: 'パブリックIPを持たないアプリサーバー app-a・app-c が、NAT Gateway経由でインターネット（198.51.100.10:443）へ通信できるようにします。',
    brief: '**状況**: アプリサーバー app-a・app-c は、プライベートサブネット（app-a / app-c）にあり、パブリックIPを持ちません。OSの更新や外部APIの呼び出しのために、インターネットへ出られるようにします。\n\n**やること**: パブリックIPを付けずに外へ出る出口として、**NAT Gateway**（06章のPATにあたる部品）を用意し、経路を向けます。\n\n**完了の条件**: app-a・app-c → インターネット（443）が到達できること、アプリにパブリックIPを付けていないこと、DB（db-primary）はインターネットへ出られないままであること。\n\n**まずは**: Reachability Analyzerで、送信元「EC2 app-a」→ 宛先「Internet（198.51.100.10）」、TCP 443 を分析します。',
    steps: ['EC2 app-a → Internet（198.51.100.10）、TCP 443 を分析します。app-a のサブネットが使う private-rt に、インターネット宛ての経路がないことを確認します。', '左の「NAT Gateway」ボタンで作成し、配置サブネットがパブリックサブネット public-a になっていること、Elastic IP が割り当てられていることを確認します（アドレスは既定値のままでかまいません）。', 'private-rt に、宛先 0.0.0.0/0 → ターゲット NAT Gateway（nat-…）の経路を追加します。', 'もう一度分析し、NAT Gatewayで送信元が Elastic IP に変換されることを確かめます。DB（db-primary）→ インターネットが遮断されたままであることも確認します。'],
    hints: ['app-a のサブネットが使うルートテーブル（private-rt）に、インターネット宛ての経路があるかを確認します。', 'NAT Gateway自身も、IGWを通ってインターネットへ出ます。IGWへ出られるのは、どの種類のサブネットでしたか？', 'NAT Gatewayはパブリックサブネット（public-a）に置き、private-rt に 0.0.0.0/0 → NAT Gateway を追加します。DBのサブネットは private-rt を使っていないので、DBは外に出られないままです。'],
    debrief: 'プライベートサブネットのサーバーは、パブリックサブネットに置いたNAT Gatewayを通って外へ出られることを確かめました。NAT Gatewayは内側から始めた通信の戻りだけを通すので、インターネット側からアプリへ新しく接続されることはありません。実務では、AZの障害に備えてAZごとにNAT Gatewayを置き、各AZのプライベートサブネットを同じAZのNAT Gatewayへ向けます。NAT Gatewayは時間と処理したデータ量で料金がかかるため、S3などへの通信はGateway型VPCエンドポイントで節約できます。',
    build: () => { const m = threeTier(); m.natGateways = []; m.routeTables.find(r => r.id === 'rtb-private')!.routes = []; return m; },
    solve: m => { m.natGateways.push({ id: 'nat-a', name: 'nat-a', subnetId: 'subnet-public-a', publicIp: '203.0.113.10' }); m.routeTables.find(r => r.id === 'rtb-private')!.routes.push({ destination: '0.0.0.0/0', target: 'nat-a' }); },
    grade: model => { const g = awsGrader(model); g.reach('app-a からインターネット（443）へ到達できる', { kind: 'instance', id: 'i-app-a' }, { kind: 'internet', ip: '198.51.100.10' }, 443); g.reach('app-c からインターネット（443）へ到達できる', { kind: 'instance', id: 'i-app-c' }, { kind: 'internet', ip: '198.51.100.10' }, 443);
      g.check('アプリにパブリックIPを付けていない', m => role(m, 'app').every(i => !i.publicIp)); g.reach('DB（db-primary）はインターネットへ出られないまま', { kind: 'instance', id: 'i-db-a' }, { kind: 'internet', ip: '198.51.100.10' }, 443, false); return g.done(); } },
  { id: 'aws-03', chapter: 'aws', kind: 'mastery', workspace: 'aws', minutes: 30, title: 'VPCピアリングで共有サービスへ', mission: 'prod VPC のアプリサーバーから、shared VPC の共通API shared-api（10.1.1.10:443）へ、必要な範囲だけ通信できるようにします。',
    brief: '**状況**: 社内共通のAPI shared-api が、別のVPC shared（10.1.0.0/16）にあります。prod VPC（10.0.0.0/16）のアプリサーバー app-a・app-c から、このAPIを呼び出したいと頼まれました。\n\n**やること**: 2つのVPCを1対1でつなぐ **VPC Peering**（VPCピアリング）を作り、両方のVPCのルートテーブルに経路を追加します。\n\n**完了の条件**: app-a・app-c → shared-api（443）が到達できること、ピアリングへ 0.0.0.0/0 を向けていないこと（経路は相手VPCの範囲だけにする）、shared-api → DB（5432）は到達できないままであること。\n\n**まずは**: Reachability Analyzerで、EC2 app-a → EC2 shared-api、TCP 443 を分析します。',
    hints: ['app-a のサブネットが使うルートテーブル（private-rt）に、宛先 10.1.1.10 に一致する経路はありますか？ local 経路が届くのは同じVPCの中だけです。', 'ピアリングは、状態が active（承認済み）であることに加えて、経路が必要です。行きの経路だけでなく、帰りの経路（shared 側のルートテーブル）も確認します。', 'private-rt に 10.1.0.0/16 → pcx-…、shared-main に 10.0.0.0/16 → pcx-… を追加します。'],
    debrief: 'VPC Peeringは作成して active にするだけでは通信できず、両側のルートテーブルに相手のCIDR宛ての経路が必要なことを確かめました。経路を相手VPCの範囲だけに絞り、SGで相手を限定すると、つながる範囲を必要最小限にできます。Peeringは推移的ではない（A–B、B–C をつないでも A→C は通れない）ため、実務で多数のVPCをつなぐ場合は Transit Gateway などを検討します。',
    build: () => { const m = threeTier(); m.vpcs.push({ id: 'vpc-shared', name: 'shared', cidr: '10.1.0.0/16' }); m.routeTables.push({ id: 'rtb-shared', name: 'shared-main', vpcId: 'vpc-shared', main: true, routes: [] });
      m.networkAcls.push({ id: 'acl-shared', name: 'shared-default-acl', vpcId: 'vpc-shared', isDefault: true, entries: m.networkAcls[0].entries.map(e => ({ ...e })) });
      m.subnets.push({ id: 'subnet-shared', name: 'shared-a', vpcId: 'vpc-shared', cidr: '10.1.1.0/24', az: 'ap-northeast-1a' });
      m.securityGroups.push({ id: 'sg-shared', name: 'shared-api-sg', vpcId: 'vpc-shared', ingress: [{ protocol: 'tcp', fromPort: 443, toPort: 443, cidr: '10.0.0.0/16' }], egress: [] });
      m.instances.push({ id: 'i-shared', name: 'shared-api', subnetId: 'subnet-shared', privateIp: '10.1.1.10', securityGroupIds: ['sg-shared'], role: 'app', listening: [{ protocol: 'tcp', port: 443 }] }); return m; },
    solve: m => { m.peerings.push({ id: 'pcx-shared', name: 'prod-shared', requesterVpcId: 'vpc-main', accepterVpcId: 'vpc-shared', status: 'active' }); m.routeTables.find(r => r.id === 'rtb-private')!.routes.push({ destination: '10.1.0.0/16', target: 'pcx-shared' }); m.routeTables.find(r => r.id === 'rtb-shared')!.routes.push({ destination: '10.0.0.0/16', target: 'pcx-shared' }); },
    grade: model => { const g = awsGrader(model); g.reach('app-a から shared-api（443）へ到達できる', { kind: 'instance', id: 'i-app-a' }, { kind: 'instance', id: 'i-shared' }, 443); g.reach('app-c から shared-api（443）へ到達できる', { kind: 'instance', id: 'i-app-c' }, { kind: 'instance', id: 'i-shared' }, 443);
      g.check('ピアリングへ 0.0.0.0/0 の経路を向けていない', m => m.routeTables.every(rt => rt.routes.every(r => !r.target.startsWith('pcx-') || r.destination !== '0.0.0.0/0')));
      g.reach('shared-api から DB（5432）へは到達できないまま', { kind: 'instance', id: 'i-shared' }, { kind: 'instance', id: 'i-db-a' }, 5432, false); return g.done(); } },
  { id: 'aws-ts-01', chapter: 'aws', kind: 'troubleshooting', workspace: 'aws', minutes: 10, title: '公開したはずのWebサイト', mission: 'インターネットから web-alb（HTTPS 443）に接続できない原因を見つけて、直してください。',
    brief: '**状況**: Webサイトを公開するため、インターネット向けのロードバランサー（ALB）web-alb を、2つのAZのサブネットに置きました。ところが、インターネットから接続できません。\n\n**やること**: 原因を突き止めて直し、インターネット → web-alb（443）が届くようにします。\n\n**完了の条件**: インターネット → web-alb（443）が到達でき、設計の検証エラーがないこと。直せたら、通信を遮断していた部品を答えます。\n\n**まずは**: Reachability Analyzerで、Internet → LB web-alb、TCP 443 を分析し、最初に止まった部品と理由を読みます。',
    hints: ['分析結果で、最初に遮断された部品と、その理由の文を読みます。', 'インターネット向けのALBは、パブリックサブネットに置く必要があります。ALBのサブネット（public-a / public-c）がパブリックかどうかは、何で決まりましたか？', 'public-a・public-c が使うルートテーブル（public-rt）に、インターネット宛て（0.0.0.0/0）の経路があるかを確認します。'],
    debrief: 'サブネットがパブリックかどうかは、ルートテーブルの経路で決まることを確かめました。IGWを作ってVPCにアタッチしただけでは、どのサブネットもパブリックになりません。実務では、構成を変えたら到達性を確かめ（AWSのReachability Analyzerなど）、公開用のサブネットのルートテーブルに 0.0.0.0/0 → IGW があるかを最初に確認します。',
    build: () => threeTier(false), solve: m => { m.routeTables.find(r => r.id === 'rtb-public')!.routes.push({ destination: '0.0.0.0/0', target: 'igw-main' }); },
    grade: model => { const g = awsGrader(model); g.reach('インターネットから web-alb（443）へ到達できる', INTERNET, { kind: 'lb', id: 'alb-web' }, 443); return g.done(); }, diagnosis: awsLayers(0, 'public-rt にインターネット宛ての経路（0.0.0.0/0 → igw-main）がなく、ALBを置いたサブネット public-a・public-c がパブリックサブネットになっていませんでした。IGWがアタッチされていても、そこへ向かう経路がなければ使われません。') },
  { id: 'aws-ts-02', chapter: 'aws', kind: 'troubleshooting', workspace: 'aws', minutes: 10, title: '504 Gateway Timeout', mission: 'web-alb がエラー（504 Gateway Timeout）を返す原因を見つけて、直してください。',
    brief: '**状況**: インターネットから web-alb には接続できますが、ブラウザには「504 Gateway Timeout」（ロードバランサーが、振り分け先のサーバーとの接続を時間内に確立できなかったときのエラー）が表示されます。web-alb の振り分け先（ターゲット）である app-a・app-c は、すべて異常と判定されています。\n\n**やること**: 原因を突き止めて直し、インターネット → web-alb（443）の通信がアプリまで届くようにします。\n\n**完了の条件**: インターネット → web-alb（443）が到達できること。ただし、app-sg を 0.0.0.0/0 に開放する直し方は認めません（必要な相手だけを許可します）。直せたら、通信を遮断していた部品を答えます。\n\n**まずは**: Internet → LB web-alb、TCP 443 を分析し、ターゲットごとの判定を読みます。',
    hints: ['分析結果の、ターゲットごとの判定（[→ app-a] などが付いた行）を読みます。ALBからターゲットへの通信は、クライアントとは別の、ALBが自分から張る新しい接続です。', 'ALBからアプリへの接続（TCP 8080）を拒否しているのは、どの部品ですか？ そのルールが「誰から」の通信を許可しているかを確認します。', 'app-sg のインバウンドルール（TCP 8080）の送信元が、ALBに付いているSG（alb-sg）になっているかを確認します。'],
    debrief: 'ALBはクライアントの接続をいったん受け止め、ターゲットへは自分から新しい接続を張ります。そのため、ターゲットのSGでは「ALBからの通信」を許可します。送信元にSGを指定する（SG参照）と、ALBのIPアドレスが変わってもルールを直す必要がありません。実務では、ロードバランサーが502や504を返したら、まずターゲットのヘルスチェックの状態と、ターゲットのSGがロードバランサーからの通信を許可しているかを確認します。',
    build: () => { const m = threeTier(); m.securityGroups.find(s => s.id === 'sg-app')!.ingress[0].sourceSg = 'sg-db'; return m; }, solve: m => { m.securityGroups.find(s => s.id === 'sg-app')!.ingress[0].sourceSg = 'sg-alb'; },
    grade: model => { const g = awsGrader(model); g.reach('インターネットから web-alb（443）へ到達できる', INTERNET, { kind: 'lb', id: 'alb-web' }, 443); g.check('app-sg のインバウンドを 0.0.0.0/0 に開放していない', m => !m.securityGroups.find(s => s.id === 'sg-app')!.ingress.some(r => r.cidr === '0.0.0.0/0')); return g.done(); }, diagnosis: awsLayers(2, 'app-sg のインバウンド（TCP 8080）の送信元が db-sg になっていて、ALB（alb-sg）からの接続が許可されていませんでした。送信元を alb-sg にすると、ALBからの通信だけを許可できます。') },
  { id: 'aws-ts-03', chapter: 'aws', kind: 'troubleshooting', workspace: 'aws', minutes: 15, title: '行きは通るのに', mission: 'アプリ用のNACLを追加してから表示されなくなったWebサイトを、そのNACLを使ったまま直してください。',
    brief: '**状況**: セキュリティ強化のため、アプリ用のサブネット（app-a・app-c）に、カスタムのネットワークACL app-acl（acl-app）を作って関連付けました。その後から、インターネットからWebサイト（web-alb）が表示されません。\n\n**やること**: 原因を突き止めて直し、インターネット → web-alb（443）の通信がアプリまで届くようにします。\n\n**完了の条件**: インターネット → web-alb（443）が到達できること、アプリのサブネットは app-acl に関連付けたままであること（NACLを外したり、デフォルトのNACLに戻したりする直し方は認めません）。直せたら、通信を遮断していた部品を答えます。\n\n**まずは**: Internet → LB web-alb、TCP 443 を分析し、止まった行を読みます。',
    hints: ['分析結果で、遮断された行が「往」（行き）と「復」（帰り）のどちらかを確認します。', '行きで許可された通信の戻りは、SGとNACLで扱いが違います。app-acl のインバウンドとアウトバウンドのルールを見比べます。', 'app-acl のアウトバウンドに、ALBへの戻りの通信（宛先はエフェメラルポート。この分析では50000）を許可するルールはありますか？ 1024〜65535 を許可するのが一般的です。'],
    debrief: 'NACLはステートレスで、戻りの通信も逆方向のルールで許可が必要なことを確かめました。戻りの宛先ポートは、接続を始めた側が選ぶエフェメラルポート（一時的に選ばれる送信元ポート）です。範囲はOSやサービスによって違うため、1024〜65535 を許可するのが一般的です。実務では、カスタムNACLを作るときにインバウンドとアウトバウンドを必ず対で設計し、変更後は行きと帰りの両方の到達性を確認します。',
    build: () => { const m = threeTier(); m.networkAcls.push({ id: 'acl-app', name: 'app-acl', vpcId: 'vpc-main', isDefault: false, entries: [{ ruleNumber: 100, egress: false, protocol: 'tcp', fromPort: 8080, toPort: 8080, cidr: '10.0.0.0/16', action: 'allow' }, { ruleNumber: 100, egress: true, protocol: 'tcp', fromPort: 443, toPort: 443, cidr: '0.0.0.0/0', action: 'allow' }] });
      for (const s of m.subnets.filter(x => x.id.startsWith('subnet-app'))) s.naclId = 'acl-app'; return m; },
    solve: m => { m.networkAcls.find(a => a.id === 'acl-app')!.entries.push({ ruleNumber: 110, egress: true, protocol: 'tcp', fromPort: 1024, toPort: 65535, cidr: '10.0.0.0/16', action: 'allow' }); },
    grade: model => { const g = awsGrader(model); g.reach('インターネットから web-alb（443）へ到達できる', INTERNET, { kind: 'lb', id: 'alb-web' }, 443); g.check('アプリのサブネットは app-acl に関連付けたまま（NACLを外さずに直している）', m => m.subnets.filter(s => s.id.startsWith('subnet-app')).every(s => s.naclId === 'acl-app'));
      g.check('app-acl に「すべて許可」のルールを足していない（NACLを実質的に無効にしていない）', m => m.networkAcls.find(a => a.id === 'acl-app')!.entries.every(e => !(e.action === 'allow' && e.cidr === '0.0.0.0/0' && (e.protocol === '-1' || (e.fromPort <= 1 && e.toPort >= 65535))))); return g.done(); },
    diagnosis: awsLayers(3, 'app-acl のアウトバウンドに、ALBへの戻りの通信（宛先はエフェメラルポート）を許可するルールがありませんでした。NACLはステートレスなので、インバウンドで8080を許可しても、戻りは改めてアウトバウンドのルールで判定されます。') },
  { id: 'aws-ts-04', chapter: 'aws', kind: 'troubleshooting', workspace: 'aws', minutes: 10, title: '経路はあるのに', mission: 'ルートテーブルに 0.0.0.0/0 → igw-main があるのに、インターネットから web-alb（443）に接続できない原因を見つけて、直してください。',
    brief: '**状況**: インターネットから web-alb（443）に接続できなくなりました。public-rt を見ると、0.0.0.0/0 → igw-main の経路はそのまま残っています。\n\n**やること**: 原因を突き止めて直し、インターネット → web-alb（443）が届くようにします。\n\n**完了の条件**: インターネット → web-alb（443）が到達でき、設計の検証エラーがないこと。直せたら、通信を遮断していた部品を答えます。\n\n**まずは**: Internet → LB web-alb、TCP 443 を分析し、止まった部品と理由を読みます。',
    hints: ['分析結果で最初に遮断された部品と、その理由を読みます。経路が「ある」ことと、経路が「使える」ことは別です。', '経路のターゲット igw-main そのものの設定（右のプロパティ）を開いて確認します。', 'igw-main のアタッチ先VPCが prod（vpc-main）になっているかを確認します。'],
    debrief: 'ルートテーブルの経路が正しく見えても、ターゲットの部品が使える状態でなければ通信できないことを確かめました。実際のAWSでも、ターゲットが使えなくなった経路は、状態が「blackhole」と表示されます。経路だけでなく、経路の先の部品の状態まで確認する習慣をつけましょう。',
    build: () => { const m = threeTier(); m.internetGateways[0].vpcId = undefined; return m; }, solve: m => { m.internetGateways[0].vpcId = 'vpc-main'; },
    grade: model => { const g = awsGrader(model); g.reach('インターネットから web-alb（443）へ到達できる', INTERNET, { kind: 'lb', id: 'alb-web' }, 443); return g.done(); }, diagnosis: awsLayers(1, 'igw-main がVPCからデタッチ（切り離し）されていました。経路は残っていても行き先のIGWが使えないため、行き先のない「ブラックホール」の経路になっていました。') },
  { id: 'aws-ts-05', chapter: 'aws', kind: 'troubleshooting', workspace: 'aws', minutes: 10, title: 'NATが外に出られない', mission: 'アプリサーバー app-a からOSの更新（インターネットへのHTTPS）ができない原因を見つけて、直してください。',
    brief: '**状況**: アプリサーバー app-a から、OSの更新（インターネット上の更新サーバーへの HTTPS 443）ができません。app-a のサブネットが使う private-rt には、0.0.0.0/0 → nat-a の経路があります。\n\n**やること**: 原因を突き止めて直し、app-a → インターネット（198.51.100.10:443）が届くようにします。\n\n**完了の条件**: app-a → インターネット（443）が到達でき、設計の検証エラーがないこと。直せたら、通信を遮断していた部品を答えます。\n\n**まずは**: EC2 app-a → Internet（198.51.100.10）、TCP 443 を分析します。',
    hints: ['分析結果で、どの部品のどの判定で止まったかを読みます。', 'NAT Gatewayは、変換した通信を、自分が置かれたサブネットのルートテーブルに従って送り出します。nat-a を置いたサブネットから、IGWへ出られますか？', 'nat-a の配置サブネットが、パブリックサブネット（public-a など）になっているかを確認します。'],
    debrief: 'NAT Gatewayは、プライベートサブネットのサーバーの代わりにインターネットへ出る部品です。NAT Gateway自身もIGWへ送る必要があるため、0.0.0.0/0 → IGW の経路があるパブリックサブネットに置きます。実際のAWSでは、NAT Gatewayの配置サブネットは後から変更できません。パブリックサブネットに作り直し、プライベート側のルートテーブルのターゲットを付け替えます。',
    build: () => { const m = threeTier(); m.natGateways[0].subnetId = 'subnet-app-a'; return m; }, solve: m => { m.natGateways[0].subnetId = 'subnet-public-a'; },
    grade: model => { const g = awsGrader(model); g.reach('app-a からインターネット（443）へ到達できる', { kind: 'instance', id: 'i-app-a' }, { kind: 'internet', ip: '198.51.100.10' }, 443);
      g.check('app-a はパブリックIPを持たず、NAT Gateway 経由で外へ出ている', m => !byId(m.instances, 'i-app-a')!.publicIp && analyzePath(m, { kind: 'instance', id: 'i-app-a' }, { kind: 'internet', ip: '198.51.100.10' }, 'tcp', 443).hops.some(h => h.component === 'NAT Gateway')); return g.done(); }, diagnosis: awsLayers(4, 'nat-a がプライベートサブネット app-a に置かれていて、NAT Gateway自身がIGWへ出られませんでした。NAT Gatewayはパブリックサブネットに置きます。') },
  { id: 'capstone-4', chapter: 'capstone', kind: 'capstone', workspace: 'aws', minutes: 120, title: 'Capstone 4: AWSネットワークを設計する', mission: '2つのAZにまたがる3層構成（ALB・アプリ・DB）を、必要な通信だけが通るように設計します。',
    brief: '**状況**: 新しいWebサービスを、VPC 10.0.0.0/16（prod）の上に作ります。今あるのは、VPCとメインルートテーブル、デフォルトのNACLとSGだけです。\n\n**要件**\n\n- 2つのAZそれぞれに、パブリック / アプリ / DB のサブネットを作る\n- インターネット → internet-facing（インターネット向け）のALB（HTTPS 443）→ アプリ（Role=app、8080）。アプリはAZごとに1台\n- アプリ → DB（Role=db、5432）。DBへはアプリのSGからだけ届くようにする\n- アプリはパブリックIPを持たず、NAT Gateway経由でインターネットへ出られる\n- DBのサブネットには、インターネットへの経路（0.0.0.0/0）を作らない\n- インターネットからアプリ・DBへ直接は届かない\n\nEC2の「役割（Role）」で app / db を選び、「待ち受け」にアプリは tcp/8080、DBは tcp/5432 を設定します。\n\n**完了の条件**: 「到達度を確認」で、上の要件を最終的な構成から判定します。リソースの名前やアドレスは自由です。\n\n**提出物（自己評価）**: 構成図、SG / NACLの一覧とその理由、1つのAZが止まったときに何が残るか、NAT Gatewayを1つにした場合のリスクとコスト。\n\n**まずは**: パブリックサブネットとIGWから作り、インターネット → ALB が届くことを分析で確かめてから、内側（アプリ → DB）へ広げていきます。',
    hints: ['ALBを置くサブネットは、パブリック（アタッチ済みIGWへの経路がある）である必要があります。サブネットごとに、どのルートテーブルを使うかを先に決めておきます。', 'SGの送信元に別のSGを指定する（SG参照）と、「ALBからだけ」「アプリからだけ」を、IPアドレスに頼らずに書けます。', 'NAT Gatewayをパブリックサブネットに置き、アプリのサブネットのルートテーブルを 0.0.0.0/0 → NAT Gateway に向けます。DBのサブネットはメインルートテーブル（local のみ）のままでかまいません。NAT Gatewayを片方のAZだけに置くと、そのAZの障害で両方のアプリが外へ出られなくなります（今回の判定ではどちらでも可）。'],
    debrief: '3層構成を、経路（どこへ出られるか）とSG参照（誰から受けるか）の組み合わせで作りました。実務では、構成図とSGの一覧に「なぜその通信が必要か」を添えてレビューします。AZごとにNAT Gatewayを置くか、1つにして費用を抑えるかは、可用性とコストのトレードオフとして判断します。',
    build: () => baseVpc('prod'), solve: m => { const ref = threeTier(); Object.assign(m, clone(ref)); }, grade: gradeThreeTier },
];

// ---------------------------------------------------------------- Terraform
function tfGrader(ws: TerraformWorkspace) {
  const results: CheckResult[] = [];
  const check = (label: string, fn: (w: TerraformWorkspace) => boolean) => { let pass = false; try { pass = fn(new TerraformWorkspace(ws.snapshot())); } catch { pass = false; } results.push({ label, pass }); };
  check('terraform plan が「No changes」（コードと実物が一致し、適用済み）', w => w.run('plan').includes('No changes'));
  return { check, done: () => results };
}
const code = (ws: TerraformWorkspace) => Object.entries(ws.files).filter(([f]) => f.endsWith('.tf')).map(([, s]) => s).join('\n');
const applied = (files: Record<string, string>, mutate?: (w: TerraformWorkspace) => void) => { const w = new TerraformWorkspace({ files }); w.run('init'); w.run('apply -auto-approve'); mutate?.(w); w.pending = undefined; return w.snapshot(); };
const publicSubnetFiles = `resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
}

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, 1)
  availability_zone       = "ap-northeast-1a"
  map_public_ip_on_launch = true
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
export const terraformLabs: TerraformLab[] = [
  { id: 'tf-01', chapter: 'terraform', kind: 'guided', workspace: 'terraform', minutes: 25, title: 'VPCをコードで作る', mission: 'Terraformのコードで、VPCにパブリックサブネット・Internet Gateway・ルートテーブルを追加し、apply で作成します。',
    brief: '**状況**: 画面から手作業で作っていたネットワークを、Terraformのコードで管理することになりました。main.tf には、VPC（aws_vpc.main）だけが書かれています。\n\n**やること**: 新しいファイル（例: network.tf）に、Internet Gateway・パブリックサブネット・ルートテーブル・その関連付けを書き、apply で作成します。\n\n**完了の条件**: パブリックサブネットが作成されていること、VPCが1つだけであること、terraform plan が「No changes」（コードと実物が一致）になること。\n\n**まずは**: terraform init と terraform plan を実行し、VPCが作成予定になっていることを確認します。',
    steps: ['terraform init → terraform plan を実行し、作成されるリソースと、作るまで値が決まらない項目 (known after apply) を確認します。', 'network.tf を作り、aws_internet_gateway / aws_subnet / aws_route_table / aws_route_table_association を書きます。', 'terraform fmt（書式を整える）→ terraform validate（構文と参照を確認）→ terraform plan を実行し、参照している順（依存関係の順）に作られることを確認します。', 'terraform apply を実行します。右の構成図に反映され、サブネットがパブリックになったことを確認します。', 'もう一度 plan を実行し、「No changes」と表示されることを確認します。'],
    hints: ['どのリソースがどれを参照するかを考えます。サブネットとIGWはVPCに、ルートテーブルはVPCとIGWに、関連付けはサブネットとルートテーブルにつながります。', '参照（aws_vpc.main.id など）を書くと、それが暗黙の依存関係になり、Terraformが作る順番を決めます。サブネットのアドレスは cidrsubnet(var.vpc_cidr, 8, 1) で 10.0.1.0/24 になります。', 'aws_route_table の route ブロックに cidr_block = "0.0.0.0/0" と gateway_id = aws_internet_gateway.main.id を書き、aws_route_table_association でサブネットに関連付けます。関連付けを忘れると、サブネットはメインルートテーブルを使うので、プライベートのままです。'],
    debrief: 'リソースどうしの参照が依存関係になり、Terraformが作成の順番を決めることを確かめました。apply の前に plan で「何が作られるか」を読み、apply の後にもう一度 plan して「No changes」になることを確かめるのが、実務での基本の流れです。',
    build: () => ({ files: starterFiles() }), solve: w => { w.files['network.tf'] = publicSubnetFiles; w.run('init'); w.run('apply -auto-approve'); },
    grade: ws => { const g = tfGrader(ws); g.check('パブリックサブネットが作成されている', w => { const m = w.awsModel(); return m.subnets.some(s => subnetExposure(m, s).public); }); g.check('VPCが1つだけ（作り直しで増やしていない）', w => w.awsModel().vpcs.length === 1); return g.done(); } },
  { id: 'tf-02', chapter: 'terraform', kind: 'challenge', workspace: 'terraform', minutes: 30, title: 'count と cidrsubnet で繰り返しを書く', mission: '2つのAZに、パブリックサブネット2つとプライベートサブネット2つを、count と変数を使って作ります。',
    brief: '**状況**: 同じ形のサブネットをAZごとに1つずつ書くと、コードが長くなり、書き間違いも起きやすくなります。1つのブロックで繰り返しを書けるようにします。\n\n**作るもの**: 2つのAZにまたがる、パブリックサブネット2つとプライベートサブネット2つ。\n\n**完了の条件**\n\n- サブネットが4つ以上あり、2つのAZにまたがっている\n- パブリック（IGWへの経路がある）が2つ以上、プライベートが2つ以上\n- count と cidrsubnet を使っている\n- VPCのCIDRを変数（var.…）で渡している\n- terraform plan が「No changes」\n\n**まずは**: init → plan を実行してから、サブネットの resource ブロックに count を付けるところから書きます。',
    hints: ['AZの名前は、data "aws_availability_zones" "available" {} の names から取れます。names[count.index] のように、番号でAZを選べます。', 'cidrsubnet(var.vpc_cidr, 8, count.index + 1) のように count.index を netnum（範囲の番号）に使うと、重ならないアドレスを計算できます。パブリックとプライベートで番号の始まりを変えます（例: +1 と +11）。', 'パブリック側は、0.0.0.0/0 → IGW のルートテーブルに aws_route_table_association で関連付けます（これも count で2つ）。プライベート側は、関連付けなければメインルートテーブル（local のみ）を使います。'],
    debrief: 'count と cidrsubnet で、同じ形のリソースを番号から計算して作れることを確かめました。AZの数やアドレスの割り当てを変数や式にしておくと、環境ごとの違いを小さく保てます。実務では、count のリストの途中を削除すると後ろの番号がずれて作り直しになることがあるため、キーで管理できる for_each もよく使います。',
    build: () => ({ files: starterFiles() }), solve: w => { const f = threeTierFiles(); w.files['network.tf'] = f['network.tf']; w.run('init'); w.run('apply -auto-approve'); },
    grade: ws => { const g = tfGrader(ws);
      g.check('サブネットが4つ以上、2つのAZにまたがる', w => { const m = w.awsModel(); return m.subnets.length >= 4 && new Set(m.subnets.map(s => s.az)).size >= 2; });
      g.check('パブリックサブネット2つ以上・プライベートサブネット2つ以上', w => { const m = w.awsModel(); const pub = m.subnets.filter(s => subnetExposure(m, s).public).length; return pub >= 2 && m.subnets.length - pub >= 2; });
      g.check('count と cidrsubnet を使っている', w => /\bcount\s*=/.test(code(w)) && /cidrsubnet\(/.test(code(w)));
      g.check('VPCのCIDRを変数で渡している', w => /cidr_block\s*=\s*var\./.test(code(w)));
      return g.done(); } },
  { id: 'tf-03', chapter: 'terraform', kind: 'guided', workspace: 'terraform', minutes: 20, title: '手作業のリソースを取り込む（import）', mission: 'AWSのコンソール（管理画面）で手作業で作られた VPC vpc-0legacy01（10.50.0.0/16）を、作り直さずにTerraformの管理下に入れます。',
    brief: '**状況**: 以前、誰かがコンソールから VPC vpc-0legacy01 を手作業で作りました。Terraformの state（コードと実物の対応の記録）には載っていないので、Terraformはこの VPC を管理していません。\n\n**やること**: この VPC を表す resource ブロックを書き、terraform import で state に取り込みます。\n\n**完了の条件**: vpc-0legacy01 が state で管理されていること、作り直していない（IDが変わっていない）こと、terraform plan が「No changes」になること。\n\n**まずは**: 右の構成図で legacy VPC を確認し、terraform state list で、まだ管理下にないことを確かめます。',
    steps: ['右の構成図で legacy VPC を確認します（Terraformの state にはありません）。', '新しいファイル legacy.tf に resource "aws_vpc" "legacy" { cidr_block = "10.50.0.0/16" ... } を書きます。タグ（tags）も実物に合わせます。', 'terraform import aws_vpc.legacy vpc-0legacy01 を実行し、コードのアドレス（aws_vpc.legacy）と実物のIDを state で結び付けます。', 'terraform plan で差分がないことを確認します。差分がある場合は、コードを実物に合わせるのか、実物をコードに合わせるのかを判断します。'],
    hints: ['import は state に書き込むだけで、コードは作りません。resource ブロックは先に自分で書きます。', 'import 後の plan で差分が出たら、その行がコードと実物で違う設定です。タグ Name = "legacy" が実物に付いています。', '今回は実物のほうが正しいので、コードを実物に合わせます。tags = { Name = "legacy" } を書き足し、plan が「No changes」になるまで繰り返します。'],
    debrief: 'terraform import は、既存の実物とコードのアドレスを state で結び付けるだけで、コードは自分で書く必要があることを確かめました。取り込んだ後は、plan が「No changes」になるまでコードを実物に合わせるのが基本です。Terraform 1.5 以降では、コードに import ブロックを書き、レビューを通してから取り込む方法も使えます（このシミュレータは未対応）。',
    build: () => { const w = new TerraformWorkspace({ files: starterFiles() }); w.consoleChange(c => { c.resources['vpc-0legacy01'] = { id: 'vpc-0legacy01', type: 'aws_vpc', origin: 'console', attributes: { id: 'vpc-0legacy01', cidr_block: '10.50.0.0/16', enable_dns_support: true, enable_dns_hostnames: false, tags: { Name: 'legacy' }, arn: 'arn:aws:ec2:ap-northeast-1:123456789012:vpc/vpc-0legacy01', main_route_table_id: 'rtb-0legacy01', default_network_acl_id: 'acl-0legacy01', default_security_group_id: 'sg-0legacy01' } }; }); return w.snapshot(); },
    solve: w => { w.files['legacy.tf'] = 'resource "aws_vpc" "legacy" {\n  cidr_block = "10.50.0.0/16"\n\n  tags = {\n    Name = "legacy"\n  }\n}\n'; w.run('init'); w.run('import aws_vpc.legacy vpc-0legacy01'); w.run('apply -auto-approve'); },
    grade: ws => { const g = tfGrader(ws); g.check('vpc-0legacy01 が state で管理されている', w => Object.values(w.state.resources).some(r => r.id === 'vpc-0legacy01')); g.check('既存VPCを作り直していない（IDが変わっていない）', w => !!w.cloud.resources['vpc-0legacy01'] && w.awsModel().vpcs.filter(v => v.cidr === '10.50.0.0/16').length === 1); return g.done(); } },
  { id: 'tf-ts-01', chapter: 'terraform', kind: 'troubleshooting', workspace: 'terraform', minutes: 15, title: '監査で見つかったSSH', mission: '監査で指摘された app-sg のSSH（0.0.0.0/0 から22番）が開いている原因を確かめ、コードに書かれた状態に戻してください。',
    brief: '**状況**: セキュリティ監査で「app-sg で、インターネット全体（0.0.0.0/0）からのSSH（22番）が許可されている」と指摘されました。Gitの履歴を見ても、Terraformのコードは変わっていません。\n\n**やること**: なぜ22番が開いているのかを確かめ、app-sg をコードに書かれた状態に戻します。\n\n**完了の条件**: app-sg に22番のルールがなく、terraform plan が「No changes」になること。直せたら、何が起きていたかを答えます。\n\n**まずは**: terraform plan を実行し、出力を上から順に読みます。',
    hints: ['terraform plan を実行し、変更の提案（~ など）より前に表示される部分も読みます。', 'plan に「Objects have changed outside of Terraform」とあれば、Terraformの外で実物が変わったという意味です。コード・state・実物のどれが違うかを見比べます。', 'コードが正しいなら、plan が提案する変更（22番のルールを削除する）をそのまま apply すれば、実物がコードの状態に戻ります。'],
    debrief: 'コードの外での変更（drift：ドリフト）は、plan で「Objects have changed outside of Terraform」として見つかり、apply でコードの状態に戻せることを確かめました。実務では、変更は必ずコードを直してレビューを通してから apply する運用にし、定期的に plan を実行してdriftを早く見つけます。緊急でコンソールから変えた場合も、後でコードに反映します。',
    build: () => applied(threeTierFiles(), w => { const id = w.state.resources['aws_security_group.app'].id; w.consoleChange(c => { (c.resources[id].attributes.ingress as unknown[]).push({ from_port: 22, to_port: 22, protocol: 'tcp', cidr_blocks: ['0.0.0.0/0'] }); }); }),
    solve: w => { w.run('apply -auto-approve'); },
    grade: ws => { const g = tfGrader(ws); g.check('app-sg に 22番のルールがない', w => { const m = w.awsModel(); return !m.securityGroups.find(s => s.name === 'app-sg')!.ingress.some(r => r.protocol === '-1' || (r.fromPort <= 22 && r.toPort >= 22)); }); return g.done(); },
    diagnosis: { question: '何が起きていましたか？', options: ['Terraformの外（コンソール）で実物が変更された（drift）', 'Terraformのコードに22番が書かれていた', 'state が壊れていた', 'プロバイダ（AWSと話すプラグイン）の不具合'], answer: 0, explanation: 'コンソールでの手作業で実物だけが変更され、コード・stateと食い違っていました（drift：ドリフト）。plan の前の refresh（実物の読み直し）で検出され、apply でコードの状態に戻せます。変更はコードを直し、レビューしてから行う運用が大切です。' } },
  { id: 'tf-04', chapter: 'terraform', kind: 'mastery', workspace: 'terraform', minutes: 35, title: 'モジュールで再利用する', mission: 'VPCとサブネットをモジュール ./modules/network にまとめ、ルートのコードから module として呼び出します。',
    brief: '**状況**: 同じネットワーク構成を、ステージング（stg）と本番（prod）の両方で使いたくなりました。コードをコピーせずに再利用できるよう、**モジュール**（リソースをまとめた再利用の単位）にします。\n\n**作るもの**\n\n- modules/network/ に、variable（cidr など）・resource・output（vpc_id など）\n- ルートの main.tf から module "network" { source = "./modules/network" ... } で呼び出す\n- ルートの output で、モジュールの値（module.network.vpc_id など）を公開する\n\n**完了の条件**: モジュールの中のリソースが state にあること（module.network.…）、ルートの output がモジュールの値を参照していること、modules/network に variable と output があること、terraform plan が「No changes」になること。\n\n**まずは**: modules/network/main.tf を作り、aws_vpc をそこへ移すところから始めます。',
    hints: ['モジュールの外から値を受け取るのが variable、外へ値を返すのが output です。ルートからは module.network.vpc_id のように参照します。', 'モジュールの中のリソースは、module.network.aws_vpc.this のようなアドレスになります。', 'ルートの aws_vpc.main はモジュールへ移すので削除し、outputs.tf の aws_vpc.main.id も module.network.vpc_id に書き換えます（実務では moved ブロックや terraform state mv でアドレスだけを変えますが、このシミュレータでは作り直しになります）。'],
    debrief: 'モジュールに variable と output という「入口と出口」を作ると、同じ構成を値だけ変えて何度も使えることを確かめました。実務では、環境ごとのディレクトリや変数ファイルから、同じモジュールを呼び出します。既存のリソースをモジュールへ移すときは、moved ブロックを使うと作り直しを避けられます。',
    build: () => ({ files: starterFiles() }),
    solve: w => { w.files = { 'main.tf': 'module "network" {\n  source = "./modules/network"\n  cidr   = "10.0.0.0/16"\n  name   = "prod"\n}\n\noutput "vpc_id" {\n  value = module.network.vpc_id\n}\n', 'modules/network/main.tf': 'variable "cidr" {\n  type = string\n}\n\nvariable "name" {\n  type = string\n}\n\nresource "aws_vpc" "this" {\n  cidr_block = var.cidr\n  tags = {\n    Name = var.name\n  }\n}\n\nresource "aws_subnet" "public" {\n  vpc_id     = aws_vpc.this.id\n  cidr_block = cidrsubnet(var.cidr, 8, 1)\n}\n\noutput "vpc_id" {\n  value = aws_vpc.this.id\n}\n' }; w.run('init'); w.run('apply -auto-approve'); },
    grade: ws => { const g = tfGrader(ws);
      g.check('モジュール内のリソースが state にある（module.network.*）', w => Object.keys(w.state.resources).some(a => a.startsWith('module.network.')));
      g.check('ルートに output があり、モジュールの値を参照している', w => /output\s+"[^"]+"\s*\{[^}]*module\.network\.\w+/.test(Object.entries(w.files).filter(([f]) => f.endsWith('.tf') && !f.includes('/')).map(([, s]) => s.replace(/(#|\/\/).*$/gm, '')).join('\n')));
      g.check('modules/network に variable と output がある', w => Object.entries(w.files).some(([f, s]) => f.startsWith('modules/network/') && /variable\s+"/.test(s) && /output\s+"/.test(s)));
      return g.done(); } },
  { id: 'capstone-6', chapter: 'capstone', kind: 'capstone', workspace: 'terraform', minutes: 120, title: 'Capstone 6: Capstone 4 をTerraformで表現する', mission: 'Capstone 4 の3層構成のAWSネットワークをTerraformのコードで定義し、apply して要件を満たします。',
    brief: 'Capstone 4 の要件（2つのAZ・ALB・アプリ・DB・NAT Gateway・SG）を、Terraformのコードで表現します。\n\n**追加のコード品質要件**\n\n- VPCのCIDRは変数で渡す\n- 繰り返しは count（または module）で書く\n- 重要な値を output で公開する\n- リソースIDを文字列で直書きしない（"subnet-0abc…" のようなIDではなく、aws_subnet.app[0].id のような参照を使う）\n- terraform plan が「No changes」になるまで apply する\n\nEC2には、教育用のタグ Role（app / db）と Listen（待ち受けポート。例: "8080"）を付けてください（このシミュレータ独自の約束です）。\n\n**完了の条件**: 上のコード品質要件と、Capstone 4 のすべての条件（[Capstone 4] と表示）を、apply 後の実物から判定します。\n\n**まずは**: Capstone 4 の構成を思い出しながら、ネットワーク（サブネット・経路）→ SG → EC2 / ALB の順に書き足し、少しずつ plan と apply で確かめます。',
    hints: ['「到達度を確認」で [Capstone 4] の条件のうち満たしていないものを見つけ、apply 後に右の「到達性」タブで分析し、どこで止まるかを確かめます。', 'Terraformで作ったSGには、既定のegress（アウトバウンドのすべて許可）がありません。必要なら egress ブロックを書きます。', 'DBのサブネットは、どのルートテーブルにも関連付けなければメインルートテーブル（local のみ）を使うので、インターネットへの経路がないままになります。'],
    debrief: 'Capstone 4 で画面から作った設計を、変数・count・参照・output を使ったコードで再現しました。コードにすると、同じ構成を別の環境に作ったり、変更をレビューで確かめたりできます。実務では、plan の結果をレビューに添え、承認されてから apply します。',
    build: () => ({ files: starterFiles() }),
    solve: w => { w.files = threeTierFiles(); w.files['db.tf'] = 'resource "aws_subnet" "db" {\n  count             = length(local.azs)\n  vpc_id            = aws_vpc.main.id\n  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + 21)\n  availability_zone = local.azs[count.index]\n}\n\nresource "aws_security_group" "db" {\n  name   = "db-sg"\n  vpc_id = aws_vpc.main.id\n  ingress {\n    from_port       = 5432\n    to_port         = 5432\n    protocol        = "tcp"\n    security_groups = [aws_security_group.app.id]\n  }\n}\n\nresource "aws_instance" "db" {\n  ami                    = data.aws_ami.al2023.id\n  instance_type          = "t3.small"\n  subnet_id              = aws_subnet.db[0].id\n  vpc_security_group_ids = [aws_security_group.db.id]\n  tags = {\n    Name   = "db"\n    Role   = "db"\n    Listen = "5432"\n  }\n}\n'; w.run('init'); w.run('apply -auto-approve'); },
    grade: ws => { const g = tfGrader(ws);
      g.check('VPCのCIDRを変数で渡している', w => /cidr_block\s*=\s*var\./.test(code(w)));
      g.check('count または module で繰り返しを書いている', w => /\bcount\s*=/.test(code(w)) || /\bmodule\s+"/.test(code(w)));
      g.check('output がある', w => /output\s+"/.test(code(w)));
      g.check('リソースIDを直書きしていない', w => !/"(vpc|subnet|sg|igw|nat|rtb|i|lb)-0[0-9a-f]{6,}"/.test(code(w)));
      const m = new TerraformWorkspace(ws.snapshot()).awsModel();
      for (const r of gradeThreeTier(m)) g.check(`[Capstone 4] ${r.label}`, () => r.pass);
      return g.done(); } },
];
