import { lab } from '../../application/LabController';
import { useUI } from '../../stores/ui';
import { hostKinds } from '../../simulator/core/types';
import { Icon } from '../Icon';
import { kindLabel } from './TopologyEditor';
import Interfaces from './properties/Interfaces';
import { DnsZoneSection, LinkSection, PolicySection, ResolverSection, RoutingSection, ServicesSection, SwitchingSection } from './properties/Sections';

export default function Properties() {
  useUI(s => s.revision); const id = useUI(s => s.selectedDevice); const linkId = useUI(s => s.selectedLink);
  if (linkId) return <div className="properties"><LinkSection key={linkId} linkId={linkId}/></div>;
  const device = lab.network.snapshot().devices.find(d => d.id === id);
  if (!device) return <div className="properties"><div className="empty-state">構成図の機器をクリックすると、ここで設定できます。ケーブルをクリックすると、リンクの設定になります。</div></div>;
  const full = lab.network.device(device.id);
  const host = hostKinds.includes(device.kind);
  return <div className="properties" key={device.id}>
    <div className="properties-title"><div className={`mini-device ${device.kind}`}><Icon name={device.kind === 'internet' ? 'cloud' : device.kind}/></div><div><h3>{device.id}</h3><span>{kindLabel[device.kind]}</span></div></div>
    <Interfaces device={full}/>
    <RoutingSection device={full}/>
    <SwitchingSection device={full}/>
    {host && <ResolverSection device={full}/>}
    {host && <ServicesSection device={full}/>}
    <DnsZoneSection device={full}/>
    <PolicySection device={full}/>
    <p className="muted tiny">OSPF・BGP・トンネルは、下の Terminal からCLIのコマンドで設定します。設定した結果（ARPキャッシュや経路など）は「状態」タブで見られます。</p>
    <button className="button small text-danger" onClick={() => { lab.mutate(n => n.removeDevice(device.id)); useUI.setState({ selectedDevice: lab.network.snapshot().devices[0]?.id ?? '' }); }}><Icon name="trash" size={15}/>この機器を削除</button>
  </div>;
}
