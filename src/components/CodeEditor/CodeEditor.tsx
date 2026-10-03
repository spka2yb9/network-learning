import { useEffect, useRef } from 'react';
import { basicSetup, EditorView } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

/** Tiny HCL tokenizer for highlighting only (the real parsing happens in terraform/parser). */
const hcl = StreamLanguage.define<{ inString: boolean }>({
  startState: () => ({ inString: false }),
  token(stream, state) {
    if (state.inString) {
      while (!stream.eol()) { if (stream.match('${')) { stream.backUp(2); if (stream.pos > stream.start) return 'string'; stream.next(); stream.next(); state.inString = false; return 'meta'; } const c = stream.next(); if (c === '\\') stream.next(); else if (c === '"') { state.inString = false; return 'string'; } }
      return 'string';
    }
    if (stream.eatSpace()) return null;
    if (stream.match('#') || stream.match('//')) { stream.skipToEnd(); return 'comment'; }
    if (stream.match('"')) { state.inString = true; return 'string'; }
    if (stream.match('}') && stream.string.slice(0, stream.pos).lastIndexOf('${') > stream.string.slice(0, stream.pos).lastIndexOf('"')) { state.inString = true; return 'meta'; }
    if (stream.match(/^(resource|data|variable|output|locals|module|provider|terraform|lifecycle|ingress|egress|route|default_action)\b/)) return 'keyword';
    if (stream.match(/^(true|false|null)\b/)) return 'atom';
    if (stream.match(/^\d+(\.\d+)?/)) return 'number';
    if (stream.match(/^(var|local|data|module|count|each|path)\b/)) return 'variableName.special';
    if (stream.match(/^[A-Za-z_][\w-]*(?=\s*\()/)) return 'function';
    if (stream.match(/^[A-Za-z_][\w-]*(?=\s*=)/)) return 'propertyName';
    if (stream.match(/^[A-Za-z_][\w-]*/)) return 'variableName';
    stream.next(); return null;
  },
});
const style = HighlightStyle.define([
  { tag: tags.keyword, color: '#1f6b57', fontWeight: '600' }, { tag: tags.string, color: '#9a5a2a' }, { tag: tags.comment, color: '#5b6b61', fontStyle: 'italic' },
  { tag: tags.number, color: '#5b52b8' }, { tag: tags.atom, color: '#5b52b8' }, { tag: tags.propertyName, color: '#2f5f8f' }, { tag: tags.function(tags.variableName), color: '#8a3f6e' },
  { tag: tags.special(tags.variableName), color: '#b0503f' }, { tag: tags.meta, color: '#b0503f' },
]);
export default function CodeEditor({ value, onChange, ariaLabel }: { value: string; onChange: (v: string) => void; ariaLabel: string }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(undefined);
  const change = useRef(onChange); change.current = onChange;
  useEffect(() => {
    if (!host.current) return;
    view.current = new EditorView({ parent: host.current, state: EditorState.create({ doc: value, extensions: [basicSetup, hcl, syntaxHighlighting(style), EditorView.lineWrapping,
      EditorView.contentAttributes.of({ 'aria-label': ariaLabel }), EditorView.updateListener.of(u => { if (u.docChanged) change.current(u.state.doc.toString()); })] }) });
    return () => view.current?.destroy();
  }, []);
  useEffect(() => {
    const v = view.current; if (!v) return;
    const current = v.state.doc.toString();
    if (current !== value) v.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);
  return <div className="code-editor" ref={host}/>;
}
