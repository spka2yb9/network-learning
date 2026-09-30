/**
 * `terraform fmt`-like canonical layout (subset): 2-space indentation by brace depth,
 * aligned "=" for consecutive single-line attributes, trimmed trailing spaces, one trailing newline.
 * Comments are kept as-is. This is line based and does not rewrite expressions.
 */
export function formatHcl(src: string) {
  const lines = src.replace(/\r\n/g, '\n').split('\n').map(l => l.trim());
  let depth = 0;
  const indented = lines.map(line => {
    const code = line.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/(#|\/\/).*$/, '');
    const closers = /^[}\])]/.test(code) ? 1 : 0;
    const level = Math.max(0, depth - closers);
    const opens = (code.match(/[{[(]/g) ?? []).length; const closes = (code.match(/[}\])]/g) ?? []).length;
    depth = Math.max(0, depth + opens - closes);
    return { level, text: line, attr: /^[A-Za-z_][\w-]*\s*=(?!=)/.test(code) && opens === closes };
  });
  const out: string[] = [];
  for (let i = 0; i < indented.length; i++) {
    const group = [];
    let j = i;
    while (j < indented.length && indented[j].attr && indented[j].level === indented[i].level) group.push(indented[j++]);
    if (group.length) {
      const width = Math.max(...group.map(g => g.text.split('=')[0].trim().length));
      for (const g of group) { const [k, ...v] = g.text.split('='); out.push(`${'  '.repeat(g.level)}${k.trim().padEnd(width)} = ${v.join('=').trim()}`); }
      i = j - 1; continue;
    }
    const { level, text } = indented[i];
    out.push(text ? `${'  '.repeat(level)}${text}` : '');
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}
