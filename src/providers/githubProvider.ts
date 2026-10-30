import type { DiffLine } from '../diff';
import { ApiError } from '../gitlab';
import { splitLines, type Draft, type FileDiff, type Person, type Repo, type Review, type ReviewProvider, type ReviewStatus } from '../review';
import { loadGithubDrafts, saveGithubDrafts } from '../storage';

export const GITHUB_API = 'https://api.github.com';

type GhUser = { login: string; name?: string | null; avatar_url?: string };
type GhPull = {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  draft?: boolean;
  state: 'open' | 'closed';
  merged_at: string | null;
  updated_at: string;
  user: GhUser;
  head: { ref: string; sha: string };
  base: { ref: string; sha: string; repo: { full_name: string } };
};
type GhSearchItem = { number: number; repository_url: string; updated_at: string; state: string; pull_request?: { merged_at: string | null } };
type GhFile = { filename: string; previous_filename?: string; status: string; patch?: string };
type GhReview = { user: GhUser | null; state: string };

const toPerson = (u: GhUser): Person => ({ username: u.login, name: u.name || u.login, avatarUrl: u.avatar_url });

function toReview(pr: GhPull): Review {
  const repo = pr.base.repo.full_name;
  return {
    id: `github:${repo}#${pr.number}`,
    provider: 'github',
    repoId: repo,
    repo,
    number: pr.number,
    ref: `${repo}#${pr.number}`,
    title: pr.title,
    description: pr.body ?? '',
    sourceBranch: pr.head.ref,
    targetBranch: pr.base.ref,
    webUrl: pr.html_url,
    headSha: pr.head.sha,
    baseSha: pr.base.sha,
    draft: !!pr.draft,
    state: pr.merged_at ? 'merged' : pr.state === 'open' ? 'open' : 'closed',
    author: toPerson(pr.user),
    updatedAt: pr.updated_at,
  };
}

function toFileDiff(f: GhFile): FileDiff {
  return {
    old_path: f.previous_filename ?? f.filename,
    new_path: f.filename,
    // GitHub leaves out the patch for binary and very large files.
    diff: f.patch ?? '',
    new_file: f.status === 'added',
    deleted_file: f.status === 'removed',
    renamed_file: f.status === 'renamed',
  };
}

const day = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);

// Search results are reused briefly: the inbox reloads after every review and the search API allows ~30 calls a minute.
const SEARCH_TTL = 60_000;

