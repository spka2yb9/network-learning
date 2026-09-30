import { useEffect, useId, useRef, useState } from 'react';
import { db, type DesignInfo, type DesignRecord } from '../db/database';
import { deleteDesign, saveDesign } from '../application/designs';
import { Icon } from './Icon';

type Props = {
  kind: DesignRecord['kind'];
  info: DesignInfo;
  templates: Record<string, { name: string; description: string }>;
  snapshot: () => unknown;
  onNew: (name: string) => void;
  onTemplate: (id: string) => void;
  onLoad: (record: DesignRecord) => void;
  onNamed: (info: DesignInfo) => void | Promise<void>;
  templateRequest?: string;
  onRequestHandled?: () => void;
};
type Action = { type: 'new' } | { type: 'save' } | { type: 'manage' } | { type: 'delete'; id: string; name: string } | { type: 'template'; id: string } | { type: 'open'; id: string };

export default function DesignControls({ kind, info, templates, snapshot, onNew, onTemplate, onLoad, onNamed, templateRequest, onRequestHandled }: Props) {
  const [records, setRecords] = useState<DesignRecord[]>([]);
  const [action, setAction] = useState<Action>();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const refresh = async () => setRecords((await db.designs.where('kind').equals(kind).toArray()).sort((a, b) => b.updatedAt - a.updatedAt));
  useEffect(() => { void refresh().catch(() => setError('保存した構成を読み込めませんでした。')); }, [kind]);
  useEffect(() => { if (action) dialog.current?.showModal(); else dialog.current?.close(); }, [action]);
  useEffect(() => {
    if (templateRequest && templates[templateRequest]) { setError(''); setAction({ type: 'template', id: templateRequest }); onRequestHandled?.(); }
  }, [templateRequest]);
  const start = (next: Action) => { setName(next.type === 'new' ? '' : info.savedId ? info.name : info.template ? `${info.name}（コピー）` : info.name === '無題の構成' ? '' : info.name); setError(''); setStatus(''); setAction(next); };
  const submit = async () => {
    if (!action || busy) return;
    setBusy(true); setError('');
    try {
      if (action.type === 'save') {
        const next = await saveDesign(kind, info, name, snapshot());
        await onNamed(next); await refresh();
      } else if (action.type === 'delete') {
        await deleteDesign(kind, action.id);
        if (info.savedId === action.id) await onNamed({ ...info, savedId: undefined, modified: true });
        await refresh();
        setStatus(`「${action.name}」を保存した構成から削除しました。編集中の内容は残っています。`);
        setAction({ type: 'manage' });
        return;
      } else if (action.type === 'manage') return;
      else if (action.type === 'new') onNew(name);
      else if (action.type === 'template') onTemplate(action.id);
      else { const record = await db.designs.get(action.id); if (!record) throw new Error('保存した構成が見つかりません。'); onLoad(record); }
      setAction(undefined);
    } catch (e) { setError(e instanceof Error ? e.message : '保存できませんでした。'); }
    finally { setBusy(false); }
  };
  const naming = action?.type === 'new' || action?.type === 'save';
  return <section className="design-controls" aria-label="構成の管理">
    <div className="design-heading"><div><strong>{info.name}</strong><span className="tag-mini">{info.savedId ? '保存した構成' : info.template ? 'テンプレート' : '新規構成'}{info.modified ? '・編集中' : ''}</span></div>
      <p>新規作成で空の構成から始めるか、テンプレートを読み込んで編集できます。</p></div>
    <div className="design-actions">
      <button className="button small secondary" onClick={() => start({ type: 'new' })}><Icon name="plus" size={15}/>新規作成</button>
      <select aria-label="テンプレート" value="" onChange={e => { if (e.target.value) start({ type: 'template', id: e.target.value }); }}><option value="">テンプレートを開く…</option>{Object.entries(templates).map(([id, t]) => <option key={id} value={id}>{t.name} — {t.description}</option>)}</select>
      <button className="button small" onClick={() => start({ type: 'save' })}>名前を付けて保存</button>
      <select aria-label="保存した構成" value="" disabled={!records.length} onChange={e => { if (e.target.value) start({ type: 'open', id: e.target.value }); }}><option value="">保存した構成を開く…</option>{records.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
      <button className="button small secondary" disabled={!records.length} onClick={() => start({ type: 'manage' })}><Icon name="settings" size={15}/>保存した構成を管理</button>
    </div>
    <p className="tiny muted design-note">編集中の内容はこのブラウザに自動保存されます。切り替える前に「名前を付けて保存」すると、あとから開き直せます。</p>
    {error && !action && <p className="error-text" role="alert">{error}</p>}
    <dialog ref={dialog} className="modal design-dialog" aria-labelledby={titleId} onCancel={e => { e.preventDefault(); if (!busy) setAction(undefined); }}>
      <form onSubmit={e => { e.preventDefault(); void submit(); }}>
        <h2 id={titleId}>{action?.type === 'manage' ? '保存した構成を管理' : action?.type === 'delete' ? `「${action.name}」を削除しますか？` : action?.type === 'new' ? '新しい構成を作成' : action?.type === 'save' ? '構成に名前を付けて保存' : action?.type === 'template' ? `「${templates[action.id]?.name}」を開く` : '保存した構成を開く'}</h2>
        {action?.type === 'manage' ? <>
          {status && <p role="status">{status}</p>}
          {records.length ? <ul className="saved-design-list">{records.map(record => <li key={record.id}><div><strong>{record.name}</strong><small>{new Date(record.updatedAt).toLocaleString('ja-JP')}{record.id === info.savedId ? ' · 編集中' : ''}</small></div><button type="button" className="button small secondary text-danger" aria-label={`「${record.name}」を削除`} onClick={() => start({ type: 'delete', id: record.id, name: record.name })}><Icon name="trash" size={14}/>削除</button></li>)}</ul> : <p>保存した構成はありません。</p>}
        </> : action?.type === 'delete' ? <p>このブラウザに保存した構成を削除します。この操作は取り消せません。現在編集中の内容とテンプレートは残ります。</p> : <>
        {naming ? <><label className="design-name-field">構成名<input autoFocus maxLength={100} value={name} onChange={e => setName(e.target.value)} placeholder="例：社内ネットワークの検証" required={action?.type === 'save'}/></label>
          <p>{action?.type === 'new' ? '機器・接続・リソースが一つもない状態から始めます。名前はあとから付けることもできます。' : '現在の構成をこのブラウザに保存します。名前を変えると別の構成として保存され、元のテンプレートは変わりません。'}</p></> : <p>現在編集中の構成を置き換えます。残したい場合は、キャンセルして「名前を付けて保存」してください。</p>}
        {action?.type === 'new' && <p className="tiny muted">現在の構成を残す場合は、先に「名前を付けて保存」してください。</p>}
        </>}
        {error && action && <p className="error-text" role="alert">{error}</p>}
        <div className="modal-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => setAction(action?.type === 'delete' ? { type: 'manage' } : undefined)}>{action?.type === 'manage' ? '閉じる' : 'キャンセル'}</button>{action?.type !== 'manage' && <button className={`button ${action?.type === 'delete' ? 'design-delete-button' : ''}`} disabled={busy || (action?.type === 'save' && !name.trim())}>{busy ? '処理中…' : action?.type === 'delete' ? '削除する' : action?.type === 'new' ? '作成する' : action?.type === 'save' ? '保存する' : '切り替える'}</button>}</div>
      </form>
    </dialog>
  </section>;
}
