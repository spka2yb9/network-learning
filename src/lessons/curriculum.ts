import type { ChapterId } from '../labs/types';

export interface Chapter {
  id: Exclude<ChapterId, 'capstone'>;
  dir: string;
  title: string;
  subtitle: string;
  level: 'FOUNDATION' | 'CORE NETWORKING' | 'PRACTICE' | 'PROFESSIONAL';
  available: boolean;
  goal: string;
}

export const curriculum: Chapter[] = [
  { id: 'tcp-ip', dir: '01-tcp-ip', title: 'TCP / IPのきほん', subtitle: 'レイヤーとカプセル化をつかむ', level: 'FOUNDATION', available: true, goal: 'Webページを開くときに流れるパケットを、層（レイヤー）ごとに分けて説明できる。' },
  { id: 'subnet', dir: '02-subnet', title: 'IPアドレスとサブネット', subtitle: 'ネットワークの境界を計算する', level: 'FOUNDATION', available: true, goal: 'IPアドレスとプレフィックス長から、ネットワークアドレス・ブロードキャストアドレス・使えるホストの範囲を計算できる。' },
  { id: 'routing', dir: '03-routing', title: 'ルーティング', subtitle: '経路表で次の行き先を決める', level: 'FOUNDATION', available: true, goal: '経路表を読んで、パケットが次にどのルータへ渡され、どこで止まったかを説明できる。同じ宛先に複数のNext Hopがある意味（ECMP）と、経路が壊れたときの変化も説明できる。' },
  { id: 'ethernet-vlan', dir: '04-ethernet-vlan', title: 'Ethernet / VLAN', subtitle: 'スイッチとVLANでLANを分ける', level: 'CORE NETWORKING', available: true, goal: 'スイッチがフレームをどのポートへ出すかを、MACアドレステーブルとVLANから説明できる。リンク速度と、LACPで束ねた論理リンクの容量・障害時の挙動も説明できる。' },
  { id: 'dns', dir: '05-dns', title: 'DNSと名前解決', subtitle: '名前からIPアドレスを調べる', level: 'CORE NETWORKING', available: true, goal: '名前解決で「誰が誰に問い合わせるか」と、キャッシュ（TTL）のせいで変更の反映が遅れる理由を説明できる。' },
  { id: 'nat-firewall', dir: '06-nat-firewall', title: 'NAT / Firewall', subtitle: 'アドレスを書き換え、通信を選んで通す', level: 'CORE NETWORKING', available: true, goal: 'NATテーブルとファイアウォールのルールを読んで、パケットが書き換えられるか・通るかを説明できる。' },
  { id: 'linux', dir: '07-linux', title: 'Linuxネットワーク', subtitle: '「つながらない」を層ごとに切り分ける', level: 'PRACTICE', available: true, goal: '「つながらない」を、NICからアプリケーションまで下の層から順に確かめ、最初に失敗した層を特定できる。' },
  { id: 'capture', dir: '08-capture', title: 'パケット解析', subtitle: 'キャプチャから通信の事実を読み取る', level: 'PRACTICE', available: true, goal: 'キャプチャから「実際に流れたもの」を読み取り、観測した事実と仮説を分けて説明できる。' },
  { id: 'topology', dir: '09-topology', title: 'ネットワーク構築', subtitle: '構成を組み、1ホップずつ確かめる', level: 'PRACTICE', available: true, goal: '機器を配置・配線・設定して通信を通し、1ホップごとにMAC・VLAN・IP・TTLのどれが変わるかを説明できる。ボトルネックと単一障害点を見つけ、LACPとECMPを使い分けて設計を説明できる。' },
  { id: 'aws', dir: '10-aws', title: 'AWS VPC', subtitle: 'VPCの経路とフィルタを設計する', level: 'PROFESSIONAL', available: true, goal: 'インターネットからEC2までの通信が届くかを、ルートテーブル・NACL・Security Groupの判定を行きと帰りでたどって説明できる。' },
  { id: 'vpn-bgp', dir: '11-vpn-bgp', title: 'VPN / BGP', subtitle: '拠点とクラウドを、トンネルとBGPでつなぐ', level: 'PROFESSIONAL', available: true, goal: 'VPNトンネルに通信を流すための経路とBGPの経路広告の関係を、トンネル障害時の切り替えまで説明できる。' },
  { id: 'terraform', dir: '12-terraform', title: 'Terraform', subtitle: 'ネットワークをコードで管理する', level: 'PROFESSIONAL', available: true, goal: 'terraform plan の記号を読んで、何が作成・変更・作り直しになるかを apply の前に説明できる。' },
];
export const chapterById = (id: string) => curriculum.find(c => c.id === id);
