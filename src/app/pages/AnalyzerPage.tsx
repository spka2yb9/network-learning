import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { completeLab, lab } from '../../application/LabController';
import { labById } from '../../labs';
import type { CaptureLab } from '../../labs/types';
import { decodeFrame } from '../../simulator/capture/decode';
import { parsePcap, PCAP_LIMITS } from '../../simulator/capture/pcap';
import { dnsScenario } from '../../simulator/scenarios/chapters';
import { useUI } from '../../stores/ui';
import PacketViewer, { type PacketRow } from '../../components/PacketViewer/PacketViewer';
import LabBrief from '../../components/Lab/LabBrief';
import { Icon } from '../../components/Icon';

const toRows = (frames: { time: number; bytes: number[]; packet?: PacketRow['packet'] }[]): PacketRow[] => frames.map((f, i) => ({ ...decodeFrame(f.bytes).summary, id: i + 1, time: f.time, bytes: f.bytes, packet: f.packet }));
const sample = () => { const n = dnsScenario(); return [...n.dnsLookup('PC1', 'www.example.com').captures, ...n.http('PC1', 'https://www.example.com/').captures]; };

function CaseRunner({ def }: { def: CaptureLab }) {
  useUI(s => s.revision);
  const [index, setIndex] = useState(0);
  const c = def.cases[index];
  const built = useMemo(() => c.build(), [c]);
  const rows = useMemo(() => toRows(built.captures), [built]);
  const key = `cap:${def.id}:${c.id}`;
  const saved = lab.quizzes.get(key);
  const [choice, setChoice] = useState<number>(); const [evidence, setEvidence] = useState('');
  useEffect(() => { setChoice(undefined); setEvidence(''); }, [index]);
  const allDone = def.cases.every(x => lab.quizzes.get(`cap:${def.id}:${x.id}`)?.correct);
  useEffect(() => { if (allDone) void completeLab(def.id); }, [allDone]);
  const check = () => {
    const row = rows.find(r => r.id === Number(evidence));
    const ok = choice === c.answer && !!row && c.evidence(built.captures[row.id - 1]);
    void lab.answerQuiz(key, choice ?? -1, ok);
  };
  return <div className="case-runner">
    <div className="case-tabs">{def.cases.map((x, i) => <button key={x.id} className={i === index ? 'active' : ''} onClick={() => setIndex(i)}>{lab.quizzes.get(`cap:${def.id}:${x.id}`)?.correct ? <Icon name="check" size={13}/> : null}{x.title}</button>)}</div>
    <div className="case-question"><p className="tiny muted">キャプチャの取り方: <code>{built.note}</code></p><strong>{c.question}</strong>
      <div className="diagnosis-options">{c.options.map((o, i) => <button key={o} className={`quiz-option ${choice === i ? 'selected' : ''}`} onClick={() => setChoice(i)}><span>{String.fromCharCode(65 + i)}</span>{o}</button>)}</div>
      <label className="evidence">{c.evidenceHint}<input aria-label="根拠のパケット番号" inputMode="numeric" value={evidence} onChange={e => setEvidence(e.target.value)} placeholder="No."/></label>
      <button className="button small" disabled={choice === undefined || !evidence} onClick={check}>判定する<Icon name="check" size={14}/></button>
      {saved && <p className={saved.correct ? 'success-text' : 'error-text'}>{saved.correct ? `正解。${c.explanation}` : '原因の選択か、根拠のパケット番号が正しくありません。表示フィルタで関係するプロトコルに絞り、各パケットの中身（階層表示）を見直してから、もう一度判定してください。'}</p>}
      {allDone && <p className="success-text">すべてのケースを分析しました。</p>}</div>
    <PacketViewer rows={rows} title={c.title}/>
  </div>;
}

