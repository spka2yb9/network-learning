import vpc from '@aws-icons/svg/icons/architecture-service/amazon-virtual-private-cloud.svg';
import ec2 from '@aws-icons/svg/icons/architecture-service/amazon-ec2.svg';
import lb from '@aws-icons/svg/icons/architecture-service/elastic-load-balancing.svg';
import alb from '@aws-icons/svg/icons/resource/elastic-load-balancing-application-load-balancer.svg';
import nlb from '@aws-icons/svg/icons/resource/elastic-load-balancing-network-load-balancer.svg';
import igw from '@aws-icons/svg/icons/resource/amazon-vpc-internet-gateway.svg';
import nat from '@aws-icons/svg/icons/resource/amazon-vpc-nat-gateway.svg';
import nacl from '@aws-icons/svg/icons/resource/amazon-vpc-network-access-control-list.svg';
import pcx from '@aws-icons/svg/icons/resource/amazon-vpc-peering-connection.svg';
import vpce from '@aws-icons/svg/icons/resource/amazon-vpc-endpoints.svg';
import vgw from '@aws-icons/svg/icons/resource/amazon-vpc-vpn-gateway.svg';
import internet from '@aws-icons/svg/icons/resource/internet.svg';
import publicSubnet from '@aws-icons/svg/icons/architecture-group/public-subnet.svg';
import privateSubnet from '@aws-icons/svg/icons/architecture-group/private-subnet.svg';
import { Icon } from '../Icon';

// Official AWS artwork, distributed by the third-party @aws-icons/svg package.
// Import only the assets we render; the built app never requests a remote icon CDN.
const sources = { vpc, ec2, lb, alb, nlb, igw, nat, nacl, pcx, vpce, vgw, internet, publicSubnet, privateSubnet };
export type AwsIconKind = keyof typeof sources | 'subnet' | 'rt' | 'sg';

export default function AwsIcon({ kind, size = 24 }: { kind: AwsIconKind; size?: number }) {
  // These resources have no matching asset in this package. Keep generic symbols.
  if (kind === 'subnet' || kind === 'rt' || kind === 'sg') return <Icon name={kind === 'sg' ? 'lock' : 'network'} size={size}/>;
  return <img className="aws-official-icon" src={sources[kind]} alt="" aria-hidden="true" width={size} height={size} draggable={false}/>;
}
