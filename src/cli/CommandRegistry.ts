import type { DeviceKind } from '../simulator/core/types';

const linuxHelp = [
  '【調べる】',
  'ip addr / ip -br addr — 自分のIPアドレスを見る  ·  ip link — ポートのUp/Down（ケーブルがつながっているか）を見る',
  'ip route — 経路表を見る  ·  ip route get <IP> — その宛先にどの経路・Gatewayを使うか調べる',
  'ip neigh / arp -n — ARPキャッシュ（IPアドレスとMACアドレスの対応表）を見る',
  'ping [-c 回数] [-t TTL] <IP|名前> — 相手に届いて、返事が戻るか確かめる',
  'traceroute [-I|-T -p <port>] <IP|名前>（既定はUDP）/ tracepath <IP> — 宛先までに通るルータを順に調べる',
  'ss -tulnp / ss -tan — 待ち受け中のポートと、接続の状態を見る',
  'dig [@server] <name> [A|AAAA|MX|TXT|NS|SOA|CNAME|PTR] [+short] [+trace] [+norecurse] / dig -x <IP> — DNSで名前を引く',
  'nslookup <name> [server] — DNSで名前を引く（簡易表示）',
  'curl [-v] [-I] [-k] <URL> — Webサーバーにアクセスする  ·  nc -zv <host> <port> — TCPポートに接続できるか確かめる',
  'tcpdump [-i IF] [-e] [-c N] [式] — この機器のリンクを通ったパケットを見る  例: tcpdump -i eth0 udp port 53',
  'cat /etc/resolv.conf — 使うDNSサーバーを見る  ·  cat /etc/hosts / hostname [-I]',
  'iptables -L -n / nft list ruleset — このホストのFirewallルールを見る  ·  systemctl status <service> — サービスが動いているか見る',
  '【設定する】',
  'ip addr add|del <CIDR> dev <IF> — IPアドレスを付ける／外す  ·  ip link set <IF> up|down — ポートを有効／無効にする',
  'ip route add default via <IP> — Default Gatewayを設定  ·  ip route add <CIDR> via <IP> — 経路を追加  ·  ip route del <CIDR|default> — 経路を削除',
  'echo "nameserver <IP>" > /etc/resolv.conf — 使うDNSサーバーを設定',
  'iptables -A|-I INPUT [-p tcp|udp|icmp] [-s CIDR] [--dport N] [-m conntrack --ctstate ESTABLISHED,RELATED] -j ACCEPT|DROP|REJECT — 受信を許可／破棄／拒否するルールを追加',
  'iptables -D INPUT <番号> — ルールを削除  ·  iptables -P INPUT ACCEPT|DROP — どのルールにも一致しないときの動作  ·  iptables -F — ルールを全削除',
  'systemctl start|stop|restart <service> — サービスを起動／停止／再起動  ·  rndc flush — DNSサーバーのキャッシュを消す',
  'sleep <秒> — 仮想時間を進める（キャッシュやARPの有効期限切れを試す）',
];
const iosHelp = (kind: DeviceKind) => [
  '【モード】 enable（特権モードへ）→ configure terminal（設定モードへ）→ interface <IF> / router ospf 1 / router bgp <AS> / vlan <ID> / ip access-list extended <名前>',
  '  exit — 1つ前のモードへ  ·  end — 特権モードへ戻る  ·  do <show ...> — 設定モードのまま show を実行',
  '【調べる】 ping <IP> [repeat N] — 届いて返事が戻るか確かめる  ·  traceroute <IP> — 途中のルータを順に調べる',
  '  show ip interface brief — 全ポートのIPアドレスとUp/Downを一覧  ·  show interfaces [IF] — ポートの詳細',
  '  show ip route [<IP>|ospf|bgp|static|connected] — 経路表を見る（IPを指定すると、どの経路が選ばれるかがわかる）',
  '  show arp — ARPキャッシュ  ·  show running-config — 今の設定  ·  show logging — 設定の不整合などのログ',
  ...(kind === 'switch' || kind === 'l3switch' ? ['  show mac address-table — MACアドレステーブル  ·  show vlan brief — VLANと所属ポート  ·  show interfaces trunk — トランクと許可VLAN  ·  show spanning-tree — STPの状態'] : []),
  '  show ip nat translations — NAT変換表  ·  show access-lists — ACL  ·  show ip ospf neighbor — OSPFの隣接  ·  show ip ospf database — OSPFのLSDB',
  '  show ip bgp [summary|<prefix>] — BGPの経路とネイバー  ·  show crypto session / show interfaces tunnel<N> — VPNトンネルの状態',
  ...(kind === 'firewall' ? ['  show firewall — Firewallのルール  ·  show conntrack — 接続追跡テーブル'] : []),
  '  clear arp / clear mac address-table / clear ip nat translation * — 各テーブルを消す  ·  tcpdump [式] — この機器のリンクを通ったパケットを見る',
  '【config】 ip route <CIDR> <next-hop|IF> [distance] — Static Routeを追加  ·  no ip route <CIDR> [next-hop] — 削除',
  '  ip nat inside source <CIDR> interface <IF> overload — PAT（内側の複数台を、出口の1つのIPアドレスで外へ出す）',
  '  ip nat inside source static [tcp|udp] <内側IP> [port] <外側IP> [port] — 固定の変換（ポートフォワード）',
  '  ip prefix-list <名前> seq <n> permit|deny <CIDR> [ge n] [le n] — 経路を選別するリスト（BGPの neighbor ... prefix-list で使う）',
  ...(kind === 'switch' || kind === 'l3switch' ? ['  vlan <ID> → name <名前> — VLANを作る  ·  spanning-tree priority <0-61440> — 小さいほどRoot Bridgeに選ばれやすい  ·  no spanning-tree  ·  ip default-gateway <IP>'] : []),
  ...(kind === 'firewall' ? ['  firewall mode stateful|stateless / firewall default permit|deny / firewall rule <seq> permit|deny|reject <proto> <src> [port] <dst> [port] [in IF] [out IF] / no firewall rule <seq> — Firewallの動作とルール'] : []),
  '【interface】 ip address <CIDR> — IPアドレス  ·  shutdown / no shutdown — 無効／有効  ·  description <text>  ·  ip nat inside|outside — NATの内側／外側',
  '  ip access-group <ACL> in|out — ACLをこのポートの受信／送信に適用  ·  ip ospf cost <n> — OSPFのコスト',
  ...(kind === 'switch' || kind === 'l3switch' ? ['  switchport mode access|trunk / switchport access vlan <ID> / switchport trunk allowed vlan <list|add|remove> / switchport trunk native vlan <ID> / spanning-tree cost <n>' + (kind === 'l3switch' ? ' / no switchport（ルーテッドポートにする）' : '')] : []),
  '  interface g0/0.10 → encapsulation dot1q 10 — VLAN 10用のサブインターフェース  ·  interface loopback0',
  '  interface tunnel1 → tunnel source|destination <IP> / tunnel mode ipsec|gre / tunnel protection psk <鍵> — VPNトンネル',
  '【router ospf】 network <CIDR|IP wildcard> area <n> — OSPFを動かすポートとエリア  ·  passive-interface <IF> — Helloを送らない（隣接を作らない）',
  '  router-id <IP>  ·  default-information originate — Default Routeを他のルータへ配る',
  '【router bgp】 neighbor <IP> remote-as <AS> — BGPの相手  ·  neighbor <IP> shutdown|next-hop-self|update-source <IF> / neighbor <IP> prefix-list <名前> in|out',
  '  neighbor <IP> local-preference <n> / med <n> / as-path prepend <回数>（教育用の簡略構文。実機はroute-map） — 経路の選ばれやすさを調整  ·  network <CIDR> — 広告する経路',
  '【ACL】 [seq] permit|deny <ip|tcp|udp|icmp> <any|host IP|CIDR> [eq|range port] <any|host IP|CIDR> [eq|range port] [established] / no <seq> — 上の行から順に比べ、最初に一致した行で決まる',
];
export function commandHelp(style: 'linux' | 'ios', kind: DeviceKind) {
  return ['教育用CLI（実機の完全な互換ではありません）', ...(style === 'linux' ? linuxHelp : iosHelp(kind))].join('\n');
}

export interface CommandContext { tokens: string[] }
export class CommandRegistry<T extends CommandContext> {
  private entries: { matches: (context: T) => boolean; execute: (context: T) => string }[] = [];
  register(matches: (context: T) => boolean, execute: (context: T) => string) { this.entries.push({ matches, execute }); }
  execute(context: T) {
    const entry = this.entries.find(e => e.matches(context));
    if (!entry) throw new Error('未対応のコマンドです。help で対応範囲を確認できます');
    return entry.execute(context);
  }
}
