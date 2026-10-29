import hljs from 'highlight.js/lib/common';
import glsl from 'highlight.js/lib/languages/glsl';
import 'highlight.js/styles/github-dark.css';
import { inlineChanges, type DiffLine, type Range } from './diff';

hljs.registerLanguage('glsl', glsl);

// Extensions highlight.js doesn't know by itself.
const EXTENSIONS: Record<string, string> = {
  shader: 'glsl',
  hlsl: 'glsl',
  cginc: 'glsl',
  compute: 'glsl',
  vert: 'glsl',
  frag: 'glsl',
  // Unity serializes scenes/prefabs/assets as YAML.
  prefab: 'yaml',
  unity: 'yaml',
  asset: 'yaml',
  meta: 'yaml',
  mat: 'yaml',
  anim: 'yaml',
  controller: 'yaml',
  csproj: 'xml',
  props: 'xml',
  targets: 'xml',
  vue: 'xml',
  gradle: 'kotlin',
  kts: 'kotlin',
};

export function languageFor(path: string): string | null {
  const ext = path.split('/').pop()?.split('.').pop()?.toLowerCase() ?? '';
  const lang = EXTENSIONS[ext] ?? ext;
  return lang && hljs.getLanguage(lang) ? lang : null;
}

/** Splits highlighted HTML into lines, closing and reopening spans that cross line breaks. */
function splitHtmlLines(html: string): string[] {
  const lines: string[] = [];
  const open: string[] = [];
  let current = '';
  for (const [token] of html.matchAll(/<span[^>]*>|<\/span>|\n|[^<\n]+/g)) {
    if (token === '\n') {
      lines.push(current + '</span>'.repeat(open.length));
      current = open.join('');
    } else {
      if (token.startsWith('<span')) open.push(token);
      else if (token === '</span>') open.pop();
      current += token;
    }
  }
  lines.push(current);
  return lines;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Wraps the given character ranges of (already highlighted) HTML in <span class="chg">. */
function markRanges(html: string, ranges: Range[]): string {
  let out = '';
  let pos = 0;
  let r = 0;
  let open = false;
  // Tags, entities (one character each) or single characters.
  for (const [token] of html.matchAll(/<[^>]+>|&[^;]+;|[^<&]/g)) {
    if (token.startsWith('<')) {
      // Close our mark around foreign tags so nesting stays valid.
      if (open) out += '</span>';
      open = false;
      out += token;
      continue;
    }
    while (r < ranges.length && ranges[r][1] <= pos) r++;
    const mark = r < ranges.length && ranges[r][0] <= pos;
    pos++;
    if (mark !== open) out += mark ? '<span class="chg">' : '</span>';
    open = mark;
    out += token;
  }
  return open ? out + '</span>' : out;
}

/** Halves leading spaces (4-space indents become 2) so more code fits on a phone screen. */
function halveIndent(text: string) {
  return text.replace(/^[ \t]+/, (indent) => indent.replace(/ +/g, (spaces) => ' '.repeat(Math.ceil(spaces.length / 2))));
}

/**
 * HTML for every code line (null for hunk headers etc.): syntax colors plus marks on the words
 * that changed within modified lines.
 *
 * Each hunk is highlighted twice - once as the old file (context + removed lines) and once as
 * the new file (context + added lines) - so multi-line strings and comments color correctly.
 */
export function renderDiff(diffLines: DiffLine[], language: string | null): (string | null)[] {
  // Only the displayed copy is re-indented; comments and suggestions use the original text.
  const lines = diffLines.map((l) => ({ ...l, text: halveIndent(l.text) }));
  const out: (string | null)[] = lines.map((l) => (l.type === 'hunk' || l.type === 'meta' ? null : escapeHtml(l.text)));

  if (language) {
    const hunks: number[][] = [];
    lines.forEach((l, i) => {
      if (l.type === 'hunk' || !hunks.length) hunks.push([]);
      if (l.type !== 'hunk' && l.type !== 'meta') hunks[hunks.length - 1].push(i);
    });
    for (const hunk of hunks) {
      for (const side of ['del', 'add'] as const) {
        const indices = hunk.filter((i) => lines[i].type === side || lines[i].type === 'ctx');
        if (!indices.length) continue;
        const code = indices.map((i) => lines[i].text).join('\n');
        const html = splitHtmlLines(hljs.highlight(code, { language, ignoreIllegals: true }).value);
        // Context lines end up with the new-file rendering (the 'add' pass runs second).
        indices.forEach((lineIndex, k) => (out[lineIndex] = html[k]));
      }
    }
  }

  inlineChanges(lines).forEach((ranges, i) => {
    if (ranges?.length && out[i] !== null) out[i] = markRanges(out[i]!, ranges);
  });
  return out;
}
