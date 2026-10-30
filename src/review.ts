import type { DiffLine } from './diff';

/** A code-review request: a GitLab merge request or a GitHub pull request. */

export type ProviderKind = 'gitlab' | 'github';

export const PROVIDER_LABEL: Record<ProviderKind, string> = { gitlab: 'GitLab', github: 'GitHub' };

export type Person = { username: string; name: string; avatarUrl?: string };

export type Review = {
  /** Unique across providers. */
  id: string;
  provider: ProviderKind;
  /** GitLab project id or GitHub "owner/repo": what the provider needs to address the repository. */
  repoId: string;
  /** Human-readable repository path. */
  repo: string;
  number: number;
  /** "group/repo!12" or "owner/repo#12". */
  ref: string;
  title: string;
  description: string;
  sourceBranch: string;
  targetBranch: string;
  webUrl: string;
  headSha: string;
  /** Diff base commits, known once the review was loaded in full (needed for GitLab line comments). */
  baseSha?: string;
  startSha?: string;
  draft: boolean;
  state: 'open' | 'merged' | 'closed';
  author: Person;
  updatedAt: string;
};

export type FileDiff = {
  old_path: string;
  new_path: string;
  diff: string;
  new_file: boolean;
  renamed_file: boolean;
  deleted_file: boolean;
  too_large?: boolean;
  collapsed?: boolean;
};

/** A pending review comment: on a line (old and/or new side), or on the whole file when no line is set. */
export type Draft = { id: string; body: string; path?: string; oldLine?: number; newLine?: number };

export type ReviewStatus = {
  approvedBy: Person[];
  /** Approvals required by the project; 0 when unknown or not configured. */
  required: number;
  /** Approvals still missing, when the provider reports it. */
  approvalsLeft?: number;
  changesRequestedBy: Person[];
};

export type Repo = { provider: ProviderKind; id: string; name: string; path: string };

export interface ReviewProvider {
  readonly kind: ProviderKind;
  readonly me: Person;
  /** GitHub only accepts comments on lines that are part of the diff, not on expanded context. */
  readonly canCommentOnContext: boolean;

  /** Open reviews waiting for me (plus ones merged in the last `mergedDays`) and my own. */
  inbox(mergedDays: number): Promise<{ reviewing: Review[]; mine: Review[] }>;
  /** Open or merged reviews in my repositories whose title mentions `term`. */
  search(term: string): Promise<Review[]>;
  byBranch(branch: string): Promise<Review[]>;
  repos(query: string): Promise<Repo[]>;
  repoReviews(repo: Repo): Promise<Review[]>;

  /** Fresh copy, including diff base commits. */
  refresh(review: Review): Promise<Review>;
  files(review: Review): Promise<FileDiff[]>;
  /** File content at the review's head commit. */
  fileLines(review: Review, path: string): Promise<string[]>;
  status(review: Review): Promise<ReviewStatus | null>;

  drafts(review: Review): Promise<Draft[]>;
  addDraft(review: Review, file: FileDiff, line: DiffLine | null, body: string): Promise<Draft>;
  updateDraft(review: Review, draft: Draft, body: string): Promise<Draft>;
  deleteDraft(review: Review, draft: Draft): Promise<void>;
  /** Publishes the pending comments (plus an optional summary), approving when asked. */
  submit(review: Review, opts: { summary?: string; approve: boolean }): Promise<void>;
}

export type Providers = Partial<Record<ProviderKind, ReviewProvider>>;

export function providerFor(providers: Providers, review: Review): ReviewProvider {
  const provider = providers[review.provider];
  if (!provider) throw new Error(`${PROVIDER_LABEL[review.provider]} nie jest połączony — dodaj konto w ustawieniach.`);
  return provider;
}

export function draftsForFile(drafts: Draft[], file: FileDiff) {
  return drafts.filter((d) => d.path === file.new_path || d.path === file.old_path);
}

export function isDraftOnLine(d: Draft, l: DiffLine) {
  if (l.type === 'del') return d.oldLine === l.oldLine && !d.newLine;
  return l.newLine !== undefined && d.newLine === l.newLine;
}

export const isFileDraft = (d: Draft) => !d.newLine && !d.oldLine;

export function splitLines(text: string) {
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));
  if (text.endsWith('\n')) lines.pop();
  return lines;
}
