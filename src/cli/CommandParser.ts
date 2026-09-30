/** Split a command line into tokens. Supports "double" and 'single' quotes; no shell expansion. */
export function parseCommand(input: string) {
  if (input.length > 512) throw new Error('コマンドは512文字以内です');
  if (/[\x00-\x1f\x7f]/.test(input)) throw new Error('制御文字は使用できません');
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input.trim()))) tokens.push(m[1] ?? m[2] ?? m[3]);
  return tokens;
}
/** Take `-x value` style options out of a token list. Returns remaining positional tokens. */
export function options(tokens: string[], withValue: string[] = []) {
  const flags = new Set<string>(); const values = new Map<string, string>(); const rest: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (withValue.includes(t)) { const v = tokens[++i]; if (v === undefined) throw new Error(`${t} の値がありません`); values.set(t, v); }
    else if (/^-[a-zA-Z]{2,}$/.test(t) && !withValue.some(w => t.startsWith(w))) for (const c of t.slice(1)) flags.add(`-${c}`);
    else if (t.startsWith('-') && t.length > 1 && !/^-\d/.test(t)) flags.add(t);
    else rest.push(t);
  }
  return { flags, values, rest };
}
