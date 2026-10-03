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
  const value = (o: string, v: string | undefined) => { if (v === undefined) throw new Error(`${o} の値がありません`); values.set(o, v); };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (withValue.includes(t)) value(t, tokens[++i]);
    // getopt-style short options: -zv (flags), -c3 (attached value), -ni eth0 (the option taking a value uses the next token)
    else if (/^-[a-zA-Z]/.test(t)) for (let k = 1; k < t.length; k++) { const o = `-${t[k]}`; if (withValue.includes(o)) { value(o, k + 1 < t.length ? t.slice(k + 1) : tokens[++i]); break; } flags.add(o); }
    else if (t.startsWith('-') && t.length > 1 && !/^-\d/.test(t)) flags.add(t);
    else rest.push(t);
  }
  return { flags, values, rest };
}
