import type { NetworkSimulator } from '../simulator/core/NetworkSimulator';
import type { NetworkSnapshot } from '../simulator/core/types';
import { access, lag } from '../simulator/scenarios/build';
import { designScenario, ecmpScenario, lagScenario } from '../simulator/scenarios/chapters';
import { grader } from './grade';
import { layer, ts } from './network';
import type { NetworkLab } from './types';

// ---- helpers shared by the link aggregation / ECMP / design labs ----
const between = (n: NetworkSimulator, a: string, b: string) => n.snapshot().links.filter(l => (l.sourceDevice === a && l.targetDevice === b) || (l.sourceDevice === b && l.targetDevice === a));
const cut = (n: NetworkSimulator, a: string, b: string) => { for (const l of between(n, a, b)) n.setLinkState(l.id, false); };
/** A whole device fails: every interface goes down. */
const halt = (n: NetworkSimulator, id: string) => n.update(id, d => { for (const i of d.interfaces) i.up = false; });
/** `each` TCP connections from every source: different source ports = different flows for ECMP / LAG hashing. */
const flows = (n: NetworkSimulator, from: string[], to: string, each = 4, port = 5201) => n.throughput(from.flatMap(f => Array.from({ length: each }, () => ({ from: f, to, port }))));
const routersUsed = (n: NetworkSimulator, from: string[], to: string) => new Set(flows(n, from, to).streams.flatMap(s => s.hops.map(h => h.device)));
const lagsOf = (n: NetworkSimulator, id: string) => Object.values(n.lagState()[id] ?? {});
/** Port-channel on `id` with at least `count` bundled members, negotiated by LACP. */
const lacpBundle = (n: NetworkSimulator, id: string, count: number) => lagsOf(n, id).some(l => l.protocol === 'LACP' && l.members.filter(m => m.flag === 'P').length >= count);
const nextHops = (n: NetworkSimulator, id: string, prefix: string) => n.installed(id).filter(r => r.destination === prefix).length;
const stpOn = (n: NetworkSimulator, ...ids: string[]) => ids.every(id => n.device(id).stp?.enabled !== false);
/** Speed changes against the starting topology, by cable end points (recreated cables count as changes). */
function speedChanges(start: NetworkSnapshot, now: NetworkSnapshot) {
  const key = (l: NetworkSnapshot['links'][number]) => [`${l.sourceDevice}:${l.sourceInterface}`, `${l.targetDevice}:${l.targetInterface}`].sort().join('|');
  const before = new Map(start.links.map(l => [key(l), l.bandwidth]));
  return now.links.filter(l => before.get(key(l)) !== l.bandwidth).length + start.links.filter(l => !now.links.some(x => key(x) === key(l))).length;
}
const SRV = '10.20.0.10';

/** Mastery start: three cables, ports at factory defaults on both switches, one cable linked at 100 Mbps. */
function lagMasteryStart() {
  const n = lagScenario({ cables: 3 });
  for (const sw of ['SW1', 'SW2']) n.update(sw, d => access(d, 1, 'g0/6', 'g0/7', 'g0/8'));
  n.setLinkProperties(between(n, 'SW1', 'SW2').find(l => l.sourceInterface === 'g0/8')!.id, { bandwidth: 100, latency: 1 });
  return n;
}
function bottleneckStart() {
  const n = designScenario({ lag: true, routing: 'single', speeds: { inter: 10_000, gateway: 1000, core: 10_000 } });
  for (const [a, b] of [['R1', 'R3'], ['R3', 'R4']]) for (const l of between(n, a, b)) n.setLinkProperties(l.id, { bandwidth: 1000, latency: 1 });
  return n;
}
const designStart = () => designScenario({ cables: 2, lag: false, routing: 'single', speeds: { inter: 1000, gateway: 10_000, core: 1000 } });
/** Reference L3 fix used by several labs: static routes out, OSPF in. */
function ospfDiamond(n: NetworkSimulator) {
  const ref = ecmpScenario('ospf');
  for (const id of ['R1', 'R2', 'R3', 'R4']) n.update(id, d => { d.routes = []; d.ospf = ref.device(id).ospf; });
}

