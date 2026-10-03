/**
 * `terraform fmt`-like canonical layout (subset): 2-space indentation, one level per line that opens brackets (hclwrite's indent stack),
 * aligned "=" for consecutive single-line attributes, trimmed trailing spaces, one trailing newline.
 * Comments are kept as-is. This is line based and does not rewrite expressions.
 */
export function formatHcl(src: string) {
  const lines = src.replace(/\r\n/g, '\n').split('\n').map(l => l.trim());
  const stack: number[] = []; let inComment = false;
  const indented = lines.map(line => {
    // Count brackets in code only: not in strings, # // comments or /* */ comments (which may span lines).
    let code = line;
    if (inComment) { const end = code.indexOf('*/'); inComment = end < 0; code = inComment ? '' : code.slice(end + 2); }
    code = code.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/\/\*.*?\*\//g, '').replace(/(#|\/\/).*$/, '');
    if (code.includes('/*')) { code = code.slice(0, code.indexOf('/*')); inComment = true; }
    const opens = (code.match(/[{[(]/g) ?? []).length; const closes = (code.match(/[}\])]/g) ?? []).length;
    // A line with net openers indents the following lines by one level; net closers pop levels (possibly several per line).
    let net = opens - closes;
    while (net < 0 && stack.length) { const top = stack.pop()!; if (top > -net) { stack.push(top + net); net = 0; } else net += top; }
    const level = stack.length;
    if (net > 0) stack.push(net);
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
