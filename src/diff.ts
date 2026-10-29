export type DiffLine = {
  type: 'add' | 'del' | 'ctx' | 'hunk' | 'meta';
  text: string;
  oldLine?: number;
  newLine?: number;
  /** Hunk headers only: where the hunk starts in the old and new file. */
  start?: { old: number; new: number };
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
      out.push({ type: 'hunk', text: line, start: { old: oldLine, new: newLine } });
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

// ---- Expanding hidden context (lines between hunks and after the last one) ----

function lastNumbers(lines: DiffLine[], end: number) {
  let oldLine = 0;
  let newLine = 0;
  for (let i = 0; i < end; i++) {
    oldLine = Math.max(oldLine, lines[i].oldLine ?? 0);
    newLine = Math.max(newLine, lines[i].newLine ?? 0);
  }
  return { oldLine, newLine };
}

/** Hidden new-file lines [from, to] above the hunk header at `index` (empty when from > to). */
export function hunkGap(lines: DiffLine[], index: number) {
  return { from: lastNumbers(lines, index).newLine + 1, to: lines[index].start!.new - 1 };
}

export type ExpandMode = 'up' | 'down' | 'all';
export const EXPAND_STEP = 20;

function contextLines(file: string[], from: number, to: number, delta: number): DiffLine[] {
  const out: DiffLine[] = [];
  for (let n = from; n <= to; n++) out.push({ type: 'ctx', text: file[n - 1] ?? '', newLine: n, oldLine: n - delta });
  return out;
}

/**
 * Reveals hidden lines above the hunk header at `index` using the full new file.
 * 'up' grows the hunk upwards, 'down' extends the previous hunk; the header disappears once the gap is closed.
 */
export function expandHunk(lines: DiffLine[], index: number, file: string[], mode: ExpandMode): DiffLine[] {
  const header = lines[index];
  const { from, to } = hunkGap(lines, index);
  // Unchanged lines keep a constant old/new offset within a gap.
  const delta = header.start!.new - header.start!.old;
  let downTo = from - 1;
  let upFrom = to + 1;
  if (mode === 'all') {
    downTo = to;
  } else if (mode === 'down') {
    downTo = Math.min(to, from + EXPAND_STEP - 1);
  } else {
    upFrom = Math.max(from, to - EXPAND_STEP + 1);
  }
  const closed = downTo + 1 >= upFrom;
  const newHeader: DiffLine = { ...header, start: { new: upFrom, old: upFrom - delta } };
  return [
    ...lines.slice(0, index),
    ...contextLines(file, from, downTo, delta),
    ...(closed ? [] : [newHeader]),
    ...contextLines(file, Math.max(upFrom, downTo + 1), to, delta),
    ...lines.slice(index + 1),
  ];
}

/** Number of file lines after the end of the diff. */
export function trailingGap(lines: DiffLine[], fileLength: number) {
  return fileLength - lastNumbers(lines, lines.length).newLine;
}

export function expandEnd(lines: DiffLine[], file: string[]): DiffLine[] {
  const { oldLine, newLine } = lastNumbers(lines, lines.length);
  const to = Math.min(file.length, newLine + EXPAND_STEP);
  return [...lines, ...contextLines(file, newLine + 1, to, newLine - oldLine)];
}

// ---- Word-level changes inside modified lines ----

export type Range = [start: number, end: number];

const TOKEN = /\w+|\s+|[^\w\s]/g;

/** Character ranges that differ between an old and a new version of a line, or null when the lines share too little. */
function changedRanges(a: string, b: string): [Range[], Range[]] | null {
  const ta = a.match(TOKEN) ?? [];
  const tb = b.match(TOKEN) ?? [];
  const n = ta.length;
  const m = tb.length;
  if (!n || !m || n * m > 40000) return null;

  // Longest common subsequence of tokens.
  const dp = new Uint16Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[at(i, j)] = ta[i] === tb[j] ? dp[at(i + 1, j + 1)] + 1 : Math.max(dp[at(i + 1, j)], dp[at(i, j + 1)]);

  const keepA = new Array<boolean>(n).fill(false);
  const keepB = new Array<boolean>(m).fill(false);
  let common = 0;
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (ta[i] === tb[j]) {
      keepA[i++] = keepB[j++] = true;
      common += ta[i - 1].trim().length;
    } else if (dp[at(i + 1, j)] >= dp[at(i, j + 1)]) i++;
    else j++;
  }
  // Lines that were rewritten entirely look better without word marks.
  if (common < 0.3 * Math.max(a.trim().length, b.trim().length)) return null;

  return [toRanges(ta, keepA), toRanges(tb, keepB)];
}

function toRanges(tokens: string[], keep: boolean[]): Range[] {
  const ranges: Range[] = [];
  let pos = 0;
  tokens.forEach((t, i) => {
    // Whitespace between two changes belongs to the change, so the mark isn't fragmented.
    const changed = !keep[i] || (/^\s+$/.test(t) && i > 0 && !keep[i - 1] && i + 1 < tokens.length && !keep[i + 1]);
    if (changed) {
      const last = ranges[ranges.length - 1];
      if (last && last[1] === pos) last[1] = pos + t.length;
      else ranges.push([pos, pos + t.length]);
    }
    pos += t.length;
  });
  return ranges;
}

/** For each diff line: changed character ranges when it's half of a modified line pair. */
export function inlineChanges(lines: DiffLine[]): (Range[] | null)[] {
  const out: (Range[] | null)[] = lines.map(() => null);
  for (let i = 0; i < lines.length; ) {
    if (lines[i].type !== 'del') {
      i++;
      continue;
    }
    const dels: number[] = [];
    while (i < lines.length && lines[i].type === 'del') dels.push(i++);
    const adds: number[] = [];
    while (i < lines.length && lines[i].type === 'add') adds.push(i++);
    for (let k = 0; k < Math.min(dels.length, adds.length); k++) {
      const ranges = changedRanges(lines[dels[k]].text, lines[adds[k]].text);
      if (ranges) [out[dels[k]], out[adds[k]]] = ranges;
    }
  }
  return out;
}