export const redundancyLabs: NetworkLab[] = [
  // ---------------------------------------------------------------- ④ Ethernet / VLAN: link aggregation
  { id: 'lag-01', chapter: 'ethernet-vlan', kind: 'guided', workspace: 'network', minutes: 25, title: '2本のケーブルを1本の論理リンクに束ねる', mission: 'SW1–SW2 間の2本をLACPで束ね、VLAN 10 / 20 を運ぶトランクにする',
    brief: 'SW1とSW2の間には、ケーブルが2本あります。どちらもVLAN 10・20を運ぶトランクですが、STPがループを防ぐために片方をブロックしているので、実際に通信に使われているのは1本だけです。\n\nこの2本をLACP（Link Aggregation Control Protocol）で1つの論理リンク（Port-channel）に束ね、①2本とも使える ②片方が切れても通信が続く ようにしてください。',
    steps: ['SW1で show spanning-tree を実行し、g0/7 と g0/8 のどちらかが BLK（ブロック）になっていることを確認します（ブロックされているのが SW2 側なら、SW2 で確認します）。PC1で iperf3 -c 192.168.10.13 -P 4 を実行し、合計（SUM）が 1 Gbps であることも見ておきます。',
      'SW1で enable → configure terminal → interface range g0/7-8 → channel-group 1 mode active → exit と入力します。「Creating a port-channel interface po1」と表示され、論理インターフェース po1 ができます。',
      'interface po1 → switchport mode trunk → switchport trunk allowed vlan 10,20 → end。VLANの設定は、メンバー（g0/7・g0/8）ではなく po1 に入れます。',
      'SW1で show etherchannel summary を実行します。メンバーが (s)（suspended）になっているのは、対向のSW2がまだLACPを話していないからです。show logging にも理由が出ます。',
      'SW2でも interface range g0/7-8 → channel-group 1 mode passive（または active）→ exit → interface po1 → switchport mode trunk → switchport trunk allowed vlan 10,20 → end と設定します。',
      'もう一度 show etherchannel summary を実行し、po1(SU) と g0/7(P)・g0/8(P) を確認します。show spanning-tree では、STPから見たポートが po1 の1つだけになり、BLK が消えています。',
      'PC1で iperf3 -c 192.168.10.13 -P 4 を実行します。合計は 2 Gbps になりますが、1本の接続（-P 1）は 1 Gbps のままです。Debuggerの「LAGのメンバーを選ぶ」イベントで、フローごとにどちらのメンバーを選んだかを確認します。',
      'SW1–SW2 のケーブルを1本ダブルクリックしてDownにし、pingが続くこと、show etherchannel summary でそのメンバーが (D) になり、show interfaces po1 の BW が半分になることを確かめます。2本ともDownにすると通信が止まります。最後に両方Upへ戻します。'],
    hints: ['po1 が (SD)（Down）のままなら、SW1とSW2の両方で show etherchannel summary と show logging を確認します。片側だけの設定では束ねられません。', 'mode active 同士、または active と passive の組み合わせで束ねられます。passive 同士では、どちらもLACPDUを送り始めないため束ねられません。', 'VLANが通らないときは、show interfaces trunk で po1 がトランクになっていて、10・20が許可されているかを確認します。'],
    build: () => lagScenario(),
    solve: n => { for (const sw of ['SW1', 'SW2']) n.update(sw, d => lag(d, 1, sw === 'SW1' ? 'active' : 'passive', 'g0/7', 'g0/8')); },
    grade: s => { const g = grader(s);
      g.check('SW1 と SW2 の両方で、2本のケーブルがLACPで1つのPort-channelに束ねられている', n => lacpBundle(n, 'SW1', 2) && lacpBundle(n, 'SW2', 2));
      g.ping('VLAN 10: PC1 から PC3 へ ping が届く', 'PC1', '192.168.10.13'); g.ping('VLAN 20: PC2 から PC4 へ ping が届く', 'PC2', '192.168.20.14');
      g.check('STPでブロックされているケーブルがない（2本とも使える）', n => n.ping('PC1', '192.168.10.13').success && ![...n.stpState().ports.values()].some(p => p.role === 'alternate'));
      g.check('複数のフローで、合計 2 Gbps を使える（iperf3 -P 4 の合計）', n => flows(n, ['PC1'], '192.168.10.13', 8).total >= 2000);
      g.check('メンバーの1本がDownしても、VLAN 10・20 の通信が続く', n => between(n, 'SW1', 'SW2').every(l => { n.setLinkState(l.id, false); const ok = n.ping('PC1', '192.168.10.13').success && n.ping('PC2', '192.168.20.14').success; n.setLinkState(l.id, true); return ok; }));
      g.check('メンバーが2本ともDownすると、Port-channelもDownして通信が止まる', n => { cut(n, 'SW1', 'SW2'); return lagsOf(n, 'SW1').length > 0 && lagsOf(n, 'SW1').every(l => !l.up) && !n.ping('PC1', '192.168.10.13').success; });
      return g.done(); },
    debrief: 'LAGは「複数の物理リンクを、1つの論理リンクとして扱う」仕組みです。STPからは1本に見えるのでブロックされず、メンバーが1本切れても論理リンクは残ります。ただし振り分けはフロー単位なので、1本の接続はメンバー1本分の速さまでです。実務でも「束ねたのに速くならない」という相談の多くは、この誤解から来ています。', source: 'PC1', target: '192.168.10.13' },
  { id: 'lag-ts-01', chapter: 'ethernet-vlan', kind: 'troubleshooting', workspace: 'network', minutes: 15, explain: false, title: '束ねられない2本', mission: ts('SW1側の端末から、SW2側の端末へ届きません（VLAN 10・20とも）。'),
    brief: 'SW1とSW2の間の2本のケーブルは、LACPで1本の論理リンク（po1）に束ね、VLAN 10・20のトランクとして使う設計です。SW1は以前から設定済みです。昨日、SW2を新しい機器に交換し、設定を入れ直しました。\n\nPC1→PC3（VLAN 10）とPC2→PC4（VLAN 20）のpingが届き、2本のケーブルがLACPで束ねられていれば完了です。まず SW1 と SW2 で show etherchannel summary を実行しましょう。',
    hints: ['SW1とSW2で show etherchannel summary を実行します。メンバーの横の文字は何ですか？（P = 束ねて使用中、s = suspended、D = down）', 'suspended の理由は show logging に出ます。両側の show running-config で、メンバーの channel-group の行を比べます。', 'LACP（active / passive）と static（on）は、ネゴシエーションの有無が違うので組み合わせられません。SW2の設定を設計どおりLACPにそろえます（interface range g0/7-8 → no channel-group → channel-group 1 mode active）。'],
    build: () => { const n = lagScenario({ lag: true }); n.update('SW2', d => { for (const i of d.interfaces) if (i.channelGroup) i.channelGroup.mode = 'on'; }); return n; },
    solve: n => n.update('SW2', d => { for (const i of d.interfaces) if (i.channelGroup) i.channelGroup.mode = 'active'; }),
    grade: s => { const g = grader(s);
      g.ping('PC1 から PC3 へ ping が届く（VLAN 10）', 'PC1', '192.168.10.13'); g.ping('PC2 から PC4 へ ping が届く（VLAN 20）', 'PC2', '192.168.20.14');
      g.check('SW1・SW2 とも、2本のケーブルがLACPで束ねられている（設計どおり）', n => lacpBundle(n, 'SW1', 2) && lacpBundle(n, 'SW2', 2));
      return g.done(); },
    diagnosis: layer(0, 'SW2のメンバーが mode on（static：ネゴシエーションしない）、SW1は mode active（LACP）でした。LACPとstaticは組み合わせられないため、両側のメンバーが suspended になり、論理リンク po1 がDownしてスイッチ間の通り道がなくなっていました。show etherchannel summary の (s) と、show logging の %EC-5-L3DONTBNDL2 で確認できます。'),
    debrief: 'LAGの不具合は、物理的なケーブルは正常（リンクはUp）なのに、論理リンクがDownしている、という形で現れます。LACPは対向と確認し合うので、設定の食い違いを suspended として止めてくれます。static（on）同士なら確認しないぶん、食い違ったときにループや片側だけの転送が起きやすく、実務ではLACPが推奨されます。', source: 'PC1', target: '192.168.10.13' },
  { id: 'lag-mastery', chapter: 'ethernet-vlan', kind: 'mastery', workspace: 'network', minutes: 30, title: 'LAGとトランクを自力で組み、束ねられないメンバーを直す', mission: 'SW1–SW2 間の3本をLACPで束ね、必要なVLANだけを運ぶトランクにする',
    brief: 'SW1とSW2の間に、ケーブルを3本（g0/6・g0/7・g0/8）用意しました。どちらのスイッチも、この3本は初期設定（アクセスポート、VLAN 1）のままです。\n\n**要件**\n\n- 3本すべてをLACPで1つの論理リンクに束ねる（3本とも使用中にする）\n- その論理リンクで VLAN 10 と VLAN 20 だけを運ぶ（ほかのVLANは許可しない）\n- PC1↔PC3（VLAN 10）と PC2↔PC4（VLAN 20）が通信でき、メンバーのどれか1本が切れても通信が続く\n\n手順は示しません。設定したら show etherchannel summary で、束ねられていないメンバーがないかを必ず確認してください。',
    hints: ['interface range でまとめて channel-group を設定し、VLANの設定は Port-channel 側に入れます。', '1本だけ束ねられない場合は show etherchannel summary と show logging で理由を確かめます。show interfaces <ポート> の BW（リンク速度）もほかのメンバーと比べます。', 'メンバーの速度は、すべてそろっている必要があります。速度が違うリンクは interface <ポート> → speed 1000 でそろえます（教育用: ケーブルやモジュールを交換したことにあたります）。'],
    build: lagMasteryStart,
    solve: n => {
      n.setLinkProperties(between(n, 'SW1', 'SW2').find(l => l.sourceInterface === 'g0/8')!.id, { bandwidth: 1000, latency: 1 });
      for (const sw of ['SW1', 'SW2']) n.update(sw, d => { lag(d, 1, 'active', 'g0/6', 'g0/7', 'g0/8'); d.interfaces.find(i => i.id === 'po1')!.switchport = { mode: 'trunk', accessVlan: 1, allowedVlans: [10, 20], nativeVlan: 1 }; });
    },
    grade: s => { const g = grader(s);
      g.check('SW1・SW2 とも、3本すべてがLACPで束ねられている（suspended / down のメンバーがない）', n => lacpBundle(n, 'SW1', 3) && lacpBundle(n, 'SW2', 3));
      g.check('論理リンクが VLAN 10 と 20 だけを許可するトランク', n => ['SW1', 'SW2'].every(id => n.device(id).interfaces.some(i => i.kind === 'port-channel' && i.switchport?.mode === 'trunk' && JSON.stringify(i.switchport.allowedVlans) === '[10,20]')));
      g.ping('PC1 から PC3 へ ping が届く（VLAN 10）', 'PC1', '192.168.10.13'); g.ping('PC4 から PC2 へ ping が届く（VLAN 20）', 'PC4', '192.168.20.12');
      g.check('メンバーのどれか1本がDownしても、VLAN 10・20 の通信が続く', n => between(n, 'SW1', 'SW2').every(l => { n.setLinkState(l.id, false); const ok = n.ping('PC1', '192.168.10.13').success && n.ping('PC2', '192.168.20.14').success; n.setLinkState(l.id, true); return ok; }));
      g.check('複数のフローで、合計 3 Gbps を使える', n => flows(n, ['PC1', 'PC2'], '192.168.10.13', 6).total >= 3000);
      return g.done(); },
    debrief: 'g0/8 だけが 100 Mbps でリンクしていたため、ほかの2本と速度が合わず suspended になっていました。LAGは「同じ条件のリンクを束ねる」ものなので、速度・二重化・L2設定がそろっていないメンバーは使われません。実務では、ケーブルやトランシーバの規格違いで1本だけ速度が違う、という事故がよく起きます。', source: 'PC1', target: '192.168.10.13' },

  // ---------------------------------------------------------------- ③ Routing: ECMP
  { id: 'ecmp-01', chapter: 'routing', kind: 'guided', workspace: 'network', minutes: 25, title: '2本の等コスト経路を同時に使う（ECMP）', mission: 'R1・R4に等コストの経路を追加し、複数のフローをR2経由とR3経由に分散させる',
    brief: 'PC1（192.168.1.0/24）からSRV（10.20.0.0/24）への道は、R1→R2→R4 と R1→R3→R4 の2つがあります。どちらも同じ速さ（1 Gbps）・同じ段数です。今は R1 と R4 が R2 経由の静的ルートしか持たないので、R3 側は使われていません。\n\nR1とR4に、もう一方の経路を同じ条件（同じAD）で追加し、ECMP（Equal-Cost Multi-Path：等コストの経路を同時に使う）にしてください。',
    steps: ['PC1で traceroute -I 10.20.0.10 を実行し、R2（10.0.12.2）を通ることを確認します。PC1で iperf3 -c 10.20.0.10 -P 4 を実行し、合計が 1 Gbps であることを見ておきます。',
      'R1で show ip route を実行します。10.20.0.0/24 の行は via 10.0.12.2 の1つだけです。',
      'R1で enable → configure terminal → ip route 10.20.0.0/24 10.0.13.3 → end。もう一度 show ip route を実行し、10.20.0.0/24 の下に via 10.0.12.2 と via 10.0.13.3 の2行が並ぶことを確認します。',
      '戻りの道も同じように分散させます。R4で ip route 192.168.1.0/24 10.0.34.3 を追加します。',
      'PC1で iperf3 -c 10.20.0.10 -P 4 を実行します。Debuggerの「ECMPで経路を選ぶ」イベントで、ストリームごとに選ばれた Next Hop と、ハッシュ入力（送信元/宛先IP・ポート）を確認します。合計は 2 Gbps になりますが、1本の接続（-P 1）は 1 Gbps のままです。',
      'PC1で ping を何回か実行し、毎回同じ経路を通ることを確かめます（pingにはポート番号がないので、同じ送信元・宛先なら同じフローです）。R1で show ip cef exact-route 192.168.1.10 10.20.0.10 tcp 50000 80 と、ポートを変えた tcp 50001 80 を比べると、ポートで経路が変わることがわかります。'],
    hints: ['ECMPになるのは、同じ宛先・同じプレフィックス長・同じAD・同じメトリックの経路です。ADを変えると（例: ip route ... 10.0.13.3 5）、片方だけが使われます。', 'R1だけを直すと行きは分散しますが、戻りはR4の経路で決まります。R4にも 192.168.1.0/24 の経路を追加します。', 'show ip route 10.20.0.10 で「Routing Descriptor Blocks」に2つのNext Hopが並べばECMPです。'],
    build: () => ecmpScenario('single'),
    solve: n => { n.addRoute('R1', { destination: '10.20.0.0/24', nextHop: '10.0.13.3', preference: 1, metric: 0 }); n.addRoute('R4', { destination: '192.168.1.0/24', nextHop: '10.0.34.3', preference: 1, metric: 0 }); },
    grade: s => { const g = grader(s);
      g.check('R1 が 10.20.0.0/24 への等コストのNext Hopを2つ持つ', n => nextHops(n, 'R1', '10.20.0.0/24') >= 2);
      g.check('R4 が 192.168.1.0/24 への等コストのNext Hopを2つ持つ（戻りも分散）', n => nextHops(n, 'R4', '192.168.1.0/24') >= 2);
      g.ping('PC1 から SRV へ ping が届く', 'PC1', SRV); g.ping('SRV から PC1 へ ping が届く', 'SRV', '192.168.1.10');
      g.check('複数のフローが、R2 経由と R3 経由の両方に分散する', n => { const used = routersUsed(n, ['PC1'], SRV); return used.has('R2') && used.has('R3'); });
      g.check('複数のフローの合計で 2 Gbps を使える（1本の接続は 1 Gbps のまま）', n => flows(n, ['PC1'], SRV, 8).total >= 2000 && n.throughput([{ from: 'PC1', to: SRV }]).total === 1000);
      return g.done(); },
    debrief: 'ECMPは、経路表の同じ宛先に複数のNext Hopを持ち、パケットのフロー（送信元/宛先IP・プロトコル・ポート）のハッシュで1つを選ぶ仕組みです。フロー単位で振り分けるので、TCPの順序が入れ替わらない代わりに、1本の接続は1経路分の速さまでです。実機では、同時に使えるパス数の上限（maximum-paths）とハッシュの方式は機器・OSによって異なります。', source: 'PC1', target: SRV },
  { id: 'ecmp-ts-01', chapter: 'routing', kind: 'troubleshooting', workspace: 'network', minutes: 20, explain: false, title: 'つながったり、つながらなかったり', mission: ts('PC1からSRVのWebに、接続できるときとできないときがあります。'),
    brief: 'PC1からSRV（10.20.0.10）までは、R1→R2→R4 と R1→R3→R4 の2経路をECMPで使う構成です。利用者から「Webにつながったり、つながらなかったりする」と報告がありました。\n\n調べると、R2–R4 間のケーブルが物理的に故障していました。交換部品が届くのは来週です。**ケーブルは直さずに（R2–R4 のリンクはDownのまま）**、PC1からSRVへのどの接続も成功するようにしてください。',
    hints: ['PC1で curl http://10.20.0.10/ や nc -zv 10.20.0.10 80 を何回か実行します。毎回、送信元ポートが変わります。成功したときと失敗したときで、Debuggerの「ECMPで経路を選ぶ」イベントのNext Hopを比べます。', 'R1で show ip route を実行します。R2–R4 が切れているのに、R1は 10.0.12.2（R2）を経路に残していませんか？ R1から見るとR2は隣で、R1–R2のリンクは正常です。静的ルートは、離れた区間の障害を知る方法を持ちません。', '直し方は2通りあります。R1の R2 経由の静的ルートを消す（応急処置。ケーブルを直したあとで戻す必要があります）か、静的ルートをやめてOSPFにし、障害をルータどうしで伝え合わせる方法です。'],
    build: () => { const n = ecmpScenario('static'); cut(n, 'R2', 'R4'); return n; },
    solve: ospfDiamond,
    grade: s => { const g = grader(s);
      g.check('R2–R4 のケーブルは故障中のまま（Down）', n => between(n, 'R2', 'R4').every(l => !l.up));
      g.check('PC1 → SRV の複数の接続（送信元ポートが違う8本）がすべて成功する', n => flows(n, ['PC1'], SRV, 8).success);
      g.ping('SRV から PC1 へ ping が届く', 'SRV', '192.168.1.10');
      return g.done(); },
    diagnosis: layer(3, 'R1の静的ECMPが、R2–R4 の故障後も R2 経由を候補に残していました。R1から見るとR2は隣にあり、R1–R2 のリンクは正常だからです。フローのハッシュでR2経由を選んだ接続だけがR2で行き場を失い、残りはR3経由で届いたため「つながったり、つながらなかったり」になりました。'),
    debrief: 'ECMPでは、壊れた経路が候補に残っていると「一部のフローだけ失敗する」という分かりにくい症状になります。隣のリンクが切れれば静的ルートも消えますが、離れた区間の障害は、OSPFのような動的ルーティング（実務ではBFDなどの障害検出と組み合わせます）でないと検出できません。応急処置で静的ルートを消した場合は、修理後に戻し忘れて冗長性を失わないよう、変更記録を残しましょう。', source: 'PC1', target: SRV },
  { id: 'ecmp-mastery', chapter: 'routing', kind: 'mastery', workspace: 'network', minutes: 30, title: '障害に強い等コスト経路を自分で作る', mission: '2つの経路を同時に使い、どのルータ間リンクが切れても通信が続くようにする',
    brief: 'R1〜R4 にIPアドレスだけを設定した状態です。経路は1本も設定されていません。\n\n**要件**\n\n- PC1 ↔ SRV（10.20.0.10）が双方向に通信できる\n- R1 は SRV側へ、R4 は PC1側へ、それぞれ2つの等コストのNext Hopを持つ（ECMP）\n- ルータ間のリンク（R1–R2・R1–R3・R2–R4・R3–R4）のどれか1本、または R2・R3 のどちらか1台が故障しても、PC1からSRVへのどの接続も成功する\n\n最後に、R1–R2 のリンクを切ったときの R1 の経路を確かめて、下の設問に答えてください。',
    hints: ['まずは静的ルートでECMPを作ってみて、R2–R4 を切ったときに何が起きるかを確かめます（どの接続も成功しますか？）。', '離れた区間の障害を迂回するには、ルータどうしが経路情報を交換する動的ルーティングが必要です。router ospf 1 → network 10.0.0.0/8 area 0（R1・R4はLAN側も）で、コストが同じ2経路は自動でECMPになります。', '静的ルート（AD 1）が残っているとOSPF（AD 110）より優先されます。show ip route で、使われている経路の種類を確認します。'],
    questions: [{ label: 'R1–R2 のリンクがDownしたとき、R1 で 10.20.0.0/24 に残る Next Hop（IPアドレス）', answer: '10.0.13.3' }],
    build: () => ecmpScenario('none'), solve: ospfDiamond,
    grade: s => { const g = grader(s);
      g.ping('PC1 から SRV へ ping が届く', 'PC1', SRV); g.ping('SRV から PC1 へ ping が届く', 'SRV', '192.168.1.10');
      g.check('R1・R4 が、それぞれ2つの等コストのNext Hopを持つ（ECMP）', n => nextHops(n, 'R1', '10.20.0.0/24') >= 2 && nextHops(n, 'R4', '192.168.1.0/24') >= 2);
      for (const [a, b] of [['R1', 'R2'], ['R1', 'R3'], ['R2', 'R4'], ['R3', 'R4']]) g.check(`${a}–${b} が切れても、PC1 → SRV のどの接続も成功する`, n => { cut(n, a, b); return flows(n, ['PC1'], SRV, 8).success && n.ping('SRV', '192.168.1.10').success; });
      for (const id of ['R2', 'R3']) g.check(`${id} が停止しても、PC1 → SRV のどの接続も成功する`, n => { halt(n, id); return flows(n, ['PC1'], SRV, 8).success; });
      return g.done(); },
    debrief: 'ECMPは「複数の経路を同時に使う」仕組みで、どの経路が生きているかを決めるのはルーティングプロトコル（またはリンクの状態）です。ECMPとOSPFは別の概念で、OSPFは「使える経路」を見つけ、ECMPは「等コストの経路のどれにフローを流すか」を決めます。', source: 'PC1', target: SRV },

  // ---------------------------------------------------------------- ⑨ design: bandwidth and redundancy
  { id: 'bottleneck-01', chapter: 'topology', kind: 'challenge', workspace: 'network', minutes: 25, title: 'どこが遅いのかを見つけて、1本だけ増強する', mission: 'PC1→SRVの1本の転送を10 Gbpsにする。速度を上げてよいリンクは1本だけ',
    brief: 'PC1 から SRV（10.20.0.10）へ、毎晩バックアップを1本のTCP接続で転送しています。必要な速さは **10 Gbps** ですが、今は足りていません。\n\n予算の都合で、速度を上げられる（モジュールやケーブルを交換できる）リンクは **1本だけ** です。どのリンクが転送の速さを決めているかを調べ、そのリンクだけを 10 Gbps にしてください（interface <ポート> → speed 10000、または構成図でケーブルを選んで変更）。\n\n最後に下の設問に答えます。',
    hints: ['PC1で iperf3 -c 10.20.0.10 を実行して、今の速さを測ります。traceroute -I 10.20.0.10 で通る道も確認します（使われていないリンクを速くしても意味がありません）。', '構成図のケーブルのラベルが速度です。iperf3 の結果に出るボトルネック、または通る道の各リンクの速度（show interfaces の BW）を比べます。', 'SW1–SW2 は 10G × 2本のLAGです。合計は 20 Gbps ですが、1本の接続はメンバー1本分（10 Gbps）までです。ここは足りています。'],
    questions: [
      { label: '最初の構成で、PC1→SRV の1本の接続の速さを決めていたリンク', answer: 'SW2–R1', options: ['PC1–SW1', 'SW1–SW2（LAG 10G×2）', 'SW2–R1', 'R1–R2', 'R1–R3', 'R4–SRV'] },
      { label: 'SW1–SW2 のLAGのメンバーを4本（10G×4）に増やすと、1本のTCP接続の上限は？', answer: '10 Gbps のまま', options: ['10 Gbps のまま', '20 Gbps', '40 Gbps'] },
    ],
    build: bottleneckStart, solve: n => n.setLinkProperties(between(n, 'SW2', 'R1')[0].id, { bandwidth: 10_000, latency: 1 }),
    grade: s => { const g = grader(s); const start = bottleneckStart().snapshot();
      g.check('PC1 → SRV の1本のTCP接続で 10 Gbps 出る', n => n.throughput([{ from: 'PC1', to: SRV }]).total >= 10_000);
      g.check('速度を変えたリンクは1本だけ（ケーブルの追加・削除もしていない）', () => speedChanges(start, s) <= 1 && s.links.length === start.links.length);
      return g.done(); },
    debrief: '1本のフローの速さは、通る道のうち最も遅いリンク（ボトルネック）で決まります。「経路がある」ことと「十分な速さが出る」ことは別です。実務では、速いリンクを増やす前に、まず測って（iperf3など）通る道を確かめ、どこが詰まっているかを特定します。', source: 'PC1', target: SRV },
  { id: 'redundancy-01', chapter: 'topology', kind: 'challenge', workspace: 'network', minutes: 35, title: '単一障害点をなくす', mission: 'どのケーブル1本・どの中継ルータ1台が壊れても、PCからSRVへ届くようにする',
    brief: '今のネットワークは、1か所でも壊れると通信が止まる箇所（単一障害点：SPOF）がいくつもあります。R3 と、SW1・SW2 の空きポート（g0/8）は予備として用意してあります。\n\n**要件**: 次のどれか **1つ** が故障しても、PC1・PC2 から SRV への接続がすべて成功すること。\n\n- SW1–SW2 間のケーブル（必要ならケーブルを増設してかまいません。構成図でポートからポートへドラッグします）\n- R2、R3 のどちらか1台\n- ルータ間のリンク（R1–R2・R1–R3・R2–R4・R3–R4）のどれか1本\n\nPC・SRV、それらが直接つながる SW1・R4、Gatewayの SW2・R1 は今回は対象外です（それぞれ理由を考えてみましょう）。スイッチのSTPは無効にしないでください。',
    hints: ['まず故障を1つずつ試します。ケーブルはダブルクリックでDown、ルータは全ポートを shutdown にすると「停止」を再現できます。どこで止まるかを traceroute -I で確かめます。', 'SW1–SW2 間はケーブルを2本にします。STPに任せれば片方は待機（障害に備える）、LACPで束ねれば両方使えます（容量と障害対策の両方）。', 'R2経由の静的ルートだけでは、R2やR2の先が壊れたことをR1が知る方法がありません。OSPFで経路を交換させます。静的ルート（AD 1）はOSPFより優先されるので、消しておきます。'],
    build: () => designScenario({ cables: 1, routing: 'single' }),
    solve: n => {
      n.connect({ id: 'spare-cable', sourceDevice: 'SW1', sourceInterface: 'g0/8', targetDevice: 'SW2', targetInterface: 'g0/8', up: true, bandwidth: 1000, latency: 1 });
      ospfDiamond(n);
    },
    grade: s => { const g = grader(s);
      const ok = (n: NetworkSimulator) => flows(n, ['PC1', 'PC2'], SRV, 3).success && n.ping('SRV', '192.168.1.11').success;
      g.check('平常時、PC1・PC2 から SRV へ届く', ok);
      g.check('SW1–SW2 間のケーブルが2本以上あり、どれか1本が切れても届く', n => between(n, 'SW1', 'SW2').length >= 2 && between(n, 'SW1', 'SW2').every(l => { n.setLinkState(l.id, false); const r = ok(n); n.setLinkState(l.id, true); return r; }));
      for (const id of ['R2', 'R3']) g.check(`${id} が停止しても届く`, n => { halt(n, id); return ok(n); });
      for (const [a, b] of [['R1', 'R2'], ['R1', 'R3'], ['R2', 'R4'], ['R3', 'R4']]) g.check(`${a}–${b} が切れても届く`, n => { cut(n, a, b); return ok(n); });
      g.check('すべてのスイッチでSTPが有効', n => stpOn(n, 'SW1', 'SW2'));
      return g.done(); },
    debrief: '「線を増やせば冗長になる」わけではありません。L2の並列リンクにはループを防ぐ仕組み（STPやLACP）が、L3の複数経路には障害を検出して切り替える仕組み（動的ルーティング）が必要です。残ったSPOF（PCの1本のNIC、Gateway の R1 など）をなくすには、NICの冗長化やGatewayの冗長化（FHRP：このシミュレータでは扱いません）が必要で、費用とのトレードオフになります。', source: 'PC1', target: SRV },
  { id: 'design-mastery', chapter: 'topology', kind: 'mastery', workspace: 'network', minutes: 40, title: '容量と冗長性を両立させる', mission: '合計2 Gbps を流せて、どの1か所が壊れても止まらないネットワークに作り変える',
    brief: 'オフィス（PC1・PC2）からサーバー（SRV）への通信量が増え、可用性も求められるようになりました。リンクの速度は変えられません（どれも今のまま）。\n\n**要件**\n\n- PC1・PC2 から SRV への複数の接続で、**合計 2 Gbps 以上** を流せる\n- SW1–SW2 のケーブル1本、R2・R3 のどちらか1台、ルータ間のリンク1本、のどれが故障しても、PC1・PC2 から SRV への接続がすべて成功する\n- スイッチのSTPは有効のまま\n\n作業の前に今の構成を測り（iperf3）、単一障害点を探して、下の設問に答えてください。',
    hints: ['PC1で iperf3 -c 10.20.0.10 -P 4 を実行します。合計が 1 Gbps にとどまる区間は2か所あります。SW1–SW2（STPが片方を止めている）と、R1から先（R2経由の1経路だけ）です。', 'L2の2本は「同じ相手（SW2）との並列リンク」なのでLAGで束ねます。L3の2経路は「別々のルータ（R2・R3）を通る」のでLAGでは束ねられず、ECMPで使います。', 'ECMPの経路が壊れたときに切り替わるよう、静的ルートではなくOSPFを使います（コストが同じ経路は自動でECMPになります）。'],
    questions: [
      { label: '最初の構成で、PC1 → SRV の1本の接続の速さ（理論上限）', answer: '1 Gbps', options: ['1 Gbps', '2 Gbps', '10 Gbps'] },
      { label: '最初の構成で、1台止まるだけでPCからSRVへ届かなくなる中継ルータ（単一障害点）', answer: 'R2', options: ['R2', 'R3', 'どちらでもない'] },
      { label: 'SW1–SW2 の2本と、R1から R2・R3 への2経路を、同じ仕組みでまとめられないのはなぜ？', answer: 'LAGは同じ相手機器との並列リンクを束ねる仕組みで、R2とR3は別の機器だから（別の機器への複数経路はECMPで使う）', options: ['LAGは同じ相手機器との並列リンクを束ねる仕組みで、R2とR3は別の機器だから（別の機器への複数経路はECMPで使う）', 'LAGは1 Gbpsのリンクしか束ねられないから', 'ECMPはスイッチの機能だから'] },
    ],
    build: designStart,
    solve: n => { for (const sw of ['SW1', 'SW2']) n.update(sw, d => lag(d, 1, 'active', 'g0/7', 'g0/8')); ospfDiamond(n); },
    grade: s => { const g = grader(s);
      const ok = (n: NetworkSimulator) => flows(n, ['PC1', 'PC2'], SRV, 3).success;
      g.check('PC1・PC2 から SRV への複数の接続で、合計 2 Gbps 以上', n => flows(n, ['PC1', 'PC2'], SRV, 4).total >= 2000);
      g.check('SW1–SW2 のケーブルのどれか1本が切れても届く', n => between(n, 'SW1', 'SW2').every(l => { n.setLinkState(l.id, false); const r = ok(n); n.setLinkState(l.id, true); return r; }));
      for (const id of ['R2', 'R3']) g.check(`${id} が停止しても届く`, n => { halt(n, id); return ok(n); });
      for (const [a, b] of [['R1', 'R2'], ['R2', 'R4']]) g.check(`${a}–${b} が切れても届く`, n => { cut(n, a, b); return ok(n); });
      g.check('すべてのスイッチでSTPが有効', n => stpOn(n, 'SW1', 'SW2'));
      return g.done(); },
    debrief: '帯域を増やすことと、可用性を高めることは別の目標です。STPで待機させた2本目は障害に備えるだけで容量を増やさず、LAGやECMPで両方を使えば容量と冗長性の両方が得られます。ただし「2本とも使っている」状態で1本壊れれば、容量は半分になります（縮退）。設計では「この2本は何のためにあるのか」と「1本壊れたときに残る容量で足りるか」をセットで考えます。', source: 'PC1', target: SRV },
];
