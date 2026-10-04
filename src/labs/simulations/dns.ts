import { dnsScenario } from '../../simulator/scenarios/chapters';
import type { NetworkSimulator } from '../../simulator/core/NetworkSimulator';
import type { DnsRecord, DnsType } from '../../simulator/core/types';
import { networkSimulation } from '../simulation';

const AUTH = '198.51.100.30';
/** Answer records PC1 gets: through its resolver, or straight from `server` (no cache in between). */
const answer = (n: NetworkSimulator, name: string, type: DnsType = 'A', server?: string) => n.dnsLookup('PC1', name, type, { server }).message?.answer ?? [];
const has = (records: DnsRecord[], type: DnsType, value: string) => records.some(r => r.type === type && r.value === value);
const add = (id: string, ...records: DnsRecord[]) => (n: NetworkSimulator) => n.update(id, d => { d.dnsServer!.zones[0].records.push(...records); });

/** Chapter 5: the DNS servers of the chapter's network exist, but almost nothing is registered and PC1 has no resolver. */
export const dnsSimulation = networkSimulation({
  id: 'sim-dns', chapter: 'dns', minutes: 35,
  title: '名前を登録し、委任をつないで、名前で届くようにする',
  mission: 'AUTHにレコードを書き、PC1の問い合わせ先をRESOLVERにし、TLDから委任して、PC1から http://www.example.com/ を名前で開けるようにする。最後にキャッシュとTTLの動きを確かめる',
  brief: [
    'Theoryの「例のネットワーク」と同じ構成です。配線・IPアドレス・経路は設定済みで、IPアドレスを指定すればPC1からWEBのページを取れます。ただし、名前ではまだ届きません。',
    '```text\n PC1      192.168.1.10 ─┐                         ┌─ ROOT 198.51.100.10（ルートゾーン）\n                        SW1 ── R1 ── ISP ── SW2 ──┼─ TLD  198.51.100.20（com）\n RESOLVER 192.168.1.53 ─┘              │          └─ AUTH 198.51.100.30（example.com）\n （再帰リゾルバ）                      └─ WEB 203.0.113.80\n```',
    '開始時の状態:\n\n- PC1: 問い合わせ先（/etc/resolv.conf）が空\n- AUTH: `example.com` ゾーンにはSOA・NS・`ns1.example.com` のAレコードだけ\n- TLD: `com` ゾーンに、`example.com` の委任がない\n- RESOLVER・ROOT: 設定済み（RESOLVERは社内からの再帰を引き受け、ルートヒントは ROOT）',
    'Theoryの順に、①権威DNSサーバーに名前を書く → ②PCの問い合わせ先を再帰リゾルバにする → ③親ゾーンから委任する → ④キャッシュとTTLを観察する → ⑤CNAME・MX・逆引き → ⑥TTLを下げる、と進めます。ゾーンの編集は、サーバーを選んで「機器設定」の「DNSサーバー（ゾーン）」で行います（Terminalからは編集できません）。',
  ].join('\n\n'),
  source: 'PC1', target: '203.0.113.80',
  build: () => {
    const n = dnsScenario();
    n.update('PC1', d => { d.dnsServers = undefined; });
    n.update('TLD', d => { const z = d.dnsServer!.zones[0]; z.records = z.records.filter(r => !r.name.endsWith('example.com.')); });
    n.update('AUTH', d => { const z = d.dnsServer!.zones[0]; z.records = z.records.filter(r => r.type === 'SOA' || r.type === 'NS' || r.name === 'ns1.example.com.'); });
    return n;
  },
  sim: [
    { title: 'IPアドレスと名前で、ページを取り比べる',
      body: 'PC1のTerminalで、WEBのページをIPアドレスと名前の両方で取ってみます（Theory「名前で呼びたい」）。\n\n```text\ncurl http://203.0.113.80/\ncurl http://www.example.com/\ncat /etc/resolv.conf\n```\n\nIPアドレスなら表示され、名前だと失敗するはずです。',
      quiz: { question: '`curl http://www.example.com/` の結果（`curl: (6) Could not resolve host`）から言えることはどれですか？', options: ['名前をIPアドレスに変えられず、通信を始める前に止まった（DNSの問題）', 'WEBまでの経路がなく、パケットが途中で捨てられた', 'WEBが80番ポートで待ち受けていない'], answer: 0, explanation: 'IPアドレスを指定すれば同じWEBからページが返るので、経路もWEBのサービスも正常です。「Could not resolve host」は、名前解決に失敗して、通信を始める前に止まったことを表します。PC1には、まだ問い合わせ先（/etc/resolv.conf の nameserver）がありません。' } },
    { title: 'AUTHに、www.example.com のAレコードを登録する',
      body: 'AUTH（198.51.100.30）は `example.com` ゾーンの権威DNSサーバーです。いまはSOA・NS・`ns1.example.com` しかないので、`www.example.com` のAレコードを書きます（Theory「ゾーンと権威DNSサーバー」）。\n\n```text\nwww.example.com.   300   IN   A   203.0.113.80\n```\n\n- GUI: AUTHを選び、「機器設定」→「DNSサーバー（ゾーン）」でゾーン `example.com.` に、名前 `www`・型 `A`・TTL `300`・値 `203.0.113.80` を入れて「レコードを追加」\n- 確認: PC1のTerminalで、AUTHに直接聞きます（PC1にはまだ問い合わせ先がないので `@` で相手を指定します）\n\n```text\ndig @198.51.100.30 www.example.com\n```\n\nANSWER SECTION に `203.0.113.80` が出れば完了です。',
      hints: ['名前の欄には `www` だけを書きます。ゾーン名が補われて `www.example.com.` になります。', '`dig www.example.com`（`@` なし）は、問い合わせ先がないので失敗します。`@198.51.100.30` を付けます。'],
      check: n => has(answer(n, 'www.example.com', 'A', AUTH), 'A', '203.0.113.80'),
      solve: add('AUTH', { name: 'www.example.com.', type: 'A', ttl: 300, value: '203.0.113.80' }) },
    { title: '権威DNSサーバーの答えを読む',
      body: 'PC1で、AUTHの答えのフラグを読みます（Theory「1問ずつたどる」）。`+norec` を付けると、再帰リゾルバと同じく「知っている範囲で答えて」（RDなし）と聞けます。\n\n```text\ndig @198.51.100.30 www.example.com\ndig +norec @198.51.100.30 www.example.com\n```\n\n`flags:` の行と、その下の `WARNING` の行を比べましょう。',
      quiz: { question: '`dig @198.51.100.30 www.example.com` の flags に `aa` があり、`WARNING: recursion requested but not available` と出ました。正しい読み方はどれですか？', options: ['AUTHは example.com の権威DNSサーバー本人として答えた。再帰（ほかのサーバーへ聞いて回ること）は引き受けない', 'AUTHは再帰リゾルバで、キャッシュから答えた', '答えが間違っている可能性が高い'], answer: 0, explanation: '`aa` は、そのゾーンの権威DNSサーバー本人の答えの印です。WARNINGは、dig が既定で付けるRD（再帰の希望）に対して、AUTHが `ra` を返さなかった（再帰を引き受けない）ことを表します。AUTHが答えるのは自分のゾーンの名前だけです。`+norec` で聞くとRDを付けないので、WARNINGは出ません。' } },
    { title: 'PC1の問い合わせ先を、RESOLVERにする',
      body: 'PCのスタブリゾルバが頼む相手は、代わりに調べて回ってくれる再帰リゾルバ RESOLVER（192.168.1.53）です（Theory「名前解決の登場人物」）。\n\n- GUI: PC1を選び、「機器設定」→「DNSクライアント（/etc/resolv.conf）」に `192.168.1.53` を入れて適用\n- CLI: PC1のTerminalで\n\n```text\necho "nameserver 192.168.1.53" > /etc/resolv.conf\ncat /etc/resolv.conf\n```\n\n設定したら、名前を引いてみます。まだ失敗するはずです。どこで止まるかを `+trace` で確かめましょう。\n\n```text\ndig www.example.com\ndig +trace www.example.com\n```',
      hints: ['AUTH（198.51.100.30）やROOT（198.51.100.10）を書くのは誤りです。どちらも再帰を引き受けないので、ほとんどの名前が引けません。'],
      check: n => n.device('PC1').dnsServers?.[0] === '192.168.1.53',
      solve: n => n.update('PC1', d => { d.dnsServers = ['192.168.1.53']; }),
      quiz: { question: '`dig www.example.com` は `status: NXDOMAIN` でした。`dig +trace www.example.com` で、「その名前は存在しない」と答えたのはどのサーバーですか？', options: ['ROOT（198.51.100.10）', 'TLD（198.51.100.20）', 'AUTH（198.51.100.30）', 'RESOLVER（192.168.1.53）'], answer: 1, explanation: 'ROOTは「com は a.gtld-servers.net（TLD）へ」と委任の応答を返しました。ところがTLDの `com` ゾーンには、`example.com` の委任（NSレコード）がありません。TLDは「example.com という枝はない」と判断し、権威を持ってNXDOMAINを返します。AUTHには、まだ誰もたどり着けません。' } },
    { title: 'TLDに、example.com の委任とglueを書く',
      body: '親ゾーン `com`（TLD）に、子ゾーン `example.com` のNSレコードと、ネームサーバーのアドレス（glue）を書きます（Theory「委任とglue」）。\n\n```text\nexample.com.       172800  IN  NS  ns1.example.com.\nns1.example.com.   172800  IN  A   198.51.100.30\n```\n\n- GUI: TLDを選び、「DNSサーバー（ゾーン）」でゾーン `com.` に2行を追加。名前は `example.com.`・`ns1.example.com.` とFQDNで書きます\n- 確認: PC1で `dig +trace www.example.com`（Referral → Referral → Answer）\n\n続けて PC1 で `dig www.example.com` を実行すると、まだ NXDOMAIN が返るはずです（理由は下の問い）。RESOLVERのTerminalでキャッシュを見てから消し、もう一度確かめます。\n\n```text\nrndc dumpdb -cache\nrndc flush\n```\n\n最後に PC1 で `curl http://www.example.com/` を実行し、名前でページが開けば完成です。',
      hints: ['名前の欄に `ns1.example` と書くと、ドットを含むのでそのまま `ns1.example.` という別の名前になります。`ns1.example.com.` まで書きます。', 'glue（`ns1.example.com` のAレコード）がないと、RESOLVERは ns1.example.com のIPアドレスを知る方法がなく、SERVFAILになります。', 'このステップの判定はキャッシュのない状態で行います。判定が通ってもPC1の dig が NXDOMAIN のままなら、RESOLVERのキャッシュが原因です。'],
      check: n => n.dnsLookup('PC1', 'www.example.com', 'A', { trace: true }).success && n.http('PC1', 'http://www.example.com/').status === 200,
      solve: add('TLD', { name: 'example.com.', type: 'NS', ttl: 172800, value: 'ns1.example.com.' }, { name: 'ns1.example.com.', type: 'A', ttl: 172800, value: '198.51.100.30' }),
      quiz: { question: '委任を書いた直後、PC1の `dig www.example.com` は、まだ `status: NXDOMAIN` で Query time も短いままでした。なぜですか？', options: ['RESOLVERが、前のステップで受け取った「ない」という答えをキャッシュしているから（ネガティブキャッシュ）', 'TLDのゾーンの変更が、世界中に伝わるまで1日かかるから', 'PC1が前回の答えを覚えているから'], answer: 0, explanation: '否定の答えもキャッシュされます。覚えておく時間は、TLDが返したSOAのTTLとSOAの最後の数字の小さいほう（ここではどちらも900秒）です。RESOLVERの `rndc dumpdb -cache` に `www.example.com. A NXDOMAIN` が見えます。`rndc flush` で消すか、`sleep 900` で時間を進めると、新しい委任をたどって答えが返ります（このシミュレータでは、PC1は答えをキャッシュしません）。' } },
    { title: 'キャッシュのTTLが減るのを確かめる',
      body: 'PC1で同じ名前を続けて引き、`Query time` とTTLを比べます。`sleep` は仮想時間を進めるコマンドです（Theory「キャッシュとTTL」）。\n\n```text\ndig www.example.com\ndig www.example.com\nsleep 60\ndig www.example.com\n```\n\nRESOLVERの `rndc dumpdb -cache` で、委任の応答（`com.` や `example.com.` のNS）も覚えていることを確かめましょう。',
      quiz: { question: '`dig` → `sleep 60` → `dig` と実行しました。2回目の ANSWER SECTION のTTLはいくつでしたか？（1回目は300）', options: ['300（AUTHが書いたとおりの値が毎回返る）', '240（RESOLVERのキャッシュの残り時間）', '60（sleepした秒数）'], answer: 1, explanation: 'RESOLVERは答えをTTLの300秒だけキャッシュし、キャッシュから返すときは残り時間を返します。60秒たったので240です。0になると、RESOLVERは答えを忘れ、次の問い合わせでAUTHに聞き直します。2回目以降は Query time も短くなっています。' } },
    { title: 'shop.example.com を、CNAMEで www の別名にする',
      body: 'ショップ用の名前 `shop.example.com` を、`www.example.com` の別名として作ります（Theory「いろいろなレコード」）。WEBを引っ越すときは、`www` のAレコードを1か所直すだけで済みます。\n\n- GUI: AUTHの「DNSサーバー（ゾーン）」に、名前 `shop`・型 `CNAME`・TTL `300`・値 `www.example.com.`\n- 確認: PC1で\n\n```text\ndig shop.example.com\ncurl http://shop.example.com/\n```\n\nANSWER SECTION に、CNAMEの行とAの行の2行が出れば完了です。',
      hints: ['値は正式な名前 `www.example.com.` です。IPアドレスではありません。', 'CNAMEを置いた名前には、Aレコードなどほかのレコードを同時に置けません。', '追加する前に shop.example.com を引いていた場合、RESOLVERに NXDOMAIN が300秒キャッシュされています。RESOLVERで `rndc flush` を実行します。'],
      check: n => { const a = answer(n, 'shop.example.com'); return has(a, 'CNAME', 'www.example.com.') && has(a, 'A', '203.0.113.80'); },
      solve: add('AUTH', { name: 'shop.example.com.', type: 'CNAME', ttl: 300, value: 'www.example.com.' }) },
    { title: 'メールの届け先（MX）を登録する',
      body: '`user@example.com` 宛てのメールを、メールサーバー `mail.example.com`（203.0.113.25）で受け取るようにします。MXの値はホスト名なので、そのAレコードも書きます。\n\n```text\nexample.com.        3600  IN  MX  10 mail.example.com.\nmail.example.com.   3600  IN  A   203.0.113.25\n```\n\n- GUI: AUTHの「DNSサーバー（ゾーン）」に、名前 `@`・型 `MX`・TTL `3600`・値 `10 mail.example.com.` と、名前 `mail`・型 `A`・TTL `3600`・値 `203.0.113.25`\n- 確認: PC1で\n\n```text\ndig example.com MX\ndig mail.example.com\n```',
      hints: ['MXの名前は、メールアドレスの `@` の右側（example.com）です。名前の欄に `@` と書くと、ゾーンの頂点 `example.com.` になります。', '値は「優先度 ホスト名」の形で `10 mail.example.com.` と書きます。IPアドレスは書けません。'],
      check: n => has(answer(n, 'example.com', 'MX'), 'MX', '10 mail.example.com.') && has(answer(n, 'mail.example.com'), 'A', '203.0.113.25'),
      solve: add('AUTH', { name: 'example.com.', type: 'MX', ttl: 3600, value: '10 mail.example.com.' }, { name: 'mail.example.com.', type: 'A', ttl: 3600, value: '203.0.113.25' }) },
    { title: 'PC1のアドレスを逆引きする',
      body: 'IPアドレスから名前を調べます（Theory「逆引きとPTR」）。社内のアドレスの逆引きゾーン `1.168.192.in-addr.arpa.` は、RESOLVERが自分で持っています（RESOLVERの「DNSサーバー（ゾーン）」で確かめられます）。\n\n```text\ndig -x 192.168.1.10\nnslookup 192.168.1.10\n```',
      quiz: { question: '`dig -x 192.168.1.10` の QUESTION SECTION と ANSWER SECTION の組み合わせとして正しいものはどれですか？', options: ['`10.1.168.192.in-addr.arpa.` の PTR を聞き、`pc1.corp.example.` が返る', '`192.168.1.10.in-addr.arpa.` の A を聞き、`www.example.com.` が返る', '`pc1.corp.example.` の PTR を聞き、`192.168.1.10` が返る'], answer: 0, explanation: '逆引きでは、IPv4の4つの数字を逆に並べて `in-addr.arpa` を付けた名前のPTRレコードを聞きます。数字を逆にするのは、右ほど大きな範囲を表すドメイン名の木と向きをそろえるためです。RESOLVERはこのゾーンの権威DNSサーバーでもあるので、答えに `aa` も付いています。' } },
    { title: 'TTLを下げて、キャッシュとの違いを確かめる',
      body: 'WEBの引っ越しに備えて、`www.example.com` のTTLを300から60に下げます（Theory「レコードを安全に変える」）。次の順で進めます。\n\n1. PC1で `dig www.example.com`（RESOLVERにTTL 300の答えを覚えさせる）\n2. AUTHの「DNSサーバー（ゾーン）」で、`www.example.com.` のAレコードを ✕ で削除し、名前 `www`・型 `A`・TTL `60`・値 `203.0.113.80` で追加し直す\n3. PC1で2つを比べる\n\n```text\ndig @198.51.100.30 www.example.com\ndig www.example.com\n```',
      hints: ['レコードは直接編集できないので、古い行を ✕ で削除してから追加し直します。古い行を残すと、TTLの違う同じレコードが2行になります。', '先に RESOLVER のキャッシュが切れていると（`sleep` で300秒以上進めた、`rndc flush` した）、両方とも60に見えます。そのときは手順1からやり直します。'],
      check: n => { const a = answer(n, 'www.example.com', 'A', AUTH).filter(r => r.type === 'A'); return a.length === 1 && a[0].value === '203.0.113.80' && a[0].ttl === 60; },
      solve: n => n.update('AUTH', d => { d.dnsServer!.zones[0].records.find(r => r.name === 'www.example.com.' && r.type === 'A')!.ttl = 60; }),
      quiz: { question: 'TTLを60に変えた直後、2つの dig のTTLはどう見えましたか？', options: ['`dig @198.51.100.30` は60、`dig`（RESOLVER経由）は古い300のまま（または300からの残り時間）', '両方とも60', '両方とも300'], answer: 0, explanation: 'AUTHは書いたとおりの60を返します。RESOLVERは、変更前に覚えた答えをTTLの値ごとキャッシュしているので、古い300の残り時間を返します。TTLを下げる変更も、古いTTLの間は伝わりません。だから実際の引っ越しでは、値を変える前に、古いTTL以上の時間をあけて、先にTTLだけを下げておきます。' } },
  ],
  debrief: '権威DNSサーバーにレコードを書く → PCは再帰リゾルバに頼む → 親ゾーンのNSとglueで委任をつなぐ、の3つがそろって、初めて名前で届くようになりました。そして答えは、肯定も否定もTTLの間キャッシュに残ります。「直したのに反映されない」ときは、`dig @権威DNSサーバー` と再帰リゾルバ経由の答えを比べるのが第一歩です。',
});
