import { useEffect, useRef } from 'react';
import { Terminal as XTerminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { lab } from '../../application/LabController';

// Characters xterm.js (Unicode 6 widths, its default) draws in two cells, e.g. Japanese and full-width forms.
const WIDE = /[\u1100-\u115f\u2329\u232a\u2e80-\u303e\u3040-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6\u{20000}-\u{2fffd}\u{30000}-\u{3fffd}]/u;

export default function Terminal({ deviceId }: { deviceId: string }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // A selection left over from the previous workspace (one render after a switch) has no session here.
    if (!container.current || !deviceId || !lab.network.snapshot().devices.some(d => d.id === deviceId)) return;
    const terminal = new XTerminal({ cursorBlink: true, fontSize: 17, lineHeight: 1.55, fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace', convertEol: true,
      theme: { background: '#182b29', foreground: '#d6e5df', cursor: '#72dbb9', selectionBackground: '#37584b', black: '#182b29', green: '#7de0b6' }, scrollback: 1500, allowProposedApi: false });
    const fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(container.current);
    // Ctrl/Cmd+C with a selection and Ctrl/Cmd+V fall through to the browser's native copy/paste events, which xterm handles
    // (no Clipboard API needed, so it also works over plain http). Ctrl+C without a selection stays ^C.
    terminal.attachCustomKeyEventHandler(e => {
      if (e.type !== 'keydown' || !(e.ctrlKey || e.metaKey) || e.altKey) return true;
      const key = e.key.toLowerCase();
      if (key === 'c' && terminal.hasSelection()) { setTimeout(() => terminal.clearSelection()); return false; }
      return key !== 'v';
    });
    let line = ''; let historyIndex = 0;
    const mine = lab.history.filter(h => h.deviceId === deviceId && (h.labId ?? 'playground') === lab.labId && (lab.lab || h.timestamp >= (lab.design.startedAt ?? 0)));
    const commands = mine.map(h => h.command); historyIndex = commands.length;
    const prompt = () => terminal.write(`\x1b[38;2;114;219;185m${lab.cli.prompt(deviceId)}\x1b[0m `);
    terminal.writeln('PATH Virtual Terminal · 教育用のCLIです（本物のOSには接続しません）');
    terminal.writeln('help と入力するとコマンド一覧を表示します。↑↓キーで前に入力したコマンドを呼び出せます。\r\n');
    mine.slice(-8).forEach(h => { terminal.writeln(`> ${h.command}`); if (h.output) terminal.writeln(h.output); });
    prompt();
    // DECSET 45 (reverse wraparound) lets \b move back onto the previous row when the input has wrapped.
    // Erasing with ESC[J/K at column 0 would clear that row's wrap flag, so a single character is blanked with spaces instead.
    terminal.write('\x1b[?45h');
    const cells = (text: string) => Array.from(text).reduce((n, ch) => n + (WIDE.test(ch) ? 2 : 1), 0);
    const replace = (value: string) => { terminal.write(`${'\b'.repeat(cells(line))}\x1b[J${value}`); line = value; };
    const subscription = terminal.onData(data => {
      if (data === '\x1b[A') { historyIndex = Math.max(0, historyIndex - 1); replace(commands[historyIndex] ?? ''); return; }
      if (data === '\x1b[B') { historyIndex = Math.min(commands.length, historyIndex + 1); replace(commands[historyIndex] ?? ''); return; }
      if (data.startsWith('\x1b')) return;
      // Multiline pastes are inserted as one line and never execute silently.
      if (data.length > 1) { const text = data.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 512 - line.length); line += text; terminal.write(text); return; }
      if (data === '\r') {
        terminal.write('\r\n');
        if (line.trim() === 'clear') { terminal.clear(); commands.push(line); }
        else if (line.trim()) { const output = lab.execute(deviceId, line); if (output) terminal.writeln(output); commands.push(line); }
        line = ''; historyIndex = commands.length; prompt();
      } else if (data === '\x7f') { const last = Array.from(line).at(-1); if (last) { line = line.slice(0, -last.length); const n = cells(last); terminal.write('\b'.repeat(n) + ' '.repeat(n) + '\b'.repeat(n)); } }
      else if (data === '\x03') { terminal.writeln('^C'); line = ''; prompt(); }
      else if (data >= ' ' && line.length < 512) { line += data; terminal.write(data); }
    });
    const observer = new ResizeObserver(() => { if (container.current?.clientWidth) fit.fit(); }); observer.observe(container.current);
    fit.fit();
    return () => { observer.disconnect(); subscription.dispose(); terminal.dispose(); };
  }, [deviceId]);
  return deviceId ? <div ref={container} className="terminal-container" role="region" aria-label={`${deviceId} 仮想ターミナル`}/> : <div className="empty-state">構成図に機器を追加して選ぶと、その機器のCLIを使えます。</div>;
}