export default function AnalyzerPage() {
  useUI(s => s.revision);
  const { labId } = useParams();
  const definition = labId ? labById(labId) : undefined;
  const [rows, setRows] = useState<PacketRow[]>(() => toRows(sample()));
  const [source, setSource] = useState('サンプル: dig（名前解決）と curl https://www.example.com/（HTTPS接続）');
  const [warnings, setWarnings] = useState<string[]>([]); const [error, setError] = useState('');
  const file = useRef<HTMLInputElement>(null);
  if (labId && definition?.workspace !== 'capture') return <div className="not-found"><h1>このラボは見つかりませんでした。</h1><Link className="button" to="/labs">ラボ一覧へ</Link></div>;
  const capture = definition?.workspace === 'capture' ? definition : undefined;
  return <div className="analyzer-page">
    <div className="page-breadcrumb"><Link to="/">ホーム</Link><Icon name="chevron" size={12}/>{capture ? <><Link to="/labs">ラボ</Link><Icon name="chevron" size={12}/><span>{capture.title}</span></> : <span>Packet Analyzer</span>}</div>
    {!capture && <div className="page-heading"><div><div className="eyebrow">WIRESHARK-LIKE · IN YOUR BROWSER</div><h1>Packet Analyzer</h1><p>パケットの記録（キャプチャ）を、Wiresharkのように1つずつ読み解く画面です。シミュレータで取ったキャプチャや、手元の pcap / pcapng ファイル（tcpdump や Wireshark の保存形式）を開き、表示フィルタ・階層表示・Hex dump で中身を確かめます。ファイルはブラウザの中だけで解析し、外部には送信しません。</p></div><span className="badge"><Icon name="lock" size={14}/> ローカル解析</span></div>}
    {capture ? <Fragment key={capture.id}><LabBrief lab={capture}/><CaseRunner def={capture}/></Fragment> : <>
      <div className="analyzer-toolbar">
        <button className="button small" onClick={() => file.current?.click()}><Icon name="upload" size={14}/>PCAP / pcapng を開く</button>
        <button className="button small secondary" onClick={() => { setRows(toRows(sample())); setSource('サンプル: dig（名前解決）と curl https://www.example.com/（HTTPS接続）'); setWarnings([]); }}>サンプルに戻す</button>
        <button className="button small secondary" title="ネットワークシミュレータで ping などを実行したときのキャプチャを読み込みます（まだ無いときは押せません）" disabled={!lab.cli.captures.length} onClick={() => { setRows(toRows(lab.cli.captures)); setSource('ワークスペースのキャプチャ'); setWarnings([]); }}>ワークスペースのキャプチャを読む（{lab.cli.captures.length}）</button>
        <span className="muted tiny">{source} · 上限 {PCAP_LIMITS.maxBytes / 1024 / 1024}MB / {PCAP_LIMITS.maxPackets.toLocaleString()} パケット</span>
        <input hidden ref={file} type="file" accept=".pcap,.pcapng,.cap,application/vnd.tcpdump.pcap" onChange={async e => {
          const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
          try {
            if (f.size > PCAP_LIMITS.maxBytes) throw new Error(`ファイルが大きすぎます（上限 ${PCAP_LIMITS.maxBytes / 1024 / 1024}MB）。必要な通信だけに絞って保存し直してから開いてください（例: tcpdump -c で件数を制限する、Wireshark で表示中のパケットだけをエクスポートする）。`);
            const parsed = parsePcap(await f.arrayBuffer());
            setRows(toRows(parsed.packets)); setSource(`${f.name}（${parsed.format}、${parsed.packets.length} パケット）`); setWarnings(parsed.warnings); setError('');
          } catch (err) { setError((err as Error).message); }
        }}/></div>
      {error && <p className="error-text" role="alert">{error}</p>}
      {warnings.map(w => <p key={w} className="hint-box">{w}</p>)}
      <PacketViewer rows={rows}/>
      <p className="muted tiny">開けるファイル: pcap（時刻の精度 µs / ns）と pcapng。リンク層は Ethernet・Linux cooked（SLL / SLL2。tcpdump -i any で取ったもの）・Raw IP に対応します。項目に読み解ける（デコードできる）プロトコル: Ethernet / 802.1Q / ARP / IPv4 / IPv6（基本）/ ICMP / TCP / UDP / DNS / HTTP / TLS（レコード）/ GRE / ESP。それ以外は Data（未解析のバイト列）として表示します。</p>
      <div className="lab-links"><Link className="button small secondary" to="/analyzer/capture-01">ラボ: パケットで通信を読む<Icon name="arrow" size={14}/></Link><Link className="button small secondary" to="/analyzer/capstone-3">Capstone 3: 失敗の理由を示す<Icon name="arrow" size={14}/></Link></div>
    </>}
  </div>;
}
