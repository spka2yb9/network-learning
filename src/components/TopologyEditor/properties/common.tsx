import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from '../../Icon';

/** Collapsible section of the properties panel. */
export function Section({ title, count, children, open = true }: { title: string; count?: number | string; children: ReactNode; open?: boolean }) {
  return <details className="prop-section" open={open}><summary>{title}{count !== undefined && <span>{count}</span>}</summary><div className="prop-body">{children}</div></details>;
}
/** Single-line text form with apply button. Keeps its own draft until submitted. */
export function TextApply({ label, value, placeholder, onApply, aria, button = '適用' }: { label: string; value: string; placeholder?: string; onApply: (v: string) => boolean | void; aria?: string; button?: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <form className="text-apply" onSubmit={e => { e.preventDefault(); if (onApply(draft.trim()) !== false) setDraft(draft.trim()); }}>
    <label>{label}<div className="input-action"><input aria-label={aria ?? label} value={draft} placeholder={placeholder} onChange={e => setDraft(e.target.value)}/><button title={button} aria-label={`${aria ?? label}を${button}`}><Icon name="check" size={16}/></button></div></label>
  </form>;
}
export function Toggle({ on, onChange, labels = ['UP', 'DOWN'], aria }: { on: boolean; onChange: (v: boolean) => void; labels?: [string, string]; aria?: string }) {
  // The accessible name keeps the visible text so voice control ("click UP") still finds the button.
  return <button type="button" aria-label={aria && `${aria}: ${on ? labels[0] : labels[1]}`} aria-pressed={on} className={`state-toggle ${on ? 'up' : ''}`} onClick={() => onChange(!on)}><span className={`status-dot ${on ? '' : 'down'}`}/>{on ? labels[0] : labels[1]}</button>;
}
export function Rows({ rows, empty = 'なし' }: { rows: (string | ReactNode)[][]; empty?: string }) {
  if (!rows.length) return <p className="muted tiny">{empty}</p>;
  return <table className="mini-table"><tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table>;
}
export function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" className="icon-button" aria-label={label} title={label} onClick={onClick}><Icon name="close" size={14}/></button>;
}
