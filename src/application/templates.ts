import type { NetworkSimulator } from '../simulator/core/NetworkSimulator';
import { routingScenario } from '../simulator/scenarios/routing';
import { bgpScenario, designScenario, dnsScenario, ecmpScenario, firewallScenario, l3SwitchScenario, lagScenario, natScenario, ospfScenario, stpScenario, vlanScenario, vpnScenario } from '../simulator/scenarios/chapters';
import { campusScenario, solveCampus } from '../labs/capstones';

/** Ready-made playground networks (all fully working, for free experimentation). */
export const templates: Record<string, { name: string; description: string; build: () => NetworkSimulator }> = {
  routing: { name: '静的ルーティング', description: 'PC1 – R1 – R2 – PC2。静的ルートを設定済み', build: () => routingScenario(true) },
  vlan: { name: 'VLAN / Router on a Stick', description: '2台のスイッチをトランクでつなぎ、1台のルータのサブインターフェースでVLAN間を中継', build: () => vlanScenario() },
  l3switch: { name: 'L3スイッチ（SVI）', description: 'スイッチ内の仮想インターフェース（SVI）で、VLAN間をルーティング', build: () => l3SwitchScenario() },
  stp: { name: 'STP（ループ構成）', description: '3台のスイッチを三角形につなぎ、Spanning Treeでループを防ぐ', build: () => stpScenario() },
  lag: { name: 'Link Aggregation（LACP）', description: '2台のスイッチ間の2本をLACPで1つの論理リンク（po1）に束ね、VLAN 10 / 20 のトランクにする', build: () => lagScenario({ lag: true }) },
  ospf: { name: 'OSPF', description: '4台のルータを四角形につなぎ、OSPFで経路を自動で交換（迂回路あり・等コストの2経路はECMP）', build: () => ospfScenario() },
  ecmp: { name: 'ECMP（等コストの2経路）', description: 'R1 → R2 / R3 → R4 の2経路を、等コストの静的ルートで同時に使う', build: () => ecmpScenario('static') },
  design: { name: '冗長化と帯域（LAG + ECMP）', description: 'スイッチ間はLACPで束ね、ルータ間はOSPFのECMPで2経路を使う。どこが単一障害点として残るかを確かめる', build: () => designScenario({ lag: true, routing: 'ospf' }) },
  dns: { name: 'DNS / Web', description: 'ルート・TLD・権威DNSサーバー、再帰リゾルバ、Webサーバー', build: () => dnsScenario() },
  nat: { name: 'NAT / PAT', description: 'プライベートアドレスのLANから、PATでインターネットへ', build: () => natScenario() },
  firewall: { name: 'Firewall / DMZ', description: 'ステートフルFirewallで社内・DMZ（公開サーバーの区画）・外部を分ける（ルール設定済み）', build: () => firewallScenario(true) },
  bgp: { name: 'BGP（3 AS）', description: '3つのAS（組織）のルータを三角形につなぎ、eBGPで経路を交換', build: () => bgpScenario() },
  vpn: { name: 'IPsec VPN + BGP', description: '拠点とクラウドを2本のIPsecトンネルで結び、BGPで経路を交換', build: () => vpnScenario('bgp') },
  campus: { name: '企業LAN（完成例）', description: 'VLAN・L3スイッチ・DNS・NAT・Firewall', build: () => { const n = campusScenario(); solveCampus(n); return n; } },
};
