export type DiffLine = {
  type: 'add' | 'del' | 'ctx' | 'hunk' | 'meta';
  text: string;
  oldLine?: number;
  newLine?: number;
};

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parseDiff(diff: string): DiffLine[] {
  const out: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  const raw = diff.endsWith('\n') ? diff.slice(0, -1) : diff;
  for (const line of raw.split('\n')) {
    const hunk = HUNK.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      out.push({ type: 'hunk', text: line });
    } else if (line.startsWith('+')) {
      out.push({ type: 'add', text: line.slice(1), newLine: newLine++ });
    } else if (line.startsWith('-')) {
      out.push({ type: 'del', text: line.slice(1), oldLine: oldLine++ });
    } else if (line.startsWith('\\')) {
      out.push({ type: 'meta', text: line });
    } else {
      out.push({ type: 'ctx', text: line.slice(1), oldLine: oldLine++, newLine: newLine++ });
    }
  }
  return out;
}

export function diffStats(lines: DiffLine[]) {
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.type === 'add') added++;
    else if (l.type === 'del') removed++;
  }
  return { added, removed };
}

export function isCommentable(l: DiffLine) {
  return l.type === 'add' || l.type === 'del' || l.type === 'ctx';
}
