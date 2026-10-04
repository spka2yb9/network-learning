import type { Lab } from '../types';
import { tcpIpSimulation } from './tcp-ip';
import { subnetSimulation } from './subnet';
import { routingSimulation } from './routing';
import { ethernetVlanSimulation } from './ethernet-vlan';
import { dnsSimulation } from './dns';
import { natFirewallSimulation } from './nat-firewall';
import { linuxSimulation } from './linux';
import { captureSimulation } from './capture';
import { topologySimulation } from './topology';
import { awsVpcSimulation } from './aws';
import { vpnBgpSimulation } from './vpn-bgp';
import { iacSimulation } from './terraform';

/** One Simulation per chapter (its Simulation tab), in curriculum order. */
export const simulationLabs: Lab[] = ([tcpIpSimulation, subnetSimulation, routingSimulation, ethernetVlanSimulation, dnsSimulation, natFirewallSimulation, linuxSimulation, captureSimulation, topologySimulation, awsVpcSimulation, vpnBgpSimulation, iacSimulation] as (Lab | undefined)[]).filter((l): l is Lab => !!l);
