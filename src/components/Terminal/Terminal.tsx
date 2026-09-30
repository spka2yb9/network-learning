import { useEffect, useRef } from 'react';
import { Terminal as XTerminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { lab } from '../../application/LabController';

export default function Terminal({ deviceId }: { deviceId: string }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!container.current || !deviceId) return;
    const terminal = new XTerminal({ cursorBlink: true, fontSize: 16, lineHeight: 1.55, fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace', convertEol: true,
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
    const replace = (value: string) => { terminal.write(`\r\x1b[2K`); prompt(); line = value; terminal.write(line); };
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
      } else if (data === '\x7f') { if (line) { line = line.slice(0, -1); terminal.write('\b \b'); } }
      else if (data === '\x03') { terminal.writeln('^C'); line = ''; prompt(); }
      else if (data >= ' ' && line.length < 512) { line += data; terminal.write(data); }
    });
    const observer = new ResizeObserver(() => { if (container.current?.clientWidth) fit.fit(); }); observer.observe(container.current);
    fit.fit();
    return () => { observer.disconnect(); subscription.dispose(); terminal.dispose(); };
  }, [deviceId]);
  return deviceId ? <div ref={container} className="terminal-container" role="region" aria-label={`${deviceId} 仮想ターミナル`}/> : <div className="empty-state">構成図に機器を追加して選ぶと、その機器のCLIを使えます。</div>;
}
