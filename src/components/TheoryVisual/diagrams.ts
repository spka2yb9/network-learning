import type { Diagram } from './TheoryDiagram';

/** Static illustrations placed where the original text diagrams appeared. */
export const diagrams: Record<string, Diagram> = {
  "ethernet-frame": {
    "kind": "packet",
    "title": "Ethernetフレームの構造",
    "rows": [
      {
        "label": "PC1 → R1（g0/0）",
        "fields": [
          {
            "label": "宛先MAC",
            "detail": "02:00:00:02:00:01\nR1のg0/0"
          },
          {
            "label": "送信元MAC",
            "detail": "02:00:00:01:00:01\nPC1のeth0"
          },
          {
            "label": "タイプ",
            "detail": "0x0800\n中身はIP",
            "tone": "blue"
          },
          {
            "label": "中身",
            "detail": "上の層のデータ\nこの例ではIPパケット",
            "tone": "blue"
          },
          {
            "label": "FCS",
            "detail": "検査用の値\n受信側が破損を確かめる",
            "tone": "amber"
          }
        ]
      }
    ]
  },
  "ethernet-bytes": {
    "kind": "packet",
    "title": "Ethernetフレームの各フィールドの長さ",
    "rows": [
      {
        "label": "タグなしのフレーム",
        "fields": [
          {
            "label": "宛先MAC",
            "detail": "6バイト"
          },
          {
            "label": "送信元MAC",
            "detail": "6バイト"
          },
          {
            "label": "EtherType",
            "detail": "2バイト",
            "tone": "blue"
          },
          {
            "label": "データ",
            "detail": "46〜1500バイト\nIPパケットなど",
            "tone": "blue"
          },
          {
            "label": "FCS",
            "detail": "4バイト",
            "tone": "amber"
          }
        ]
      }
    ]
  },
  "vlan-tag-fields": {
    "kind": "packet",
    "title": "802.1Qタグが入る位置",
    "rows": [
      {
        "label": "タグなし",
        "fields": [
          {
            "label": "宛先MAC",
            "detail": "6バイト"
          },
          {
            "label": "送信元MAC",
            "detail": "6バイト"
          },
          {
            "label": "EtherType",
            "detail": "2バイト",
            "tone": "blue"
          },
          {
            "label": "データ",
            "detail": "IPパケットなど",
            "tone": "blue"
          },
          {
            "label": "FCS",
            "detail": "4バイト",
            "tone": "amber"
          }
        ]
      },
      {
        "label": "タグ付き",
        "fields": [
          {
            "label": "宛先MAC",
            "detail": "6バイト"
          },
          {
            "label": "送信元MAC",
            "detail": "6バイト"
          },
          {
            "label": "802.1Qタグ",
            "detail": "4バイト",
            "tone": "amber",
            "children": [
              {
                "label": "TPID",
                "detail": "0x8100"
              },
              {
                "label": "TCI",
                "detail": "優先度など ＋ VID（12ビット）"
              }
            ]
          },
          {
            "label": "EtherType",
            "detail": "2バイト",
            "tone": "blue"
          },
          {
            "label": "データ",
            "detail": "IPパケットなど",
            "tone": "blue"
          },
          {
            "label": "FCS",
            "detail": "4バイト",
            "tone": "amber"
          }
        ]
      }
    ]
  },
  "icmp-packet-fields": {
    "kind": "packet",
    "title": "IPのProtocolで中身を見分ける",
    "rows": [
      {
        "label": "通常のTCPデータ",
        "fields": [
          {
            "label": "Ethernet"
          },
          {
            "label": "IP",
            "detail": "Protocol = 6",
            "tone": "blue"
          },
          {
            "label": "L4ヘッダ",
            "detail": "TCP"
          },
          {
            "label": "データ",
            "detail": "アプリの中身",
            "tone": "amber"
          }
        ]
      },
      {
        "label": "ICMP",
        "fields": [
          {
            "label": "Ethernet"
          },
          {
            "label": "IP",
            "detail": "Protocol = 1",
            "tone": "blue"
          },
          {
            "label": "ICMP",
            "detail": "種類・コード・中身",
            "tone": "amber"
          }
        ]
      }
    ],
    "note": "この図ではFCSなどを省略しています。"
  },
  "protocol-packet-fields": {
    "kind": "packet",
    "title": "同じ包み方で、異なるプロトコルを運ぶ",
    "rows": [
      {
        "label": "DNSの問い合わせ",
        "fields": [
          {
            "label": "Ethernet"
          },
          {
            "label": "IP",
            "detail": "Protocol = 17",
            "tone": "blue"
          },
          {
            "label": "UDP",
            "detail": "宛先ポート53"
          },
          {
            "label": "DNS",
            "detail": "質問",
            "tone": "amber"
          }
        ]
      },
      {
        "label": "TCPの接続開始",
        "fields": [
          {
            "label": "Ethernet"
          },
          {
            "label": "IP",
            "detail": "Protocol = 6",
            "tone": "blue"
          },
          {
            "label": "TCP",
            "detail": "宛先ポート443 / SYN"
          }
        ]
      },
      {
        "label": "HTTPSのリクエスト",
        "fields": [
          {
            "label": "Ethernet"
          },
          {
            "label": "IP",
            "detail": "Protocol = 6",
            "tone": "blue"
          },
          {
            "label": "TCP",
            "detail": "宛先ポート443"
          },
          {
            "label": "TLS",
            "detail": "暗号化された GET /",
            "tone": "amber"
          }
        ]
      },
      {
        "label": "ping",
        "fields": [
          {
            "label": "Ethernet"
          },
          {
            "label": "IP",
            "detail": "Protocol = 1",
            "tone": "blue"
          },
          {
            "label": "ICMP",
            "detail": "Echo Request",
            "tone": "amber"
          }
        ]
      }
    ],
    "note": "FCSなどは省略しています。"
  },
  "tunnel-packet-fields": {
    "kind": "packet",
    "title": "元のIPパケットを、外側のIPで包む",
    "rows": [
      {
        "label": "包む前：PC1 → CGW",
        "fields": [
          {
            "label": "内側IP",
            "detail": "192.168.10.10 → 10.0.1.10",
            "tone": "blue"
          },
          {
            "label": "ICMP",
            "detail": "Echo Request",
            "tone": "blue"
          }
        ]
      },
      {
        "label": "包んだ後：CGW → INET → VGW1",
        "fields": [
          {
            "label": "外側IP",
            "detail": "198.51.100.2 → 203.0.113.2"
          },
          {
            "label": "トンネルヘッダ",
            "detail": "中にIPパケットがある印",
            "tone": "amber"
          },
          {
            "label": "元のパケット",
            "detail": "包む操作では中身を変えない",
            "tone": "blue",
            "children": [
              {
                "label": "内側IP",
                "detail": "192.168.10.10 → 10.0.1.10",
                "tone": "blue"
              },
              {
                "label": "ICMP",
                "detail": "Echo Request",
                "tone": "blue"
              }
            ]
          }
        ]
      }
    ]
  },
  "esp-packet-fields": {
    "kind": "packet",
    "title": "ESPで見える部分と暗号化される部分",
    "rows": [
      {
        "label": "ESPトンネルモード",
        "fields": [
          {
            "label": "外側IP",
            "detail": "198.51.100.2 → 203.0.113.2\nProtocol = ESP（50）"
          },
          {
            "label": "ESPヘッダ",
            "detail": "SPI = 0x00001102\nシーケンス番号 = 6"
          },
          {
            "label": "暗号化された部分",
            "detail": "外からは読めない",
            "tone": "amber",
            "children": [
              {
                "label": "内側IP",
                "detail": "192.168.10.10 → 10.0.1.10",
                "tone": "blue"
              },
              {
                "label": "ICMP",
                "detail": "Echo Request",
                "tone": "blue"
              },
              {
                "label": "詰め物など",
                "detail": "長さをそろえる"
              }
            ]
          },
          {
            "label": "改ざん検知用の値"
          }
        ]
      }
    ]
  },
  "dns-record-fields": {
    "kind": "packet",
    "title": "DNSレコードの読み方",
    "rows": [
      {
        "label": "Aレコードの例",
        "fields": [
          {
            "label": "名前",
            "detail": "www.example.com."
          },
          {
            "label": "TTL",
            "detail": "300秒",
            "tone": "amber"
          },
          {
            "label": "クラス",
            "detail": "IN"
          },
          {
            "label": "タイプ",
            "detail": "A",
            "tone": "blue"
          },
          {
            "label": "値",
            "detail": "203.0.113.80",
            "tone": "blue"
          }
        ]
      }
    ]
  },
  "tcp-ip-network": {
    "kind": "network",
    "title": "PC1からR1を経由してSRV1へ",
    "nodes": [
      {
        "id": "pc",
        "column": 0,
        "row": 0,
        "label": "PC1",
        "detail": "192.168.1.10\nノード君のPC"
      },
      {
        "id": "r",
        "column": 1,
        "row": 0,
        "label": "R1",
        "detail": "g0/0：192.168.1.1\ng0/1：192.168.2.1"
      },
      {
        "id": "srv",
        "column": 2,
        "row": 0,
        "label": "SRV1",
        "detail": "192.168.2.10\nWebサーバー"
      }
    ],
    "links": [
      {
        "from": "pc",
        "to": "r",
        "label": "ネットワーク1：192.168.1.0/24"
      },
      {
        "from": "r",
        "to": "srv",
        "label": "ネットワーク2：192.168.2.0/24"
      }
    ]
  },
  "ip-two-networks": {
    "kind": "network",
    "title": "PC1からR1を経由してSRV1へ",
    "nodes": [
      {
        "id": "pc",
        "column": 0,
        "row": 0,
        "label": "PC1",
        "detail": "192.168.1.10\nノード君のPC"
      },
      {
        "id": "r",
        "column": 1,
        "row": 0,
        "label": "R1",
        "detail": "g0/0：192.168.1.1\ng0/1：192.168.2.1"
      },
      {
        "id": "srv",
        "column": 2,
        "row": 0,
        "label": "SRV1",
        "detail": "192.168.2.10\nWebサーバー"
      }
    ],
    "links": [
      {
        "from": "pc",
        "to": "r",
        "label": "ネットワーク1：192.168.1.0/24"
      },
      {
        "from": "r",
        "to": "srv",
        "label": "ネットワーク2：192.168.2.0/24"
      }
    ]
  },
  "subnet-network": {
    "kind": "network",
    "title": "3つのLANをR1でつなぐ",
    "nodes": [
      {
        "id": "r",
        "column": 1,
        "row": 0,
        "label": "R1",
        "detail": "3つのLANの出口"
      },
      {
        "id": "sw1",
        "column": 0,
        "row": 1,
        "label": "SW1",
        "detail": "営業LAN・50台"
      },
      {
        "id": "sw2",
        "column": 1,
        "row": 1,
        "label": "SW2",
        "detail": "開発LAN・25台"
      },
      {
        "id": "sw3",
        "column": 2,
        "row": 1,
        "label": "SW3",
        "detail": "総務LAN・10台"
      },
      {
        "id": "pc12",
        "column": 0,
        "row": 2,
        "label": "PC1 / PC2",
        "detail": "営業"
      },
      {
        "id": "pc3",
        "column": 1,
        "row": 2,
        "label": "PC3",
        "detail": "開発"
      },
      {
        "id": "pc4",
        "column": 2,
        "row": 2,
        "label": "PC4",
        "detail": "総務"
      }
    ],
    "links": [
      {
        "from": "r",
        "to": "sw1",
        "label": "g0/0"
      },
      {
        "from": "r",
        "to": "sw2",
        "label": "g0/1"
      },
      {
        "from": "r",
        "to": "sw3",
        "label": "g0/2"
      },
      {
        "from": "sw1",
        "to": "pc12"
      },
      {
        "from": "sw2",
        "to": "pc3"
      },
      {
        "from": "sw3",
        "to": "pc4"
      }
    ]
  },
  "routing-network": {
    "kind": "network",
    "title": "2台のルータでLAN1とLAN2をつなぐ",
    "nodes": [
      {
        "id": "pc1",
        "column": 0,
        "row": 0,
        "label": "PC1",
        "detail": "192.168.1.10/24\nGW：192.168.1.1"
      },
      {
        "id": "r1",
        "column": 1,
        "row": 0,
        "label": "R1",
        "detail": "g0/0：192.168.1.1\ng0/1：10.0.0.1"
      },
      {
        "id": "r2",
        "column": 2,
        "row": 0,
        "label": "R2",
        "detail": "g0/0：10.0.0.2\ng0/1：192.168.2.1"
      },
      {
        "id": "pc2",
        "column": 3,
        "row": 0,
        "label": "PC2",
        "detail": "192.168.2.10/24\nGW：192.168.2.1"
      }
    ],
    "links": [
      {
        "from": "pc1",
        "to": "r1",
        "label": "LAN1：192.168.1.0/24"
      },
      {
        "from": "r1",
        "to": "r2",
        "label": "10.0.0.0/30"
      },
      {
        "from": "r2",
        "to": "pc2",
        "label": "LAN2：192.168.2.0/24"
      }
    ]
  },
  "routing-two-links": {
    "kind": "network",
    "title": "R1とR2の間に2つの経路を用意する",
    "nodes": [
      {
        "id": "pc1",
        "column": 0,
        "row": 1,
        "label": "PC1",
        "detail": "LAN1"
      },
      {
        "id": "r1",
        "column": 1,
        "row": 1,
        "label": "R1",
        "detail": ""
      },
      {
        "id": "link1",
        "column": 2,
        "row": 0,
        "label": "1本目",
        "detail": "10.0.0.0/30"
      },
      {
        "id": "link2",
        "column": 2,
        "row": 2,
        "label": "2本目",
        "detail": "10.0.0.4/30"
      },
      {
        "id": "r2",
        "column": 3,
        "row": 1,
        "label": "R2",
        "detail": ""
      },
      {
        "id": "pc2",
        "column": 4,
        "row": 1,
        "label": "PC2",
        "detail": "LAN2"
      }
    ],
    "links": [
      {
        "from": "pc1",
        "to": "r1"
      },
      {
        "from": "r1",
        "to": "link1",
        "label": "g0/1：10.0.0.1"
      },
      {
        "from": "link1",
        "to": "r2",
        "label": "g0/0：10.0.0.2"
      },
      {
        "from": "r1",
        "to": "link2",
        "label": "g0/2：10.0.0.5"
      },
      {
        "from": "link2",
        "to": "r2",
        "label": "g0/2：10.0.0.6"
      },
      {
        "from": "r2",
        "to": "pc2"
      }
    ]
  },
  "routing-indirect-failure": {
    "kind": "network",
    "title": "自分のリンクがUPでも、その先で故障する",
    "nodes": [
      {
        "id": "r1",
        "column": 0,
        "row": 0,
        "label": "R1",
        "detail": "g0/1"
      },
      {
        "id": "sw",
        "column": 1,
        "row": 0,
        "label": "スイッチ",
        "detail": ""
      },
      {
        "id": "r2",
        "column": 2,
        "row": 0,
        "label": "R2",
        "detail": "g0/0"
      }
    ],
    "links": [
      {
        "from": "r1",
        "to": "sw",
        "label": "ケーブルは正常"
      },
      {
        "from": "sw",
        "to": "r2",
        "label": "この区間で故障",
        "blocked": true
      }
    ]
  },
  "vlan-building": {
    "kind": "network",
    "title": "2つのフロアの配線",
    "nodes": [
      {
        "id": "pc1",
        "column": 0,
        "row": 0,
        "label": "PC1（営業）",
        "detail": "192.168.10.11"
      },
      {
        "id": "pc2",
        "column": 0,
        "row": 2,
        "label": "PC2（開発）",
        "detail": "192.168.20.12"
      },
      {
        "id": "sw1",
        "column": 1,
        "row": 1,
        "label": "SW1",
        "detail": "1階"
      },
      {
        "id": "sw2",
        "column": 2,
        "row": 1,
        "label": "SW2",
        "detail": "2階"
      },
      {
        "id": "pc3",
        "column": 3,
        "row": 0,
        "label": "PC3（営業）",
        "detail": "192.168.10.13"
      },
      {
        "id": "pc4",
        "column": 3,
        "row": 2,
        "label": "PC4（開発）",
        "detail": "192.168.20.14"
      }
    ],
    "links": [
      {
        "from": "pc1",
        "to": "sw1",
        "label": "SW1 g0/1"
      },
      {
        "from": "pc2",
        "to": "sw1",
        "label": "SW1 g0/2"
      },
      {
        "from": "sw1",
        "to": "sw2",
        "label": "g0/3 ↔ g0/3"
      },
      {
        "from": "sw2",
        "to": "pc3",
        "label": "SW2 g0/1"
      },
      {
        "from": "sw2",
        "to": "pc4",
        "label": "SW2 g0/2"
      }
    ]
  },
  "switch-learning-network": {
    "kind": "network",
    "title": "フレームを追うネットワーク",
    "nodes": [
      {
        "id": "pc1",
        "column": 0,
        "row": 0,
        "label": "PC1（営業）",
        "detail": "192.168.10.11"
      },
      {
        "id": "pc2",
        "column": 0,
        "row": 2,
        "label": "PC2（開発）",
        "detail": "192.168.20.12"
      },
      {
        "id": "sw1",
        "column": 1,
        "row": 1,
        "label": "SW1",
        "detail": "1階"
      },
      {
        "id": "sw2",
        "column": 2,
        "row": 1,
        "label": "SW2",
        "detail": "2階"
      },
      {
        "id": "pc3",
        "column": 3,
        "row": 0,
        "label": "PC3（営業）",
        "detail": "192.168.10.13"
      },
      {
        "id": "pc4",
        "column": 3,
        "row": 2,
        "label": "PC4（開発）",
        "detail": "192.168.20.14"
      }
    ],
    "links": [
      {
        "from": "pc1",
        "to": "sw1",
        "label": "SW1 g0/1"
      },
      {
        "from": "pc2",
        "to": "sw1",
        "label": "SW1 g0/2"
      },
      {
        "from": "sw1",
        "to": "sw2",
        "label": "g0/3 ↔ g0/3"
      },
      {
        "from": "sw2",
        "to": "pc3",
        "label": "SW2 g0/1"
      },
      {
        "from": "sw2",
        "to": "pc4",
        "label": "SW2 g0/2"
      }
    ]
  },
  "vlan-complete-network": {
    "kind": "network",
    "title": "VLAN・トランク・ルータを組み合わせる",
    "nodes": [
      {
        "id": "pc1",
        "column": 0,
        "row": 0,
        "label": "PC1（営業）",
        "detail": "192.168.10.11"
      },
      {
        "id": "pc2",
        "column": 0,
        "row": 2,
        "label": "PC2（開発）",
        "detail": "192.168.20.12"
      },
      {
        "id": "sw1",
        "column": 1,
        "row": 1,
        "label": "SW1",
        "detail": "1階"
      },
      {
        "id": "sw2",
        "column": 2,
        "row": 1,
        "label": "SW2",
        "detail": "2階"
      },
      {
        "id": "pc3",
        "column": 3,
        "row": 0,
        "label": "PC3（営業）",
        "detail": "192.168.10.13"
      },
      {
        "id": "pc4",
        "column": 3,
        "row": 2,
        "label": "PC4（開発）",
        "detail": "192.168.20.14"
      },
      {
        "id": "r",
        "column": 1,
        "row": 0,
        "label": "R1",
        "detail": "g0/0.10：192.168.10.1\ng0/0.20：192.168.20.1"
      }
    ],
    "links": [
      {
        "from": "pc1",
        "to": "sw1",
        "label": "SW1 g0/1"
      },
      {
        "from": "pc2",
        "to": "sw1",
        "label": "SW1 g0/2"
      },
      {
        "from": "sw1",
        "to": "sw2",
        "label": "po1：g0/3・g0/4を束ねたトランク"
      },
      {
        "from": "sw2",
        "to": "pc3",
        "label": "SW2 g0/1"
      },
      {
        "from": "sw2",
        "to": "pc4",
        "label": "SW2 g0/2"
      },
      {
        "from": "r",
        "to": "sw1",
        "label": "R1 g0/0 ↔ SW1 g0/8（トランク）"
      }
    ],
    "note": "営業はVLAN 10、開発はVLAN 20。R1がそれぞれのゲートウェイになります。"
  },
  "bandwidth-bottleneck": {
    "kind": "network",
    "title": "最も細い区間が通信速度の上限になる",
    "nodes": [
      {
        "id": "pc",
        "column": 0,
        "row": 0,
        "label": "PC",
        "detail": ""
      },
      {
        "id": "sw1",
        "column": 1,
        "row": 0,
        "label": "SW1",
        "detail": ""
      },
      {
        "id": "sw2",
        "column": 2,
        "row": 0,
        "label": "SW2",
        "detail": ""
      },
      {
        "id": "srv",
        "column": 3,
        "row": 0,
        "label": "Server",
        "detail": ""
      }
    ],
    "links": [
      {
        "from": "pc",
        "to": "sw1",
        "label": "10 Gbps"
      },
      {
        "from": "sw1",
        "to": "sw2",
        "label": "1 Gbps：ボトルネック"
      },
      {
        "from": "sw2",
        "to": "srv",
        "label": "10 Gbps"
      }
    ]
  },
  "dns-network": {
    "kind": "network",
    "title": "社内のリゾルバとインターネット側のDNS",
    "nodes": [
      {
        "id": "pc",
        "column": 0,
        "row": 0,
        "label": "PC1",
        "detail": "192.168.1.10"
      },
      {
        "id": "res",
        "column": 0,
        "row": 2,
        "label": "RESOLVER",
        "detail": "192.168.1.53"
      },
      {
        "id": "sw1",
        "column": 1,
        "row": 1,
        "label": "SW1",
        "detail": "社内LAN"
      },
      {
        "id": "r",
        "column": 2,
        "row": 1,
        "label": "R1",
        "detail": ""
      },
      {
        "id": "isp",
        "column": 3,
        "row": 1,
        "label": "ISP",
        "detail": ""
      },
      {
        "id": "sw2",
        "column": 4,
        "row": 1,
        "label": "SW2",
        "detail": ""
      },
      {
        "id": "root",
        "column": 5,
        "row": 0,
        "label": "ROOT",
        "detail": "198.51.100.10"
      },
      {
        "id": "tld",
        "column": 5,
        "row": 1,
        "label": "TLD",
        "detail": "198.51.100.20"
      },
      {
        "id": "auth",
        "column": 5,
        "row": 2,
        "label": "AUTH",
        "detail": "198.51.100.30"
      },
      {
        "id": "web",
        "column": 3,
        "row": 2,
        "label": "WEB",
        "detail": "203.0.113.80"
      }
    ],
    "links": [
      {
        "from": "pc",
        "to": "sw1"
      },
      {
        "from": "res",
        "to": "sw1"
      },
      {
        "from": "sw1",
        "to": "r"
      },
      {
        "from": "r",
        "to": "isp"
      },
      {
        "from": "isp",
        "to": "sw2"
      },
      {
        "from": "sw2",
        "to": "root"
      },
      {
        "from": "sw2",
        "to": "tld"
      },
      {
        "from": "sw2",
        "to": "auth"
      },
      {
        "from": "isp",
        "to": "web"
      }
    ],
    "note": "社内LAN：192.168.1.0/24。図は横にスクロールできます。"
  },
  "nat-network": {
    "kind": "network",
    "title": "社内LANとサーバー用LANをFWでつなぐ",
    "nodes": [
      {
        "id": "pc",
        "column": 0,
        "row": 0,
        "label": "PC1 / PC2",
        "detail": "192.168.1.10 / .11"
      },
      {
        "id": "sw1",
        "column": 1,
        "row": 0,
        "label": "SW1",
        "detail": "社内LAN"
      },
      {
        "id": "fw",
        "column": 2,
        "row": 0,
        "label": "FW",
        "detail": "g0/1：192.168.1.1\ng0/0：203.0.113.2/30"
      },
      {
        "id": "srv",
        "column": 2,
        "row": 1,
        "label": "SRV",
        "detail": "192.168.2.80\n自社のWebサーバー"
      },
      {
        "id": "isp",
        "column": 3,
        "row": 0,
        "label": "ISP",
        "detail": "203.0.113.1"
      },
      {
        "id": "sw2",
        "column": 4,
        "row": 0,
        "label": "SW2",
        "detail": ""
      },
      {
        "id": "web",
        "column": 5,
        "row": 0,
        "label": "WEB",
        "detail": "198.51.100.80\nwww.example.com"
      },
      {
        "id": "ext",
        "column": 5,
        "row": 1,
        "label": "EXT",
        "detail": "198.51.100.50\n社外の利用者"
      }
    ],
    "links": [
      {
        "from": "pc",
        "to": "sw1",
        "label": "社内LAN：192.168.1.0/24"
      },
      {
        "from": "sw1",
        "to": "fw",
        "label": "FW g0/1"
      },
      {
        "from": "fw",
        "to": "srv",
        "label": "g0/2：192.168.2.1 / サーバーLAN 192.168.2.0/24"
      },
      {
        "from": "fw",
        "to": "isp"
      },
      {
        "from": "isp",
        "to": "sw2"
      },
      {
        "from": "sw2",
        "to": "web"
      },
      {
        "from": "sw2",
        "to": "ext"
      }
    ]
  },
  "linux-network": {
    "kind": "network",
    "title": "社内LANからWebサーバーへの経路",
    "nodes": [
      {
        "id": "pc",
        "column": 0,
        "row": 0,
        "label": "PC1",
        "detail": "192.168.1.10/24\nGW：192.168.1.1"
      },
      {
        "id": "dns",
        "column": 0,
        "row": 1,
        "label": "NS1",
        "detail": "192.168.1.53/24\n社内のDNSサーバー"
      },
      {
        "id": "sw",
        "column": 1,
        "row": 0,
        "label": "SW1",
        "detail": "LAN1：192.168.1.0/24"
      },
      {
        "id": "r",
        "column": 2,
        "row": 0,
        "label": "R1",
        "detail": "g0/0：192.168.1.1\ng0/1：192.168.2.1"
      },
      {
        "id": "web",
        "column": 3,
        "row": 0,
        "label": "WEB",
        "detail": "192.168.2.80/24（予定）"
      }
    ],
    "links": [
      {
        "from": "pc",
        "to": "sw"
      },
      {
        "from": "dns",
        "to": "sw"
      },
      {
        "from": "sw",
        "to": "r"
      },
      {
        "from": "r",
        "to": "web",
        "label": "LAN2：192.168.2.0/24"
      }
    ],
    "note": "WEBをwww.example.comという名前で見られるようにします。NS1はexample.comを管理し、社内PCの問い合わせにも答えます。"
  },
  "capture-network": {
    "kind": "network",
    "title": "社内LANからWebサーバーへの経路",
    "nodes": [
      {
        "id": "pc",
        "column": 0,
        "row": 0,
        "label": "PC1",
        "detail": "192.168.1.10/24\nGW：192.168.1.1"
      },
      {
        "id": "dns",
        "column": 0,
        "row": 1,
        "label": "DNS1",
        "detail": "192.168.1.53/24\n社内のDNSサーバー"
      },
      {
        "id": "sw",
        "column": 1,
        "row": 0,
        "label": "SW1",
        "detail": "LAN1：192.168.1.0/24"
      },
      {
        "id": "r",
        "column": 2,
        "row": 0,
        "label": "R1",
        "detail": "g0/0：192.168.1.1\ng0/1：192.168.2.1"
      },
      {
        "id": "web",
        "column": 3,
        "row": 0,
        "label": "WEB",
        "detail": "192.168.2.80/24\nnginx：80 / 443"
      }
    ],
    "links": [
      {
        "from": "pc",
        "to": "sw"
      },
      {
        "from": "dns",
        "to": "sw"
      },
      {
        "from": "sw",
        "to": "r"
      },
      {
        "from": "r",
        "to": "web",
        "label": "LAN2：192.168.2.0/24"
      }
    ]
  },
  "office-network": {
    "kind": "network",
    "title": "執務室からインターネットまで",
    "nodes": [
      {
        "id": "pc",
        "column": 0,
        "row": 0,
        "label": "PC1 / PC2",
        "detail": "執務室・社員のPC"
      },
      {
        "id": "sw1",
        "column": 1,
        "row": 0,
        "label": "SW1",
        "detail": "執務室"
      },
      {
        "id": "sw2",
        "column": 2,
        "row": 0,
        "label": "SW2",
        "detail": "奥の部屋・ラック"
      },
      {
        "id": "srv",
        "column": 2,
        "row": 1,
        "label": "SRV1",
        "detail": "ファイルサーバー"
      },
      {
        "id": "r",
        "column": 3,
        "row": 0,
        "label": "R1",
        "detail": "営業所の出口"
      },
      {
        "id": "isp",
        "column": 4,
        "row": 0,
        "label": "ISP",
        "detail": "プロバイダ"
      },
      {
        "id": "web",
        "column": 5,
        "row": 0,
        "label": "WEB",
        "detail": "インターネット上のWeb"
      }
    ],
    "links": [
      {
        "from": "pc",
        "to": "sw1"
      },
      {
        "from": "sw1",
        "to": "sw2",
        "label": "部屋を結ぶ幹線"
      },
      {
        "from": "sw2",
        "to": "srv"
      },
      {
        "from": "sw2",
        "to": "r"
      },
      {
        "from": "r",
        "to": "isp"
      },
      {
        "from": "isp",
        "to": "web"
      }
    ]
  },
  "office-physical-network": {
    "kind": "network",
    "title": "物理構成：ポートとケーブル",
    "nodes": [
      {
        "id": "pc",
        "column": 0,
        "row": 0,
        "label": "PC1 / PC2",
        "detail": "執務室・社員のPC"
      },
      {
        "id": "sw1",
        "column": 1,
        "row": 0,
        "label": "SW1",
        "detail": "執務室"
      },
      {
        "id": "sw2",
        "column": 2,
        "row": 0,
        "label": "SW2",
        "detail": "奥の部屋・ラック"
      },
      {
        "id": "srv",
        "column": 2,
        "row": 1,
        "label": "SRV1",
        "detail": "ファイルサーバー"
      },
      {
        "id": "r",
        "column": 3,
        "row": 0,
        "label": "R1",
        "detail": "営業所の出口"
      },
      {
        "id": "isp",
        "column": 4,
        "row": 0,
        "label": "ISP",
        "detail": "プロバイダ"
      }
    ],
    "links": [
      {
        "from": "pc",
        "to": "sw1",
        "label": "PC1 eth0 ↔ g0/1、PC2 eth0 ↔ g0/2"
      },
      {
        "from": "sw1",
        "to": "sw2",
        "label": "g0/8 ↔ g0/8"
      },
      {
        "from": "sw2",
        "to": "srv",
        "label": "SW2 g0/1 ↔ SRV1 eth0"
      },
      {
        "from": "sw2",
        "to": "r",
        "label": "SW2 g0/2 ↔ R1 g0/0"
      },
      {
        "from": "r",
        "to": "isp",
        "label": "R1 g0/1 ↔ ISP g0/0"
      }
    ]
  },
  "office-logical-network": {
    "kind": "network",
    "title": "論理構成：VLANとルーティング",
    "nodes": [
      {
        "id": "staff",
        "column": 0,
        "row": 0,
        "label": "社員LAN・VLAN 10",
        "detail": "192.168.10.0/24\nPC1 .11 / PC2 .12"
      },
      {
        "id": "srv",
        "column": 0,
        "row": 2,
        "label": "サーバーLAN・VLAN 20",
        "detail": "192.168.20.0/24\nSRV1 .10"
      },
      {
        "id": "r",
        "column": 1,
        "row": 1,
        "label": "R1",
        "detail": "各VLANのゲートウェイ"
      },
      {
        "id": "isp",
        "column": 2,
        "row": 1,
        "label": "ISP",
        "detail": "203.0.113.1"
      },
      {
        "id": "web",
        "column": 3,
        "row": 1,
        "label": "WEB",
        "detail": "198.51.100.10"
      }
    ],
    "links": [
      {
        "from": "staff",
        "to": "r",
        "label": "g0/0.10：192.168.10.1"
      },
      {
        "from": "srv",
        "to": "r",
        "label": "g0/0.20：192.168.20.1"
      },
      {
        "from": "r",
        "to": "isp",
        "label": "g0/1：203.0.113.2 / 203.0.113.0/30"
      },
      {
        "from": "isp",
        "to": "web"
      }
    ],
    "note": "R1のDefault Route：0.0.0.0/0 → 203.0.113.1\nNAT：192.168.0.0/16 → 203.0.113.2"
  },
  "vpn-physical-network": {
    "kind": "network",
    "title": "物理経路と2本のトンネル",
    "nodes": [
      {
        "id": "pc",
        "column": 0,
        "row": 1,
        "label": "PC1",
        "detail": ""
      },
      {
        "id": "cgw",
        "column": 1,
        "row": 1,
        "label": "CGW",
        "detail": "拠点側"
      },
      {
        "id": "inet",
        "column": 2,
        "row": 1,
        "label": "INET",
        "detail": "インターネット"
      },
      {
        "id": "vgw1",
        "column": 3,
        "row": 0,
        "label": "VGW1",
        "detail": "トンネル1の相手"
      },
      {
        "id": "vgw2",
        "column": 3,
        "row": 2,
        "label": "VGW2",
        "detail": "トンネル2の相手"
      },
      {
        "id": "sw",
        "column": 4,
        "row": 1,
        "label": "VPCSW",
        "detail": ""
      },
      {
        "id": "ec2",
        "column": 5,
        "row": 1,
        "label": "EC2",
        "detail": ""
      }
    ],
    "links": [
      {
        "from": "pc",
        "to": "cgw"
      },
      {
        "from": "cgw",
        "to": "inet"
      },
      {
        "from": "inet",
        "to": "vgw1"
      },
      {
        "from": "inet",
        "to": "vgw2"
      },
      {
        "from": "vgw1",
        "to": "sw"
      },
      {
        "from": "vgw2",
        "to": "sw"
      },
      {
        "from": "sw",
        "to": "ec2"
      }
    ],
    "note": "tunnel1：CGW ↔ VGW1（前半で作る）\ntunnel2：CGW ↔ VGW2（後半で追加する）\nトンネルの通信も、物理的にはINETを通ります。"
  },
  "terraform-api-path": {
    "kind": "network",
    "title": "コンソールもTerraformもAWSのAPIを呼ぶ",
    "nodes": [
      {
        "id": "human",
        "column": 0,
        "row": 0,
        "label": "ボタンを押す",
        "detail": "人の操作"
      },
      {
        "id": "code",
        "column": 0,
        "row": 1,
        "label": "ファイルを書く",
        "detail": "人の操作"
      },
      {
        "id": "console",
        "column": 1,
        "row": 0,
        "label": "コンソール",
        "detail": ""
      },
      {
        "id": "tf",
        "column": 1,
        "row": 1,
        "label": "Terraform",
        "detail": ""
      },
      {
        "id": "api",
        "column": 2,
        "row": 0,
        "label": "AWSのAPI",
        "detail": ""
      },
      {
        "id": "vpc",
        "column": 3,
        "row": 0,
        "label": "VPCができる",
        "detail": ""
      }
    ],
    "links": [
      {
        "from": "human",
        "to": "console",
        "directed": true
      },
      {
        "from": "code",
        "to": "tf",
        "directed": true
      },
      {
        "from": "console",
        "to": "api",
        "directed": true
      },
      {
        "from": "tf",
        "to": "api",
        "directed": true
      },
      {
        "from": "api",
        "to": "vpc",
        "directed": true
      }
    ]
  },
  "terraform-resource-dependencies": {
    "kind": "network",
    "title": "参照先を先に作り、最後に関連付ける",
    "nodes": [
      {
        "id": "vpc",
        "column": 0,
        "row": 1,
        "label": "aws_vpc.main",
        "detail": "1段目：VPC"
      },
      {
        "id": "sub",
        "column": 1,
        "row": 0,
        "label": "aws_subnet.public",
        "detail": "2段目：サブネット"
      },
      {
        "id": "igw",
        "column": 1,
        "row": 2,
        "label": "aws_internet_gateway.main",
        "detail": "2段目：IGW"
      },
      {
        "id": "rt",
        "column": 2,
        "row": 1,
        "label": "aws_route_table.public",
        "detail": "3段目：ルートテーブル"
      },
      {
        "id": "assoc",
        "column": 3,
        "row": 0,
        "label": "aws_route_table_association.public",
        "detail": "4段目：関連付け"
      }
    ],
    "links": [
      {
        "from": "vpc",
        "to": "sub",
        "label": "VPCを参照",
        "directed": true
      },
      {
        "from": "vpc",
        "to": "igw",
        "label": "VPCを参照",
        "directed": true
      },
      {
        "from": "vpc",
        "to": "rt",
        "label": "VPCを参照",
        "directed": true
      },
      {
        "from": "igw",
        "to": "rt",
        "label": "IGWを参照",
        "directed": true
      },
      {
        "from": "sub",
        "to": "assoc",
        "label": "サブネットを参照",
        "directed": true
      },
      {
        "from": "rt",
        "to": "assoc",
        "label": "ルートテーブルを参照",
        "directed": true
      }
    ],
    "note": "矢印は、参照されるリソースから、それを使うリソースへ向けています。"
  },
  "encapsulation-all-layers": {
    "kind": "tree",
    "title": "送り出すときは、下の層が上の層を包む",
    "roots": [
      {
        "label": "Ethernetフレーム",
        "detail": "Ethernetヘッダ ＋ 中身 ＋ FCS",
        "children": [
          {
            "label": "IPパケット",
            "detail": "IPヘッダ ＋ 中身",
            "children": [
              {
                "label": "L4のデータ",
                "detail": "L4ヘッダ ＋ 中身",
                "children": [
                  {
                    "label": "アプリケーションのデータ",
                    "detail": "ページをください",
                    "tone": "amber"
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  },
  "dns-name-tree": {
    "kind": "tree",
    "title": "DNSの名前は、ルートから枝分かれする",
    "roots": [
      {
        "label": "ルート「.」",
        "detail": "名前が空のルートゾーン",
        "children": [
          {
            "label": "com",
            "detail": "TLD",
            "children": [
              {
                "label": "example",
                "detail": "example.com",
                "children": [
                  {
                    "label": "www",
                    "detail": "www.example.com"
                  },
                  {
                    "label": "mail",
                    "detail": "mail.example.com"
                  }
                ]
              },
              {
                "label": "ほかの会社"
              }
            ]
          },
          {
            "label": "jp",
            "detail": "TLD"
          },
          {
            "label": "net",
            "detail": "TLD"
          }
        ]
      }
    ]
  },
  "dns-zone-tree": {
    "kind": "tree",
    "title": "名前の範囲と管理する範囲",
    "roots": [
      {
        "label": "example.com ドメイン",
        "detail": "名前の範囲",
        "children": [
          {
            "label": "example.com ゾーン",
            "detail": "本社が管理：example.com、www.example.com、mail.example.com"
          },
          {
            "label": "dev.example.com ゾーン",
            "detail": "開発チームが管理：dev.example.com、api.dev.example.com",
            "tone": "blue"
          }
        ]
      }
    ]
  },
  "aws-region-tree": {
    "kind": "tree",
    "title": "リージョン・VPC・AZ・サブネットの関係",
    "roots": [
      {
        "label": "Region ap-northeast-1",
        "detail": "Tokyo",
        "children": [
          {
            "label": "VPC path-vpc",
            "detail": "10.0.0.0/16",
            "children": [
              {
                "label": "AZ ap-northeast-1a",
                "children": [
                  {
                    "label": "public-a",
                    "detail": "10.0.1.0/24",
                    "children": [
                      {
                        "label": "web",
                        "detail": "10.0.1.10 / 203.0.113.10\nTCP 80"
                      },
                      {
                        "label": "nat-a",
                        "detail": "203.0.113.20"
                      }
                    ]
                  },
                  {
                    "label": "private-a",
                    "detail": "10.0.2.0/24",
                    "children": [
                      {
                        "label": "db",
                        "detail": "10.0.2.10 / TCP 5432"
                      }
                    ]
                  }
                ]
              },
              {
                "label": "AZ ap-northeast-1c",
                "detail": "この章では使わない"
              }
            ]
          }
        ]
      }
    ],
    "note": "VPCはリージョン内の複数のAZにまたがり、各サブネットは1つのAZに属します。"
  },
  "aws-network": {
    "kind": "network",
    "title": "VPCのWeb公開とDBの外向き通信",
    "nodes": [
      {
        "id": "client",
        "column": 0,
        "row": 0,
        "label": "client",
        "detail": "198.51.100.77"
      },
      {
        "id": "update",
        "column": 0,
        "row": 2,
        "label": "update server",
        "detail": "198.51.100.10"
      },
      {
        "id": "igw",
        "column": 1,
        "row": 1,
        "label": "path-igw",
        "detail": "Internet Gateway"
      },
      {
        "id": "web",
        "column": 2,
        "row": 0,
        "label": "web・public-a",
        "detail": "10.0.1.10 :80\n公開IP：203.0.113.10"
      },
      {
        "id": "nat",
        "column": 2,
        "row": 2,
        "label": "nat-a・public-a",
        "detail": "203.0.113.20"
      },
      {
        "id": "db",
        "column": 3,
        "row": 1,
        "label": "db・private-a",
        "detail": "10.0.2.10 :5432"
      }
    ],
    "links": [
      {
        "from": "client",
        "to": "igw",
        "label": "Webアクセス",
        "directed": true
      },
      {
        "from": "igw",
        "to": "web",
        "label": "public-a：10.0.1.0/24",
        "directed": true
      },
      {
        "from": "web",
        "to": "db",
        "label": "DBへの接続",
        "directed": true
      },
      {
        "from": "db",
        "to": "nat",
        "label": "OS更新を開始",
        "directed": true
      },
      {
        "from": "nat",
        "to": "igw",
        "label": "送信元を変換",
        "directed": true
      },
      {
        "from": "igw",
        "to": "update",
        "label": "更新サーバーへ",
        "directed": true
      }
    ],
    "note": "Region：ap-northeast-1（Tokyo） / VPC：path-vpc 10.0.0.0/16\npublic-a（10.0.1.0/24）とprivate-a（10.0.2.0/24）は、どちらもAZ ap-northeast-1aにあります。"
  },
  "terraform-target-tree": {
    "kind": "tree",
    "title": "Terraformで作るネットワーク",
    "roots": [
      {
        "label": "東京リージョン",
        "detail": "ap-northeast-1",
        "children": [
          {
            "label": "VPC path-vpc",
            "detail": "10.0.0.0/16",
            "children": [
              {
                "label": "Internet Gateway",
                "detail": "インターネットへの出入口"
              },
              {
                "label": "パブリックサブネット",
                "detail": "10.0.1.0/24 / ap-northeast-1a",
                "children": [
                  {
                    "label": "ルートテーブル public",
                    "detail": "0.0.0.0/0 → Internet Gateway"
                  }
                ]
              },
              {
                "label": "セキュリティグループ web-sg",
                "detail": "80/tcpを受け付ける"
              },
              {
                "label": "プライベートサブネット",
                "detail": "10.0.11.0/24（1a） / 10.0.12.0/24（1c）"
              }
            ]
          },
          {
            "label": "検証用 VPC path-stg-vpc",
            "detail": "10.1.0.0/16\n同じ形をmoduleから作る",
            "tone": "blue"
          }
        ]
      }
    ]
  },
  "terraform-module-tree": {
    "kind": "tree",
    "title": "moduleの入口・内部・出口",
    "roots": [
      {
        "label": "modules/network",
        "detail": "再利用する部品",
        "children": [
          {
            "label": "入口：変数",
            "detail": "name → variable \"name\"\ncidr → variable \"cidr\"",
            "tone": "blue"
          },
          {
            "label": "内部のリソース",
            "children": [
              {
                "label": "aws_vpc.this"
              },
              {
                "label": "aws_subnet.public"
              }
            ]
          },
          {
            "label": "出口：output",
            "detail": "output \"vpc_id\" → vpc_id",
            "tone": "amber"
          }
        ]
      }
    ]
  },
  "binary-weights": {
    "kind": "bits",
    "title": "8ビットの桁の重み",
    "rows": [
      {
        "label": "128・64・32・16・8・4・2・1",
        "value": [
          0
        ]
      }
    ]
  },
  "binary-examples": {
    "kind": "bits",
    "title": "1の立っている桁の重みを足す",
    "rows": [
      {
        "label": "192 = 128 + 64",
        "value": [
          192
        ]
      },
      {
        "label": "168 = 128 + 32 + 8",
        "value": [
          168
        ]
      },
      {
        "label": "255 = すべての桁の重みの合計",
        "value": [
          255
        ]
      }
    ]
  },
  "ipv4-octets": {
    "kind": "bits",
    "title": "IPv4は8ビットずつ、4つのオクテット",
    "rows": [
      {
        "label": "192.168.10.70（左から第1〜第4オクテット）",
        "value": [
          192,
          168,
          10,
          70
        ]
      }
    ]
  },
  "prefix-24-bits": {
    "kind": "bits",
    "title": "/24は先頭24ビットがネットワーク部",
    "rows": [
      {
        "label": "192.168.10.20/24",
        "value": [
          192,
          168,
          10,
          20
        ],
        "prefix": 24
      }
    ]
  },
  "prefix-26-bits": {
    "kind": "bits",
    "title": "/26では第4オクテットの先頭2ビットも比べる",
    "rows": [
      {
        "label": "PC1：192.168.10.10/26",
        "value": [
          192,
          168,
          10,
          10
        ],
        "prefix": 26
      },
      {
        "label": "PC2：192.168.10.20/26",
        "value": [
          192,
          168,
          10,
          20
        ],
        "prefix": 26
      },
      {
        "label": "PC3：192.168.10.70/26",
        "value": [
          192,
          168,
          10,
          70
        ],
        "prefix": 26
      }
    ]
  },
  "mask-24-bits": {
    "kind": "bits",
    "title": "/24のサブネットマスク",
    "rows": [
      {
        "label": "255.255.255.0",
        "value": [
          255,
          255,
          255,
          0
        ],
        "prefix": 24
      }
    ]
  },
  "mask-26-bits": {
    "kind": "bits",
    "title": "/26のサブネットマスク",
    "rows": [
      {
        "label": "255.255.255.192",
        "value": [
          255,
          255,
          255,
          192
        ],
        "prefix": 26
      }
    ]
  },
  "mask-27-bits": {
    "kind": "bits",
    "title": "マスクの1を数えると、プレフィックス長になる",
    "rows": [
      {
        "label": "255.255.255.224：8 + 8 + 8 + 3 = 27",
        "value": [
          255,
          255,
          255,
          224
        ],
        "prefix": 27
      }
    ]
  },
  "subnet-and-bits": {
    "kind": "bits",
    "title": "70とマスク224のANDを計算する",
    "rows": [
      {
        "label": "手順1：/27の第4オクテット（24 + 3ビット）",
        "value": [
          224
        ],
        "prefix": 3
      },
      {
        "label": "手順2：70を2進数にする",
        "value": [
          70
        ],
        "prefix": 3
      },
      {
        "label": "手順3：ANDの結果 → 192.168.10.64",
        "value": [
          64
        ],
        "prefix": 3
      }
    ]
  },
  "broadcast-host-bits": {
    "kind": "bits",
    "title": "ホスト部をすべて1にするとブロードキャスト",
    "rows": [
      {
        "label": "ネットワークアドレス：192.168.10.64",
        "value": [
          64
        ],
        "prefix": 3
      },
      {
        "label": "手順4：ブロードキャストアドレス → 192.168.10.95",
        "value": [
          95
        ],
        "prefix": 3
      }
    ]
  },
  "subnet-and-shortcut": {
    "kind": "bits",
    "title": "近道の答えをANDで確かめる",
    "rows": [
      {
        "label": "IPの第4オクテット：100",
        "value": [
          100
        ],
        "prefix": 4
      },
      {
        "label": "マスク：240",
        "value": [
          240
        ],
        "prefix": 4
      },
      {
        "label": "AND：96（近道の答えと一致）",
        "value": [
          96
        ],
        "prefix": 4
      }
    ]
  },
  "arp-exchange": {
    "kind": "flow",
    "title": "ARPでMACアドレスを調べてから送る",
    "paths": [
      {
        "label": "",
        "steps": [
          {
            "label": "PC1 → 全員：ARP要求",
            "detail": "宛先MAC：ff:ff:ff:ff:ff:ff\n192.168.1.1を持っている人は、192.168.1.10にMACアドレスを教えて。"
          },
          {
            "label": "R1 → PC1：ARP応答",
            "detail": "宛先MAC：02:00:00:01:00:01\n192.168.1.1は02:00:00:02:00:01です。",
            "tone": "blue"
          },
          {
            "label": "PC1が対応を覚える",
            "detail": "192.168.1.1 = 02:00:00:02:00:01"
          },
          {
            "label": "PC1 → R1：本来のフレーム",
            "detail": "宛先MAC：02:00:00:02:00:01\n送りたかったパケットを中に入れる。"
          }
        ]
      }
    ]
  },
  "receive-decapsulation": {
    "kind": "flow",
    "title": "受信側は外側から順に中身を取り出す",
    "paths": [
      {
        "label": "SRV1が受け取る",
        "steps": [
          {
            "label": "リンク層",
            "detail": "宛先MACが自分かを確認。Ethernetヘッダを外し、タイプ＝IPなのでインターネット層へ。"
          },
          {
            "label": "インターネット層",
            "detail": "宛先IPが自分かを確認。IPヘッダを外し、Protocol＝TCPなのでトランスポート層へ。"
          },
          {
            "label": "トランスポート層",
            "detail": "どのプログラム宛てかを確認。L4ヘッダを外し、Webサーバーへ。"
          },
          {
            "label": "アプリケーション層",
            "detail": "Webサーバーが「ページをください」を読む。"
          }
        ]
      }
    ]
  },
  "router-forwarding-steps": {
    "kind": "flow",
    "title": "R1がフレームを受け取り、送り直す",
    "paths": [
      {
        "label": "g0/0で受信 → g0/1から送信",
        "steps": [
          {
            "label": "宛先MACを確認",
            "detail": "02:00:00:02:00:01 が自分のg0/0か確かめる。"
          },
          {
            "label": "Ethernetヘッダを外す",
            "detail": "中のIPパケットを取り出す。"
          },
          {
            "label": "宛先IPで経路表を引く",
            "detail": "192.168.2.10 → 192.168.2.0/24はg0/1に直接つながっている。"
          },
          {
            "label": "TTLを1減らす",
            "detail": "64 → 63"
          },
          {
            "label": "g0/1側でARP",
            "detail": "192.168.2.10のMACは02:00:00:03:00:01。"
          },
          {
            "label": "新しいEthernetフレームを送る",
            "detail": "送信元MAC：02:00:00:02:00:02（R1 g0/1）\n宛先MAC：02:00:00:03:00:01（SRV1）"
          }
        ]
      }
    ]
  },
  "tcp-handshake-messages": {
    "kind": "flow",
    "title": "TCPの接続からデータ送信まで",
    "paths": [
      {
        "label": "PC1 192.168.1.10:49153 ↔ SRV1 192.168.2.10:80",
        "steps": [
          {
            "label": "PC1 → SRV1：SYN",
            "detail": "つなぎたい。こちらはxから数えます。"
          },
          {
            "label": "SRV1 → PC1：SYN, ACK",
            "detail": "了解、xの次を待つ。こちらはyから。",
            "tone": "blue"
          },
          {
            "label": "PC1 → SRV1：ACK",
            "detail": "了解、yの次を待つ。"
          },
          {
            "label": "PC1 → SRV1：データ",
            "detail": "Webの「ページをください」。",
            "tone": "amber"
          }
        ]
      }
    ]
  },
  "https-request-steps": {
    "kind": "flow",
    "title": "URLを開いてから接続を閉じるまで",
    "paths": [
      {
        "label": "",
        "steps": [
          {
            "label": "ブラウザ",
            "detail": "URLを読む → ホスト名 www.example.com、ポート443"
          },
          {
            "label": "DNS",
            "detail": "UDP 53で問い合わせ → 答え 192.168.2.10"
          },
          {
            "label": "TCP",
            "detail": "192.168.2.10:443 と SYN → SYN, ACK → ACK"
          },
          {
            "label": "TLS",
            "detail": "ClientHello（SNI）→ ServerHello＋証明書 → 確認 → ここから暗号化"
          },
          {
            "label": "HTTP",
            "detail": "GET / → 200 OK とページ（暗号化された中身として）"
          },
          {
            "label": "TCP",
            "detail": "FIN, ACK → FIN, ACK → ACK で閉じる"
          }
        ]
      }
    ],
    "note": "どのやり取りもIPパケットで運ばれ、ケーブル1区間ごとにEthernetフレームに入れ直されます。次の相手のMACアドレスはARPで調べます。"
  },
  "local-remote-delivery": {
    "kind": "flow",
    "title": "同じLANと別のLANで、次に渡す相手が変わる",
    "paths": [
      {
        "label": "PC1 → PC2：同じネットワーク",
        "steps": [
          {
            "label": "PC2にARP",
            "detail": "192.168.10.20は誰？ → PC2が答える。"
          },
          {
            "label": "PC2へ直接送る",
            "detail": "宛先MAC：PC2\n宛先IP：192.168.10.20"
          }
        ]
      },
      {
        "label": "PC1 → PC3：違うネットワーク",
        "steps": [
          {
            "label": "R1にARP",
            "detail": "192.168.10.1は誰？ → R1が答える。"
          },
          {
            "label": "R1へ預ける",
            "detail": "宛先MAC：R1 g0/0\n宛先IP：192.168.10.70"
          },
          {
            "label": "R1が送り直す",
            "detail": "開発LAN側でPC3へ送る。"
          }
        ]
      }
    ]
  },
  "ping-missing-return": {
    "kind": "flow",
    "title": "行きは届くが、R2に帰りの経路がない",
    "paths": [
      {
        "label": "Echo Request：宛先192.168.2.10",
        "steps": [
          {
            "label": "PC1"
          },
          {
            "label": "R1"
          },
          {
            "label": "R2"
          },
          {
            "label": "PC2",
            "detail": "届く"
          }
        ]
      },
      {
        "label": "Echo Reply：宛先192.168.1.10",
        "steps": [
          {
            "label": "PC2"
          },
          {
            "label": "R2で破棄",
            "detail": "一致する経路がない",
            "tone": "amber"
          }
        ]
      }
    ]
  },
  "default-route-loop-path": {
    "kind": "flow",
    "title": "デフォルトルートがお互いを指すとループする",
    "paths": [
      {
        "label": "ほかに一致する経路がない宛先",
        "steps": [
          {
            "label": "R1",
            "detail": "0.0.0.0/0 → 10.0.0.2（R2）"
          },
          {
            "label": "R2",
            "detail": "0.0.0.0/0 → 10.0.0.1（R1）"
          },
          {
            "label": "R1へ戻る",
            "detail": "同じ転送が繰り返される",
            "tone": "amber"
          }
        ]
      }
    ]
  },
  "switch-forwarding-steps": {
    "kind": "flow",
    "title": "スイッチは送信元を学び、宛先を探す",
    "paths": [
      {
        "label": "",
        "steps": [
          {
            "label": "受信",
            "detail": "g0/1 でフレームを受け取る（送信元MAC＝A、宛先MAC＝B）"
          },
          {
            "label": "学習",
            "detail": "「A は g0/1 の先にいる」と表に書く"
          },
          {
            "label": "検索",
            "detail": "宛先 B を表で探す"
          },
          {
            "label": "転送",
            "detail": "見つかれば、そのポートにだけ送る\n見つからない、またはブロードキャストなら、受け取ったポート以外の全ポートへ送る"
          }
        ]
      }
    ]
  },
  "switch-broadcast-path": {
    "kind": "flow",
    "title": "ARP要求をフラッディングする",
    "paths": [
      {
        "label": "宛先MAC：ff:ff:ff:ff:ff:ff",
        "steps": [
          {
            "label": "PC1 → SW1 g0/1",
            "detail": "ARP要求を送る。"
          },
          {
            "label": "SW1で学習・転送",
            "detail": "PC1のMACはg0/1の先。ブロードキャストなのでg0/2とg0/3へ。"
          },
          {
            "label": "PC2とSW2に届く",
            "detail": "PC2は192.168.10.13ではないので捨てる。SW2はg0/3で受信し、PC1のMACを学習。"
          },
          {
            "label": "SW2からPC3・PC4へ",
            "detail": "g0/1のPC3は自分のIPなので受け取る。g0/2のPC4は捨てる。"
          }
        ]
      }
    ]
  },
  "switch-arp-reply-path": {
    "kind": "flow",
    "title": "ARP応答は学習済みのポートにだけ送る",
    "paths": [
      {
        "label": "PC3 → PC1",
        "steps": [
          {
            "label": "PC3 → SW2 g0/1",
            "detail": "宛先はPC1のMAC。"
          },
          {
            "label": "SW2 → SW1 g0/3",
            "detail": "PC3のMACをg0/1で学習。PC1のMACは表にあるのでg0/3だけへ。"
          },
          {
            "label": "SW1 → PC1 g0/1",
            "detail": "PC3のMACをg0/3で学習。PC1のMACは表にあるのでg0/1だけへ。"
          }
        ]
      }
    ]
  },
  "switch-known-unicast": {
    "kind": "flow",
    "title": "学習後は、必要なポートだけで往復する",
    "paths": [
      {
        "label": "Echo Request",
        "steps": [
          {
            "label": "PC1 → SW1",
            "detail": "g0/1で受信 → g0/3だけへ"
          },
          {
            "label": "SW2 → PC3",
            "detail": "g0/3で受信 → g0/1だけへ"
          }
        ]
      },
      {
        "label": "Echo Reply",
        "steps": [
          {
            "label": "PC3 → SW2",
            "detail": "g0/1で受信 → g0/3だけへ"
          },
          {
            "label": "SW1 → PC1",
            "detail": "g0/3で受信 → g0/1だけへ"
          }
        ]
      }
    ]
  },
  "vlan-broadcast-scope": {
    "kind": "flow",
    "title": "ブロードキャストも同じVLAN内だけに送る",
    "paths": [
      {
        "label": "VLAN 20のARP要求",
        "steps": [
          {
            "label": "PC2 → SW1 g0/2",
            "detail": "宛先MAC：ff:ff:ff:ff:ff:ff\nアクセスポートのVLAN 20として受信。"
          },
          {
            "label": "SW1が学習",
            "detail": "VLAN 20のPC2のMACはg0/2の先。"
          },
          {
            "label": "VLAN 20を送れるポートだけへ",
            "detail": "g0/1（VLAN 10）には送らない。",
            "tone": "amber"
          }
        ]
      }
    ]
  },
  "vlan-tag-path": {
    "kind": "flow",
    "title": "アクセスではタグなし、トランクではタグ付き",
    "paths": [
      {
        "label": "PC2 → PC4（VLAN 20）",
        "steps": [
          {
            "label": "PC2 → SW1 g0/2",
            "detail": "タグなし。受信ポートの設定からVLAN 20と判断。"
          },
          {
            "label": "SW1 g0/3 → SW2 g0/3",
            "detail": "トランク。VID = 20のタグでVLANを伝える。",
            "tone": "amber"
          },
          {
            "label": "SW2 g0/2 → PC4",
            "detail": "アクセスポート。タグを外して渡す。"
          }
        ]
      }
    ]
  },
  "switch-loop-path": {
    "kind": "flow",
    "title": "2本のリンクでフレームが循環する",
    "paths": [
      {
        "label": "PC1のフレームをSW1がフラッディング",
        "steps": [
          {
            "label": "g0/3からSW2へ",
            "detail": "SW2がフラッディングし、g0/4にも出す。"
          },
          {
            "label": "g0/4からSW1へ戻る",
            "detail": "SW1が再びフラッディングし、g0/3にも出す。"
          },
          {
            "label": "SW2へ再び届く",
            "detail": "同じ循環を繰り返す。",
            "tone": "amber"
          }
        ]
      },
      {
        "label": "もう一方のコピー",
        "steps": [
          {
            "label": "g0/4からSW2へ",
            "detail": "SW2がg0/3にも出す。"
          },
          {
            "label": "g0/3からSW1へ戻る",
            "detail": "SW1がg0/4にも出し、逆回りでも循環する。",
            "tone": "amber"
          }
        ]
      }
    ]
  },
  "lacp-physical-logical": {
    "kind": "flow",
    "title": "2本の物理リンクを、1本の論理リンクにまとめる",
    "paths": [
      {
        "label": "物理 → 論理",
        "steps": [
          {
            "label": "2本のケーブル",
            "detail": "SW1 g0/3 ↔ SW2 g0/3\nSW1 g0/4 ↔ SW2 g0/4"
          },
          {
            "label": "1本のport-channel",
            "detail": "SW1 po1 ↔ SW2 po1",
            "tone": "blue"
          }
        ]
      }
    ]
  },
  "vlan-troubleshooting-steps": {
    "kind": "flow",
    "title": "VLANの通信を確認する順番",
    "paths": [
      {
        "label": "同じVLANの相手に届かない",
        "steps": [
          {
            "label": "両端のアクセスポートは同じVLANか",
            "detail": "show vlan brief"
          },
          {
            "label": "途中のトランクがVLANを通すか",
            "detail": "show interfaces trunk：許可VLAN・ネイティブVLANを確認。"
          },
          {
            "label": "MACアドレスをどこまで学習しているか",
            "detail": "送り手の側から順にshow mac address-table。"
          },
          {
            "label": "途中のポートが止まっていないか",
            "detail": "show spanning-tree（BLK）\nshow etherchannel summary（s / D）"
          }
        ]
      },
      {
        "label": "別のVLANへだけ届かない",
        "steps": [
          {
            "label": "自分のゲートウェイにpingが届くか",
            "detail": "届かなければ、ゲートウェイまでを上の4項目で調べる。"
          },
          {
            "label": "ルータへのポートはトランクか",
            "detail": "L3スイッチの場合も同様。show interfaces trunkで確認。"
          },
          {
            "label": "ゲートウェイのアドレスとVLAN IDは正しいか",
            "detail": "show ip interface brief / show running-config"
          }
        ]
      }
    ]
  },
  "dns-then-connect": {
    "kind": "flow",
    "title": "名前解決してから、そのIPアドレスに接続する",
    "paths": [
      {
        "label": "",
        "steps": [
          {
            "label": "名前解決",
            "detail": "www.example.com のIPアドレスは？ → 203.0.113.80"
          },
          {
            "label": "通信",
            "detail": "203.0.113.80 にTCPで接続して、ページを取ってくる"
          }
        ]
      }
    ]
  },
  "dns-resolution-messages": {
    "kind": "flow",
    "title": "再帰リゾルバが委任をたどって答えを返す",
    "paths": [
      {
        "label": "",
        "steps": [
          {
            "label": "PC1 → RESOLVER",
            "detail": "www.example.comのAは？\nRD=1：最後まで調べて。"
          },
          {
            "label": "RESOLVER → ROOT",
            "detail": "同じ質問。RD=0：知っている範囲で。"
          },
          {
            "label": "ROOT → RESOLVER",
            "detail": "答えは持っていない。comはa.gtld-servers.net（198.51.100.20）へ。",
            "tone": "blue"
          },
          {
            "label": "RESOLVER → TLD",
            "detail": "同じ質問。RD=0。"
          },
          {
            "label": "TLD → RESOLVER",
            "detail": "example.comはns1.example.com（198.51.100.30）へ。",
            "tone": "blue"
          },
          {
            "label": "RESOLVER → AUTH",
            "detail": "同じ質問。RD=0。"
          },
          {
            "label": "AUTH → RESOLVER",
            "detail": "www.example.comのAは203.0.113.80。",
            "tone": "blue"
          },
          {
            "label": "RESOLVER → PC1",
            "detail": "203.0.113.80。",
            "tone": "blue"
          }
        ]
      }
    ]
  },
  "dns-cache-timeline": {
    "kind": "flow",
    "title": "レコードを変えても、キャッシュは期限まで残る",
    "paths": [
      {
        "label": "",
        "steps": [
          {
            "label": "時刻0秒",
            "detail": "PC1がwwwを引く。RESOLVERが203.0.113.80（TTL 300）をキャッシュ。"
          },
          {
            "label": "時刻 100秒",
            "detail": "AUTHで www のAレコードを 203.0.113.90 に変更"
          },
          {
            "label": "時刻 100〜300秒",
            "detail": "RESOLVERは、覚えている 203.0.113.80 を返し続ける（AUTHには聞かない）"
          },
          {
            "label": "時刻 300秒",
            "detail": "キャッシュの期限切れ → 次の問い合わせでAUTHに聞き直し → 203.0.113.90"
          }
        ]
      }
    ]
  },
  "dns-negative-cache-steps": {
    "kind": "flow",
    "title": "委任を直してもNXDOMAINが残る理由",
    "paths": [
      {
        "label": "",
        "steps": [
          {
            "label": "PC1で dig www.example.com",
            "detail": "→ TLDが NXDOMAIN（com ゾーンに委任がまだない）\n→ RESOLVERが「www.example.com はない」を900秒キャッシュ"
          },
          {
            "label": "TLDの com ゾーンに、example.com の委任（NSとglue）を追加"
          },
          {
            "label": "PC1で dig www.example.com",
            "detail": "→ まだ NXDOMAIN！"
          }
        ]
      }
    ]
  },
  "dns-troubleshooting-steps": {
    "kind": "flow",
    "title": "DNSの問題を切り分ける順番",
    "paths": [
      {
        "label": "",
        "steps": [
          {
            "label": "IPアドレスで届くか？",
            "detail": "curl http://203.0.113.80/\n届かない場合：DNSより下の問題（経路・ケーブル・フィルタ）。DNSを調べても直らない。"
          },
          {
            "label": "問い合わせ先は正しいか？",
            "detail": "cat /etc/resolv.conf（再帰リゾルバを指しているか）"
          },
          {
            "label": "再帰リゾルバの答えは？",
            "detail": "dig www.example.com（status・ANSWER・SERVER）"
          },
          {
            "label": "権威DNSサーバーの答えは？",
            "detail": "dig @198.51.100.30 www.example.com（flags に aa）\n3と4が違う場合：キャッシュの問題。TTLかネガティブキャッシュが切れるのを待つ。\n4がおかしい場合：ゾーンの設定の問題。"
          },
          {
            "label": "委任はつながっているか？",
            "detail": "dig +trace www.example.com（どの段で止まったか）"
          }
        ]
      }
    ]
  },
  "dns-migration-timeline": {
    "kind": "flow",
    "title": "DNSの切り替えを時間順に進める",
    "paths": [
      {
        "label": "",
        "steps": [
          {
            "label": "数日前",
            "detail": "TTLを86400から300に下げる。値はまだ203.0.113.80のまま。\n古い「86400」のキャッシュが世界中で切れるのを待つ（最低1日）。"
          },
          {
            "label": "当日",
            "detail": "Aレコードを203.0.113.90に変える。\ndig @権威DNSサーバーとdig（再帰リゾルバ経由）の両方で確かめる。"
          },
          {
            "label": "当日〜",
            "detail": "旧サーバーは、古い答えのキャッシュが消えるまで止めない（最低300秒、余裕をもって）"
          },
          {
            "label": "後日",
            "detail": "問題がなければ、TTLを元の長さに戻す"
          }
        ]
      }
    ]
  },
  "nat-return-translation": {
    "kind": "flow",
    "title": "帰りのパケットをNATテーブルで元のPCへ戻す",
    "paths": [
      {
        "label": "WEB → PC2",
        "steps": [
          {
            "label": "外側で受信",
            "detail": "198.51.100.80:80 → 203.0.113.2:1024"
          },
          {
            "label": "NATテーブルを検索",
            "detail": "Inside global = 203.0.113.2:1024の行を探す。"
          },
          {
            "label": "宛先を戻して転送",
            "detail": "192.168.1.11:49152 → PC2",
            "tone": "blue"
          }
        ]
      }
    ]
  },
  "nat-direction-order": {
    "kind": "flow",
    "title": "向きによってNATと経路検索の順序が変わる",
    "paths": [
      {
        "label": "inside → outside",
        "steps": [
          {
            "label": "受信"
          },
          {
            "label": "経路を決める"
          },
          {
            "label": "送信元を書き換える",
            "detail": "出口がoutsideの場合",
            "tone": "amber"
          },
          {
            "label": "送信"
          }
        ]
      },
      {
        "label": "outside → inside",
        "steps": [
          {
            "label": "受信"
          },
          {
            "label": "宛先を元に戻す",
            "tone": "amber"
          },
          {
            "label": "経路を決める"
          },
          {
            "label": "送信"
          }
        ]
      }
    ]
  },
  "nat-firewall-order": {
    "kind": "flow",
    "title": "NAT・経路・ファイアウォールの処理順",
    "paths": [
      {
        "label": "このシミュレータでの処理",
        "steps": [
          {
            "label": "受信"
          },
          {
            "label": "DNAT",
            "detail": "outside → inside：宛先を戻す。"
          },
          {
            "label": "経路を決める"
          },
          {
            "label": "ファイアウォール",
            "detail": "ルールで許可・拒否を判定。",
            "tone": "amber"
          },
          {
            "label": "SNAT",
            "detail": "inside → outside：送信元を書き換える。"
          },
          {
            "label": "送信"
          }
        ]
      }
    ]
  },
  "nat-connections-walkthrough": {
    "kind": "flow",
    "title": "社内発と社外発の接続を往復で追う",
    "paths": [
      {
        "label": "社内から始める接続：PC1 ↔ WEB",
        "steps": [
          {
            "label": "【PC1 → WEB の SYN】",
            "detail": "192.168.1.10:49152 → 198.51.100.80:80\nFW: 経路を決める → ルール30で許可（接続追跡に記録）→ SNAT：送信元を 203.0.113.2:49152 に"
          },
          {
            "label": "【WEB → PC1 の SYN-ACK】",
            "detail": "198.51.100.80:80 → 203.0.113.2:49152\nFW: 宛先を 192.168.1.10:49152 に戻す → 経路を決める → 接続追跡で ESTABLISHED → 許可"
          }
        ]
      },
      {
        "label": "社外から始める接続：EXT ↔ SRV",
        "steps": [
          {
            "label": "【EXT → SRV の SYN】",
            "detail": "198.51.100.50:49152 → 203.0.113.2:8080\nFW: DNAT：宛先を 192.168.2.80:80 に → 経路を決める → ルール10で許可（接続追跡に記録）"
          },
          {
            "label": "【SRV → EXT の SYN-ACK】",
            "detail": "192.168.2.80:80 → 198.51.100.50:49152\nFW: 経路を決める → 接続追跡で ESTABLISHED → 許可 → 送信元を 203.0.113.2:8080 に戻す"
          }
        ]
      }
    ]
  },
  "linux-check-order": {
    "kind": "flow",
    "title": "下の段から順に確かめる",
    "paths": [
      {
        "label": "NICからアプリまで",
        "steps": [
          {
            "label": "NIC",
            "detail": "差し込み口は有効で、ケーブルの先とつながっているか。"
          },
          {
            "label": "IP",
            "detail": "自分のアドレスは正しいか。"
          },
          {
            "label": "ARP",
            "detail": "同じLANの相手に届くか。"
          },
          {
            "label": "Route",
            "detail": "LANの外への道と帰り道があるか。"
          },
          {
            "label": "DNS",
            "detail": "名前が正しいIPに変わるか。"
          },
          {
            "label": "TCP",
            "detail": "ポートに接続できるか。待ち受け・Firewall。"
          },
          {
            "label": "TLS",
            "detail": "証明書は名前に合っているか。"
          },
          {
            "label": "Application",
            "detail": "アプリが正しく応答しているか。"
          }
        ]
      }
    ]
  },
  "linux-tcp-handshake": {
    "kind": "flow",
    "title": "TCP接続の3回のやり取り",
    "paths": [
      {
        "label": "PC1 ↔ WEB:80",
        "steps": [
          {
            "label": "PC1 → WEB：SYN",
            "detail": "接続したい。"
          },
          {
            "label": "WEB → PC1：SYN-ACK",
            "detail": "いいよ。",
            "tone": "blue"
          },
          {
            "label": "PC1 → WEB：ACK",
            "detail": "了解。"
          }
        ]
      }
    ]
  },
  "office-build-order": {
    "kind": "flow",
    "title": "社内の通信を確かめてから、外への出口を作る",
    "paths": [
      {
        "label": "",
        "steps": [
          {
            "label": "スイッチ",
            "detail": "VLANを作り、ポートに割り当てる（アクセス / トランク）"
          },
          {
            "label": "R1",
            "detail": "VLANごとのGateway（サブインターフェース）"
          },
          {
            "label": "端末",
            "detail": "アドレスとDefault Gateway"
          },
          {
            "label": "社内で確かめる（近いところから順にping）"
          },
          {
            "label": "R1",
            "detail": "インターネットへの出口（Default Route と NAT）"
          },
          {
            "label": "外まで確かめる（ping と traceroute）"
          }
        ]
      }
    ]
  },
  "office-ping-order": {
    "kind": "flow",
    "title": "近い相手から、VLANを越える相手へ",
    "paths": [
      {
        "label": "",
        "steps": [
          {
            "label": "PC1 → PC2（192.168.10.12）",
            "detail": "同じVLAN。SW1の中だけで届く"
          },
          {
            "label": "PC1 → R1（192.168.10.1）",
            "detail": "幹線とSW2のトランクを通って、R1まで届く"
          },
          {
            "label": "PC1 → SRV1（192.168.20.10）",
            "detail": "R1を通って、VLAN 20へ届く"
          }
        ]
      }
    ]
  },
  "lacp-ecmp-structure": {
    "kind": "network",
    "title": "LACPは同じ相手へ、ECMPは複数の次ホップへ",
    "nodes": [
      {
        "id": "sw1",
        "column": 0,
        "row": 0,
        "label": "SW1",
        "detail": "LACP"
      },
      {
        "id": "po1",
        "column": 1,
        "row": 0,
        "label": "po1",
        "detail": "g0/7 ＋ g0/8"
      },
      {
        "id": "sw2",
        "column": 2,
        "row": 0,
        "label": "SW2",
        "detail": "同じ相手"
      },
      {
        "id": "r1",
        "column": 0,
        "row": 2,
        "label": "R1",
        "detail": "ECMP"
      },
      {
        "id": "r2",
        "column": 1,
        "row": 1,
        "label": "R2",
        "detail": "次ホップ1"
      },
      {
        "id": "r3",
        "column": 1,
        "row": 3,
        "label": "R3",
        "detail": "次ホップ2"
      },
      {
        "id": "hq",
        "column": 2,
        "row": 2,
        "label": "本社",
        "detail": ""
      }
    ],
    "links": [
      {
        "from": "sw1",
        "to": "po1",
        "label": "2本を束ねる"
      },
      {
        "from": "po1",
        "to": "sw2",
        "label": "論理的に1本"
      },
      {
        "from": "r1",
        "to": "r2",
        "directed": true
      },
      {
        "from": "r1",
        "to": "r3",
        "directed": true
      },
      {
        "from": "r2",
        "to": "hq",
        "directed": true
      },
      {
        "from": "r3",
        "to": "hq",
        "directed": true
      }
    ]
  },
  "sg-return-path": {
    "kind": "flow",
    "title": "SGは行きの接続を覚え、返事を許可する",
    "paths": [
      {
        "label": "往復",
        "steps": [
          {
            "label": "行き：client → web",
            "detail": "198.51.100.77:50000 → 10.0.1.10:80\nインバウンド「TCP 80 0.0.0.0/0」に一致。許可して記録。"
          },
          {
            "label": "帰り：web → client",
            "detail": "10.0.1.10:80 → 198.51.100.77:50000\n既存の接続への返事として、ルールを見ずに許可。",
            "tone": "blue"
          }
        ]
      }
    ]
  },
  "nacl-missing-return": {
    "kind": "flow",
    "title": "NACLには帰りの許可も必要",
    "paths": [
      {
        "label": "往復",
        "steps": [
          {
            "label": "行き：client → web",
            "detail": "198.51.100.77:50000 → 10.0.1.10:80\nインバウンド100に一致して許可。"
          },
          {
            "label": "帰り：web → client",
            "detail": "10.0.1.10:80 → 198.51.100.77:50000\nアウトバウンドの許可ルールがなく、*で拒否。",
            "tone": "amber"
          }
        ]
      }
    ]
  },
  "aws-web-roundtrip": {
    "kind": "flow",
    "title": "Web公開の行きと帰りで通る場所",
    "paths": [
      {
        "label": "行き",
        "steps": [
          {
            "label": "client"
          },
          {
            "label": "IGW"
          },
          {
            "label": "NACL in"
          },
          {
            "label": "SG in"
          },
          {
            "label": "web:80"
          }
        ]
      },
      {
        "label": "帰り",
        "steps": [
          {
            "label": "web"
          },
          {
            "label": "SG out"
          },
          {
            "label": "NACL out"
          },
          {
            "label": "route table"
          },
          {
            "label": "IGW"
          },
          {
            "label": "client"
          }
        ]
      }
    ]
  },
  "alb-two-connections": {
    "kind": "flow",
    "title": "ALBが接続を受け、別の接続でWebへ渡す",
    "paths": [
      {
        "label": "2つのTCP接続",
        "steps": [
          {
            "label": "接続1：client → ALB",
            "detail": "198.51.100.77:50000 → ALB:443"
          },
          {
            "label": "接続2：ALB → web",
            "detail": "ALBのプライベートIP:別のポート → 10.0.1.10:80",
            "tone": "blue"
          }
        ]
      }
    ]
  },
  "vpc-peering-path": {
    "kind": "network",
    "title": "ピアリングの両側に経路を設定する",
    "nodes": [
      {
        "id": "path",
        "column": 0,
        "row": 0,
        "label": "path-vpc",
        "detail": "10.0.0.0/16"
      },
      {
        "id": "pcx",
        "column": 1,
        "row": 0,
        "label": "pcx-1a2b3c4d",
        "detail": "VPC Peering"
      },
      {
        "id": "shared",
        "column": 2,
        "row": 0,
        "label": "shared-vpc",
        "detail": "10.1.0.0/16"
      }
    ],
    "links": [
      {
        "from": "path",
        "to": "pcx",
        "label": "public-rt：10.1.0.0/16 → pcx-1a2b3c4d"
      },
      {
        "from": "pcx",
        "to": "shared",
        "label": "shared側：10.0.0.0/16 → pcx-1a2b3c4d"
      }
    ]
  },
  "aws-troubleshooting-steps": {
    "kind": "flow",
    "title": "AWSの通信を調べる順番",
    "paths": [
      {
        "label": "",
        "steps": [
          {
            "label": "宛先",
            "detail": "パブリックIP / Elastic IP があるか、DNSの名前がそのアドレスを指しているか"
          },
          {
            "label": "出入口",
            "detail": "IGWがアタッチされているか、NAT Gateway に Elastic IP があるか、ピアリングは承認済みか"
          },
          {
            "label": "経路",
            "detail": "行きと帰りの両方のルートテーブル（サブネットへの関連付けも含めて）"
          },
          {
            "label": "NACL",
            "detail": "インバウンドとアウトバウンドの両方（帰りのエフェメラルポート）"
          },
          {
            "label": "SG",
            "detail": "受ける側のインバウンド、始める側のアウトバウンド"
          },
          {
            "label": "OS",
            "detail": "そのポートで待ち受けているか、OSのファイアウォール"
          }
        ]
      }
    ]
  },
  "vpn-missing-route": {
    "kind": "flow",
    "title": "トンネルなしでは内側のIP宛てに届かない",
    "paths": [
      {
        "label": "宛先：10.0.1.10",
        "steps": [
          {
            "label": "PC1"
          },
          {
            "label": "CGW"
          },
          {
            "label": "INETで止まる",
            "detail": "Network unreachable：宛先への経路がない。",
            "tone": "amber"
          }
        ]
      }
    ]
  },
  "ike-negotiation-steps": {
    "kind": "flow",
    "title": "IKEで合意と鍵を作り、ESPでデータを運ぶ",
    "paths": [
      {
        "label": "",
        "steps": [
          {
            "label": "CGW → VGW1",
            "detail": "IKE（UDP 500） 「aes256-sha256 が使えます」"
          },
          {
            "label": "VGW1 → CGW",
            "detail": "IKE 「では aes256-sha256 で」"
          },
          {
            "label": "CGW ⇔ VGW1",
            "detail": "IKE PSKを使って、互いに本物かを確かめる → IKE SA ができる"
          },
          {
            "label": "CGW ⇔ VGW1",
            "detail": "IKE データ用の鍵とSPIを決める → IPsec SA ができる（行き・帰り）"
          },
          {
            "label": "CGW ⇔ VGW1",
            "detail": "ESP（50） データを暗号化して運ぶ"
          }
        ]
      }
    ]
  },
  "bgp-session-steps": {
    "kind": "flow",
    "title": "TCP接続からBGPの経路交換へ",
    "paths": [
      {
        "label": "",
        "steps": [
          {
            "label": "CGW → VGW1",
            "detail": "TCP 179 の接続を作る"
          },
          {
            "label": "CGW ⇔ VGW1",
            "detail": "OPEN 「AS 65000 です」「AS 64512 です」"
          },
          {
            "label": "CGW ⇔ VGW1",
            "detail": "KEEPALIVE 「了解」 → Established"
          },
          {
            "label": "CGW ⇔ VGW1",
            "detail": "UPDATE 経路を伝え合う（次のページ）"
          },
          {
            "label": "CGW ⇔ VGW1",
            "detail": "KEEPALIVE 一定の間隔で「まだいます」"
          }
        ]
      }
    ]
  },
  "bgp-advertisement-direction": {
    "kind": "flow",
    "title": "経路の広告と、データの向きは逆",
    "paths": [
      {
        "label": "経路を知らせる",
        "steps": [
          {
            "label": "VGW1 → CGW",
            "detail": "10.0.1.0/24は私へ。"
          }
        ]
      },
      {
        "label": "その経路で通信する",
        "steps": [
          {
            "label": "CGW → VGW1",
            "detail": "10.0.1.10宛てのパケット。",
            "tone": "blue"
          }
        ]
      }
    ]
  },
  "bgp-as-path-growth": {
    "kind": "flow",
    "title": "広告するたびに、自分のASNを先頭に足す",
    "paths": [
      {
        "label": "10.0.1.0/24の広告",
        "steps": [
          {
            "label": "VGW1（AS 64512）→ CGW（AS 65000）",
            "detail": "AS_PATH：64512"
          },
          {
            "label": "CGW（AS 65000）→ 支社（AS 65010）",
            "detail": "AS_PATH：65000 64512",
            "tone": "blue"
          }
        ]
      }
    ]
  },
  "vpn-return-failover": {
    "kind": "flow",
    "title": "帰りもVGW2とtunnel2を経由する",
    "paths": [
      {
        "label": "EC2 → PC1",
        "steps": [
          {
            "label": "EC2"
          },
          {
            "label": "VGW1",
            "detail": "iBGPの経路を使用。"
          },
          {
            "label": "VGW2",
            "detail": "tunnel2へ送る。"
          },
          {
            "label": "CGW"
          },
          {
            "label": "PC1"
          }
        ]
      }
    ]
  },
  "terraform-command-order": {
    "kind": "flow",
    "title": "ファイルから実行までの基本手順",
    "paths": [
      {
        "label": "",
        "steps": [
          {
            "label": "ファイルを書く",
            "detail": "完成した状態を定義する。"
          },
          {
            "label": "terraform init",
            "detail": "準備する。最初に1回。"
          },
          {
            "label": "terraform fmt",
            "detail": "書式を整える。任意。"
          },
          {
            "label": "terraform validate",
            "detail": "書き間違いがないか確かめる。"
          },
          {
            "label": "terraform plan",
            "detail": "何が起きるかの予告を読む。",
            "tone": "amber"
          },
          {
            "label": "terraform apply",
            "detail": "予告を確かめて実行する。"
          }
        ]
      }
    ]
  },
  "terraform-state-mapping": {
    "kind": "flow",
    "title": "ファイル・state・実物を対応付ける",
    "paths": [
      {
        "label": "対応関係（処理の順序ではありません）",
        "steps": [
          {
            "label": "ファイル：あるべき姿",
            "detail": "resource \"aws_vpc\" \"main\"\ncidr_block = 10.0.0.0/16"
          },
          {
            "label": "state：Terraformの記録",
            "detail": "aws_vpc.main ↔ vpc-09e3779b1\ncidr_block = 10.0.0.0/16",
            "tone": "blue"
          },
          {
            "label": "AWS：実物",
            "detail": "vpc-09e3779b1\n10.0.0.0/16"
          }
        ]
      }
    ]
  },
  "terraform-plan-steps": {
    "kind": "flow",
    "title": "planは記録・実物・ファイルを照合する",
    "paths": [
      {
        "label": "",
        "steps": [
          {
            "label": "state を読み、「自分が管理している実物」の一覧（IDの一覧）を得る"
          },
          {
            "label": "その実物をAWSに問い合わせて、いまの設定を読み直す"
          },
          {
            "label": "ファイル（あるべき姿）と、読み直した実物を比べる"
          },
          {
            "label": "差があるところだけを、予告に載せる"
          }
        ]
      }
    ]
  },
  "terraform-plan-review-steps": {
    "kind": "flow",
    "title": "削除と置換を見落とさない読み順",
    "paths": [
      {
        "label": "",
        "steps": [
          {
            "label": "最後の Plan",
            "detail": "の行を見る destroy が 0 でなければ、何かが消える"
          },
          {
            "label": "-/+ と - の見出しを数える",
            "detail": "どのリソースが消える・作り直されるか"
          },
          {
            "label": "# forces replacement を探す",
            "detail": "どの引数の変更が、作り直しの原因か"
          },
          {
            "label": "波及を確かめる",
            "detail": "その上で動いているもの（EC2、データ）に何が起きるか"
          }
        ]
      }
    ]
  },
  "terraform-workflow-summary": {
    "kind": "flow",
    "title": "定義・確認・適用のサイクル",
    "paths": [
      {
        "label": "",
        "steps": [
          {
            "label": "ファイルを書く",
            "detail": "HCLのブロックと引数。resource \"aws_vpc\" \"main\" → aws_vpc.main"
          },
          {
            "label": "init",
            "detail": "プロバイダを用意する。"
          },
          {
            "label": "validate",
            "detail": "書き方を点検する。AWSには問い合わせない。"
          },
          {
            "label": "plan",
            "detail": "state・実物・ファイルを比べて予告を表示。\n+ 作成 / ~ その場で変更 / -/+ 作り直し / - 削除",
            "tone": "amber"
          },
          {
            "label": "apply",
            "detail": "予告を承認して実行。stateにアドレス ↔ IDを記録する。"
          }
        ]
      }
    ]
  },
  "vlsm-allocation-order": {
    "kind": "flow",
    "title": "大きなLANから、境目をそろえて割り当てる",
    "paths": [
      {
        "label": "",
        "steps": [
          {
            "label": "営業LAN /26（64個）",
            "detail": ".0 から置ける（0 は64の倍数） → .0 〜 .63"
          },
          {
            "label": "開発LAN /27（32個）",
            "detail": "次の空きは .64（32の倍数） → .64 〜 .95"
          },
          {
            "label": "総務LAN /28（16個）",
            "detail": "次の空きは .96（16の倍数） → .96 〜 .111"
          },
          {
            "label": "リンク",
            "detail": "/30（4個） 次の空きは .112（4の倍数） → .112 〜 .115"
          },
          {
            "label": "残り",
            "detail": ".116 〜 .255（将来のために空けておく）"
          }
        ]
      }
    ]
  },
  "vlsm-gap-allocation": {
    "kind": "flow",
    "title": "小さいLANから置くと、すき間ができる",
    "paths": [
      {
        "label": "",
        "steps": [
          {
            "label": "総務LAN",
            "detail": "/28 .0 〜 .15"
          },
          {
            "label": "開発LAN",
            "detail": "/27 次の空きは .16 …… でも .16 は32の倍数ではない\n16 AND 224 = 0 → 「.16 から始まる /27」は .0 〜 .31 になり、総務LANと重なる\n→ 32の倍数の .32 まで飛ばす → .32 〜 .63\n→ .16 〜 .31 がすき間として残る"
          },
          {
            "label": "営業LAN",
            "detail": "/26 次の空きは .64（64の倍数） → .64 〜 .127"
          }
        ]
      }
    ]
  },
  "ipv6-groups": {
    "kind": "packet",
    "title": "IPv6は16ビットのグループが8つ",
    "rows": [
      {
        "label": "2001:0db8:0000:0000:0000:0000:0000:0001",
        "fields": [
          {
            "label": "第1グループ",
            "detail": "2001 / 16ビット"
          },
          {
            "label": "第2グループ",
            "detail": "0db8 / 16ビット"
          },
          {
            "label": "第3グループ",
            "detail": "0000 / 16ビット"
          },
          {
            "label": "第4グループ",
            "detail": "0000 / 16ビット"
          },
          {
            "label": "第5グループ",
            "detail": "0000 / 16ビット"
          },
          {
            "label": "第6グループ",
            "detail": "0000 / 16ビット"
          },
          {
            "label": "第7グループ",
            "detail": "0000 / 16ビット"
          },
          {
            "label": "第8グループ",
            "detail": "0001 / 16ビット"
          }
        ]
      }
    ],
    "note": "16ビット × 8グループ = 128ビット"
  },
  "ipv6-abbreviation": {
    "kind": "flow",
    "title": "IPv6の0を省略する",
    "paths": [
      {
        "label": "",
        "steps": [
          {
            "label": "元の形",
            "detail": "2001:0db8:0000:0000:0000:0000:0000:0001"
          },
          {
            "label": "各グループの先頭の0を省く",
            "detail": "2001:db8:0:0:0:0:0:1"
          },
          {
            "label": "0の連続を :: にする",
            "detail": "2001:db8::1"
          }
        ]
      }
    ]
  },
  "capture-tcp-timeline": {
    "kind": "flow",
    "title": "キャプチャの番号でTCPの往復を追う",
    "paths": [
      {
        "label": "PC1 192.168.1.10:49153 ↔ WEB 192.168.2.80:80",
        "steps": [
          {
            "label": "No.7 PC1 → WEB：SYN",
            "detail": "Seq=3310558080"
          },
          {
            "label": "No.8 WEB → PC1：SYN, ACK",
            "detail": "Seq=1222621274 / Ack=3310558081",
            "tone": "blue"
          },
          {
            "label": "No.9 PC1 → WEB：ACK",
            "detail": "Seq=3310558081 / Ack=1222621275"
          },
          {
            "label": "No.10 PC1 → WEB：PSH, ACK",
            "detail": "Seq=3310558081 / Len=91（GET）"
          },
          {
            "label": "No.11 WEB → PC1：PSH, ACK",
            "detail": "Seq=1222621275 / Ack=3310558172 / Len=140（200 OK）",
            "tone": "blue"
          },
          {
            "label": "No.12 PC1 → WEB：ACK",
            "detail": "Seq=3310558172 / Ack=1222621415"
          },
          {
            "label": "No.13 PC1 → WEB：FIN, ACK",
            "detail": "Seq=3310558172"
          },
          {
            "label": "No.14 WEB → PC1：FIN, ACK",
            "detail": "Seq=1222621415 / Ack=3310558173",
            "tone": "blue"
          },
          {
            "label": "No.15 PC1 → WEB：ACK",
            "detail": "Seq=3310558173 / Ack=1222621416"
          }
        ]
      }
    ]
  }
};