export class GitHubProvider implements ReviewProvider {
  readonly kind = 'github' as const;
  readonly canCommentOnContext = false;
  private searchCache = new Map<string, { at: number; result: Promise<Review[]> }>();
  private scope: Promise<string> | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    readonly me: Person,
  ) {}

  static async connect(baseUrl: string, token: string) {
    return toPerson(await request<GhUser>(baseUrl, token, 'GET', '/user'));
  }

  private call<T>(method: string, path: string, body?: unknown, accept?: string) {
    return request<T>(this.baseUrl, this.token, method, path, body, accept);
  }

  private async getAll<T>(path: string, maxPages = 30): Promise<T[]> {
    const out: T[] = [];
    const sep = path.includes('?') ? '&' : '?';
    for (let page = 1; page <= maxPages; page++) {
      const items = await this.call<T[]>('GET', `${path}${sep}per_page=100&page=${page}`);
      out.push(...items);
      if (items.length < 100) break;
    }
    return out;
  }

  /** Search returns issue-shaped results; pull details (branches, sha) need one extra call each. */
  private searchPulls(query: string): Promise<Review[]> {
    const cached = this.searchCache.get(query);
    if (cached && Date.now() - cached.at < SEARCH_TTL) return cached.result;
    const result = (async () => {
      const res = await this.call<{ items: GhSearchItem[] }>('GET', `/search/issues?q=${encodeURIComponent(`is:pr ${query}`)}&per_page=50`);
      const pulls = await Promise.all(
        res.items
          .filter((i) => i.state === 'open' || i.pull_request?.merged_at)
          .map((i) => this.call<GhPull>('GET', `${i.repository_url.replace(/^.*\/repos\//, '/repos/')}/pulls/${i.number}`)),
      );
      return pulls.map(toReview);
    })();
    result.catch(() => this.searchCache.delete(query));
    this.searchCache.set(query, { at: Date.now(), result });
    return result;
  }

  /** Limits searches to my own repositories and my organizations' (several org: qualifiers are OR-ed). */
  private searchScope() {
    this.scope ??= this.getAll<{ login: string }>('/user/orgs').then(
      (orgs) => [`user:${this.me.username}`, ...orgs.map((o) => `org:${o.login}`)].join(' '),
      () => `user:${this.me.username}`,
    );
    return this.scope;
  }

  async inbox(mergedDays: number) {
    const since = day(mergedDays);
    const [requested, reviewed, reviewedMerged, mine, mineMerged] = await Promise.all([
      this.searchPulls('is:open review-requested:@me'),
      this.searchPulls('is:open reviewed-by:@me -author:@me'),
      this.searchPulls(`is:merged merged:>=${since} reviewed-by:@me -author:@me`),
      this.searchPulls('is:open author:@me'),
      this.searchPulls(`is:merged merged:>=${since} author:@me`),
    ]);
    const unique = (list: Review[]) => [...new Map(list.map((r) => [r.id, r])).values()];
    return { reviewing: unique([...requested, ...reviewed, ...reviewedMerged]), mine: unique([...mine, ...mineMerged]) };
  }

  async search(term: string) {
    return this.searchPulls(`"${term}" in:title ${await this.searchScope()}`);
  }

  async byBranch(branch: string) {
    return this.searchPulls(`is:open head:${branch} ${await this.searchScope()}`);
  }

  async repos(query: string): Promise<Repo[]> {
    const repos = await this.call<{ full_name: string; name: string }[]>('GET', '/user/repos?sort=updated&per_page=100');
    const q = query.trim().toLowerCase();
    return repos
      .filter((r) => !q || r.full_name.toLowerCase().includes(q))
      .slice(0, 30)
      .map((r) => ({ provider: 'github', id: r.full_name, name: r.name, path: r.full_name }));
  }

  async repoReviews(repo: Repo) {
    return (await this.getAll<GhPull>(`/repos/${repo.id}/pulls?state=open`, 3)).map(toReview);
  }

  async refresh(review: Review) {
    return toReview(await this.call<GhPull>('GET', `/repos/${review.repoId}/pulls/${review.number}`));
  }

  async files(review: Review) {
    return (await this.getAll<GhFile>(`/repos/${review.repoId}/pulls/${review.number}/files`)).map(toFileDiff);
  }

  async fileLines(review: Review, path: string) {
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    const text = await this.call<string>('GET', `/repos/${review.repoId}/contents/${encoded}?ref=${review.headSha}`, undefined, 'application/vnd.github.raw+json');
    return splitLines(text);
  }

  async status(review: Review): Promise<ReviewStatus | null> {
    const reviews = await this.getAll<GhReview>(`/repos/${review.repoId}/pulls/${review.number}/reviews`, 3).catch(() => null);
    if (!reviews) return null;
    // Each person's latest decisive review counts; a dismissal clears their earlier verdict.
    const latest = new Map<string, { user: GhUser; state: string }>();
    for (const r of reviews) {
      if (r.user && ['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(r.state)) latest.set(r.user.login, { user: r.user, state: r.state });
    }
    const withState = (state: string) => [...latest.values()].filter((r) => r.state === state).map((r) => toPerson(r.user));
    return { approvedBy: withState('APPROVED'), required: 0, changesRequestedBy: withState('CHANGES_REQUESTED') };
  }

  // GitHub can't add comments to a pending review one by one, so drafts live on the device until submit.
  async drafts(review: Review) {
    return loadGithubDrafts(review.id);
  }

  async addDraft(review: Review, file: FileDiff, line: DiffLine | null, body: string) {
    const draft: Draft = {
      id: crypto.randomUUID(),
      body,
      path: file.new_path,
      oldLine: line && line.type === 'del' ? line.oldLine : undefined,
      newLine: line && line.type !== 'del' ? line.newLine : undefined,
    };
    saveGithubDrafts(review.id, [...loadGithubDrafts(review.id), draft]);
    return draft;
  }

  async updateDraft(review: Review, draft: Draft, body: string) {
    const updated = { ...draft, body };
    saveGithubDrafts(review.id, loadGithubDrafts(review.id).map((d) => (d.id === draft.id ? updated : d)));
    return updated;
  }

  async deleteDraft(review: Review, draft: Draft) {
    saveGithubDrafts(review.id, loadGithubDrafts(review.id).filter((d) => d.id !== draft.id));
  }

  async submit(review: Review, { summary, approve }: { summary?: string; approve: boolean }) {
    const drafts = loadGithubDrafts(review.id);
    const lineDrafts = drafts.filter((d) => d.newLine || d.oldLine);
    // Review comments must sit on a diff line; whole-file notes go into the review body instead.
    const fileNotes = drafts.filter((d) => !d.newLine && !d.oldLine).map((d) => `**\`${d.path}\`**\n\n${d.body}`);
    const body = [summary, ...fileNotes].filter(Boolean).join('\n\n---\n\n');
    if (!approve && !body && !lineDrafts.length) return;
    await this.call('POST', `/repos/${review.repoId}/pulls/${review.number}/reviews`, {
      commit_id: review.headSha,
      event: approve ? 'APPROVE' : 'COMMENT',
      body: body || undefined,
      comments: lineDrafts.map((d) => ({
        path: d.path,
        body: d.body,
        line: d.newLine ?? d.oldLine,
        side: d.newLine ? 'RIGHT' : 'LEFT',
      })),
    });
    saveGithubDrafts(review.id, []);
  }
}

async function request<T>(baseUrl: string, token: string, method: string, path: string, body?: unknown, accept = 'application/vnd.github+json') {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = await res.json();
      msg = [j.message, ...(Array.isArray(j.errors) ? j.errors.map((e: { message?: string } | string) => (typeof e === 'string' ? e : e.message)) : [])]
        .filter(Boolean)
        .join(': ');
    } catch {
      /* body was not JSON */
    }
    throw new ApiError(res.status, `${res.status}: ${msg}`);
  }
  const text = await res.text();
  if (accept.includes('raw')) return text as T;
  return (text ? JSON.parse(text) : undefined) as T;
}
