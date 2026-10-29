import hljs from 'highlight.js/lib/common';
import glsl from 'highlight.js/lib/languages/glsl';
import 'highlight.js/styles/github-dark.css';
import type { DiffLine } from './diff';

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

/**
 * Highlights each hunk twice - once as the old file (context + removed lines) and once as the
 * new file (context + added lines) - so multi-line strings and comments color correctly.
 * Returns HTML per diff line, or null for lines that aren't code.
 */
export function highlightDiff(lines: DiffLine[], language: string | null): (string | null)[] {
  const out: (string | null)[] = lines.map(() => null);
  if (!language) return out;

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
      indices.forEach((lineIndex, k) => {
        // Context lines take the new-file rendering (the 'add' pass runs second).
        out[lineIndex] = html[k];
      });
    }
  }
  return out;
}
