import { useMemo, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import type { ChapterId } from '../../labs/types';
import { dnsScenario } from '../../simulator/scenarios/chapters';
import PacketViewer from '../PacketViewer/PacketViewer';
import { HandshakeTimeline, LayerExplorer } from './TcpVisuals';
import SubnetTools from './SubnetTools';
import { RouteLookup, SpfView } from './RoutingVisuals';
import { BroadcastDomains, SwitchLearning } from './L2Visuals';
import DnsResolution from './DnsVisual';
import { NatTable, RuleEvaluator } from './NatFwVisuals';
import LadderDemo from './LinuxVisual';
import { AwsDemo, TerraformPlanDemo } from './CloudVisuals';
import { BgpDecision, TunnelCapture } from './VpnBgpVisuals';
import PacketJourney from './PacketJourney';
import { EcmpView, LagVsEcmp, LagView, LinkSpeedView, MediaCompat, RedundancyView } from './RedundancyVisuals';

function CaptureSample() {
  const rows = useMemo(() => { const n = dnsScenario(); const link = n.snapshot().links.find(l => l.sourceDevice === 'PC1')!.id; return n.http('PC1', 'https://www.example.com/').captures.filter(c => c.linkId === link); }, []);
  return <div className="visual-card"><PacketViewer rows={rows} title="サンプル: PC1 で https://www.example.com/ を開いたときのキャプチャ"/>
    <p className="muted tiny">行をクリックすると、そのパケットの中身（階層表示とHex dump）が表示されます。フィルタに <code>udp port 53</code>（DNS）や <code>tcp</code> を入れて、絞り込んでみましょう。自分のPCAPファイルは <Link to="/analyzer">Packet Analyzer</Link> で読み込めます（ファイルはブラウザの外へ送信されません）。</p></div>;
}
const visuals: Record<Exclude<ChapterId, 'capstone'>, () => ReactElement> = {
  'tcp-ip': () => <><LayerExplorer/><HandshakeTimeline/></>,
  subnet: () => <SubnetTools/>,
  routing: () => <><RouteLookup/><SpfView/><EcmpView/></>,
  'ethernet-vlan': () => <><SwitchLearning/><BroadcastDomains/><LinkSpeedView/><MediaCompat/><LagView/></>,
  dns: () => <DnsResolution/>,
  'nat-firewall': () => <><NatTable/><RuleEvaluator/></>,
  linux: () => <LadderDemo/>,
  capture: () => <CaptureSample/>,
  topology: () => <><PacketJourney/><LagVsEcmp/><RedundancyView/></>,
  aws: () => <AwsDemo/>,
  'vpn-bgp': () => <><TunnelCapture/><BgpDecision/></>,
  terraform: () => <TerraformPlanDemo/>,
};
export default function ChapterVisual({ id }: { id: string }) {
  const View = visuals[id as keyof typeof visuals];
  return <div className="visuals">{View ? <View/> : <p className="muted">この章の可視化ツールはありません。</p>}
    <p className="scope-note">ここに表示されるパケットや表は、すべてブラウザ内の教育用シミュレーションが生成したものです。</p></div>;
}
