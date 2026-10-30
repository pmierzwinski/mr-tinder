import type { DiffLine } from './diff';

/**
 * Where a file sits in the reading order: its depth in the call tree and the changed file
 * that leads to it (`from`), or a one-sentence note from the AI.
 */
export type FlowInfo = { depth: number; from?: { path: string; symbol: string; call: boolean }; note?: string };

export type FlowFile = { key: string; path: string; lines: DiffLine[] };

// ---- Local heuristic: who calls whom between the changed files ----

const KEYWORDS = new Set(
  'if else for foreach while do switch case catch try finally return new throw await yield using lock typeof sizeof nameof function def func fn class struct enum interface record var let const in of is as and or not this base super self null true false void get set static public private protected internal override virtual abstract async readonly sealed extern unsafe import export from package default when match'.split(
    ' ',
  ),
);

const CALL_PREFIX = new Set('return new throw await yield else case in of is as typeof go defer print echo delete not and or'.split(' '));

const TYPE_DEF = /\b(?:class|interface|struct|enum|record|trait|protocol|object|type)\s+([A-Za-z_]\w*)/g;
const FUNC_DEF = /\b(?:function\*?|def|func|fn|fun|sub)\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/g;
const ARROW_DEF = /\b(?:const|let|var|val)\s+([A-Za-z_]\w*)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_]\w*)\s*(?::[^=]+)?=>/g;
// C#/Java/C++/TS methods: `public async Task<int> Spawn(int x) {`, `spawn(x: number): void {`, `Spawn() => …`.
// Definitions start the line. Without a type or modifier in front, only `name(…) {` counts, so that
// a bare call like `spawn(x)` (Python, Go, Kotlin) isn't taken for a definition.
const METHOD_DEF = /^\s*((?:[\w@[\]<>,.?*&:]+\s+)*?)([A-Za-z_]\w*)\s*(?:<[^()]*>)?\s*\([^;]*\)\s*(?::[^{;=]+)?\s*(\{|=>|where\b|throws\b|const\b|override\b|$)/;

const CALL = /\b([A-Za-z_]\w*)\s*(?:<[\w\s,.<>[\]?]*>)?\s*\(/g;
const NEW = /\bnew\s+([A-Za-z_]\w*)/g;
const TYPE_REF = /\b([A-Z]\w+)\b/g;

const TEST_PATH = /(^|\/)(tests?|spec|__tests__)\/|[._-](test|spec)s?\.\w+$|Tests?\.\w+$/i;

/** Drops string literals and line comments so names inside them don't count. */
const stripNoise = (text: string) =>
  text
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""')
    .replace(/\/\/.*$|(^|\s)#\s.*$/, '');

function definitions(text: string): string[] {
  const names: string[] = [];
  for (const re of [TYPE_DEF, FUNC_DEF, ARROW_DEF]) for (const m of text.matchAll(re)) names.push(m[1]);
  const method = METHOD_DEF.exec(text);
  if (method) {
    const [, prefix, name, end] = method;
    // `return foo(…)`, `await foo(…)` or `new Foo(…)` look like signatures; the word before the name tells them apart.
    const before = prefix.trim().split(/\s+/).pop() ?? '';
    if (prefix.trim() ? !CALL_PREFIX.has(before) : end === '{') names.push(name);
  }
  return names.filter((n) => n.length > 2 && !KEYWORDS.has(n));
}

type Use = { symbol: string; call: boolean; pos: number };

function uses(text: string, pos: number): Use[] {
  const out: Use[] = [];
  for (const m of text.matchAll(CALL)) out.push({ symbol: m[1], call: true, pos });
  for (const m of text.matchAll(NEW)) out.push({ symbol: m[1], call: true, pos });
  for (const m of text.matchAll(TYPE_REF)) out.push({ symbol: m[1], call: false, pos });
  return out.filter((u) => u.symbol.length > 2 && !KEYWORDS.has(u.symbol));
}

const basename = (path: string) => path.split('/').pop()!.replace(/\..*$/, '');

// Names like Update/Start/Init are defined by many files at once; linking them would connect everything.
const MAX_DEFINERS = 2;

/**
 * Orders files so that a caller comes right before the files it calls (depth-first, entry points first),
 * judged from the symbols the changed lines define and use. Unconnected files follow, tests go last.
 * Returns indices into `files` with the flow info of each.
 */
export function flowOrder(files: FlowFile[]): { index: number; flow: FlowInfo }[] {
  const definers = new Map<string, number[]>();
  const define = (symbol: string, file: number) => {
    const list = definers.get(symbol) ?? [];
    if (!list.includes(file)) definers.set(symbol, [...list, file]);
  };

  const fileUses: Use[][] = files.map((f, i) => {
    define(basename(f.path), i);
    const found: Use[] = [];
    f.lines.forEach((l, pos) => {
      if (l.expanded) return;
      // Hunk headers carry the enclosing function: `@@ -10,4 +10,6 @@ public void Spawn()`.
      const text = stripNoise(l.type === 'hunk' ? l.text.replace(/^@@[^@]*@@/, '') : l.text);
      const defined = l.type === 'del' ? [] : definitions(text);
      defined.forEach((d) => define(d, i));
      // Only the change itself says what this MR makes the file call. A signature isn't a call,
      // but a one-line body after it (`void A() { B(); }`) is.
      if (l.type !== 'add' && l.type !== 'del') return;
      const body = defined.length ? text.slice(text.search(/\{|=>/) + 1 || text.length) : text;
      found.push(...uses(body, pos));
    });
    return found;
  });

  // edges[a]: callee -> the first use that links to it
  const edges = files.map(() => new Map<number, Use>());
  const callers = files.map(() => new Set<number>());
  fileUses.forEach((list, a) => {
    for (const use of list) {
      const targets = (definers.get(use.symbol) ?? []).filter((b) => b !== a);
      if (!targets.length || targets.length > MAX_DEFINERS) continue;
      for (const b of targets) {
        if (edges[a].has(b)) continue;
        edges[a].set(b, use);
        callers[b].add(a);
      }
    }
  });

  const isTest = files.map((f) => TEST_PATH.test(f.path));
  const connected = (i: number) => edges[i].size > 0 || callers[i].size > 0;
  const out: { index: number; flow: FlowInfo }[] = [];
  const visited = new Set<number>();

  const walk = (i: number, depth: number, from?: FlowInfo['from']) => {
    if (visited.has(i)) return;
    visited.add(i);
    out.push({ index: i, flow: { depth, from } });
    [...edges[i].entries()]
      .sort(([, x], [, y]) => x.pos - y.pos)
      .forEach(([b, use]) => walk(b, depth + 1, { path: files[i].path, symbol: use.symbol, call: use.call }));
  };

  const all = files.map((_, i) => i);
  const roots = all
    .filter((i) => connected(i) && callers[i].size === 0)
    .sort((a, b) => edges[b].size - edges[a].size || a - b);

  for (const tests of [false, true]) {
    roots.filter((i) => isTest[i] === tests).forEach((i) => walk(i, 0));
    // Cycles leave files without an entry point; start from the first one in the original order.
    all.filter((i) => connected(i) && isTest[i] === tests).forEach((i) => walk(i, 0));
    all.filter((i) => isTest[i] === tests).forEach((i) => walk(i, 0));
  }
  return out;
}

/** Files ordered by the AI, keyed with `fileKey`, each with a one-sentence note. */
export type AiStep = { key: string; note: string };

export const fileKey = (reviewId: string, path: string) => `${reviewId}:${path}`;
