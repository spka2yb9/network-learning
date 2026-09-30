import type { NetworkSimulator } from '../simulator/core/NetworkSimulator';
import { routingScenario } from '../simulator/scenarios/routing';
import { bgpScenario, dnsScenario, firewallScenario, l3SwitchScenario, natScenario, ospfScenario, stpScenario, vlanScenario, vpnScenario } from '../simulator/scenarios/chapters';
import { campusScenario, solveCampus } from '../labs/capstones';

/** Ready-made playground networks (all fully working, for free experimentation). */
export const templates: Record<string, { name: string; description: string; build: () => NetworkSimulator }> = {
  routing: { name: '静的ルーティング', description: 'PC1 – R1 – R2 – PC2。静的ルートを設定済み', build: () => routingScenario(true) },
  vlan: { name: 'VLAN / Router on a Stick', description: '2台のスイッチをトランクでつなぎ、1台のルータのサブインターフェースでVLAN間を中継', build: () => vlanScenario() },
  l3switch: { name: 'L3スイッチ（SVI）', description: 'スイッチ内の仮想インターフェース（SVI）で、VLAN間をルーティング', build: () => l3SwitchScenario() },
  stp: { name: 'STP（ループ構成）', description: '3台のスイッチを三角形につなぎ、Spanning Treeでループを防ぐ', build: () => stpScenario() },
  ospf: { name: 'OSPF', description: '4台のルータを四角形につなぎ、OSPFで経路を自動で交換（迂回路あり）', build: () => ospfScenario() },
  dns: { name: 'DNS / Web', description: 'ルート・TLD・権威DNSサーバー、再帰リゾルバ、Webサーバー', build: () => dnsScenario() },
  nat: { name: 'NAT / PAT', description: 'プライベートアドレスのLANから、PATでインターネットへ', build: () => natScenario() },
  firewall: { name: 'Firewall / DMZ', description: 'ステートフルFirewallで社内・DMZ（公開サーバーの区画）・外部を分ける（ルール設定済み）', build: () => firewallScenario(true) },
  bgp: { name: 'BGP（3 AS）', description: '3つのAS（組織）のルータを三角形につなぎ、eBGPで経路を交換', build: () => bgpScenario() },
  vpn: { name: 'IPsec VPN + BGP', description: '拠点とクラウドを2本のIPsecトンネルで結び、BGPで経路を交換', build: () => vpnScenario('bgp') },
  campus: { name: '企業LAN（完成例）', description: 'VLAN・L3スイッチ・DNS・NAT・Firewall', build: () => { const n = campusScenario(); solveCampus(n); return n; } },
};
