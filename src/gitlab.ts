import { splitLines, type FileDiff } from './review';

export type User = { id: number; username: string; name: string; avatar_url: string };

export type Project = { id: number; path_with_namespace: string; name: string; last_activity_at: string };

export type DiffRefs = { base_sha: string; start_sha: string; head_sha: string };

export type MergeRequest = {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  description: string | null;
  source_branch: string;
  target_branch: string;
  web_url: string;
  sha: string;
  draft: boolean;
  state: 'opened' | 'closed' | 'merged' | 'locked';
  author: User;
  references: { full: string };
  updated_at: string;
  diff_refs?: DiffRefs;
};

export type Position = DiffRefs & {
  position_type: 'text' | 'file';
  old_path: string;
  new_path: string;
  old_line?: number | null;
  new_line?: number | null;
};

export type DraftNote = { id: number; note: string; position?: Partial<Position> | null };

export type Approvals = {
  approved?: boolean;
  approvals_required?: number;
  approvals_left?: number;
  approved_by: { user: User }[];
};

export type ReviewerState = 'unreviewed' | 'review_started' | 'reviewed' | 'requested_changes' | 'approved' | 'unapproved';
export type Reviewer = { user: User; state?: ReviewerState };

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | undefined>;

/** What addresses one merge request. */
export type MrRef = { project_id: number | string; iid: number };

export class GitLab {
  constructor(readonly baseUrl: string, private readonly token: string) {}

  private async request<T>(method: string, path: string, opts: { query?: Query; body?: unknown } = {}) {
    const url = new URL(`${this.baseUrl}/api/v4${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const res = await fetch(url, {
      method,
      headers: { 'PRIVATE-TOKEN': this.token, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) {
      let msg = res.statusText;
      try {
        const j = await res.json();
        const m = j.message ?? j.error ?? j;
        msg = typeof m === 'string' ? m : JSON.stringify(m);
      } catch {
        /* body was not JSON */
      }
      throw new ApiError(res.status, `${res.status}: ${msg}`);
    }
    const text = await res.text();
    return { data: (text ? JSON.parse(text) : undefined) as T, headers: res.headers };
  }

  private get<T>(path: string, query?: Query) {
    return this.request<T>('GET', path, { query }).then((r) => r.data);
  }

  private post<T>(path: string, body?: unknown) {
    return this.request<T>('POST', path, { body }).then((r) => r.data);
  }

  private async getAll<T>(path: string, query: Query = {}, maxPages = 20): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; page && page <= maxPages; ) {
      const { data, headers } = await this.request<T[]>('GET', path, { query: { ...query, per_page: 100, page } });
      out.push(...data);
      page = Number(headers.get('X-Next-Page') || 0);
    }
    return out;
  }

  private mrPath(mr: MrRef) {
    return `/projects/${mr.project_id}/merge_requests/${mr.iid}`;
  }

  currentUser() {
    return this.get<User>('/user');
  }

  reviewRequests(username: string) {
    return this.getAll<MergeRequest>('/merge_requests', { scope: 'all', state: 'opened', reviewer_username: username });
  }

  assignedMergeRequests(username: string) {
    return this.getAll<MergeRequest>('/merge_requests', { scope: 'all', state: 'opened', assignee_username: username });
  }

  /** MRs merged in the last `days` days where I'm the reviewer or the assignee. */
  recentlyMerged(role: 'reviewer_username' | 'assignee_username', username: string, days: number) {
    const updatedAfter = new Date(Date.now() - days * 86400000).toISOString();
    return this.getAll<MergeRequest>('/merge_requests', { scope: 'all', state: 'merged', [role]: username, updated_after: updatedAfter });
  }

  /** Searches open and merged MRs in all visible projects by title/description. */
  async searchMergeRequests(search: string) {
    const found = await this.getAll<MergeRequest>('/merge_requests', { scope: 'all', state: 'all', search }, 3);
    return found.filter((mr) => mr.state !== 'closed');
  }

  async memberProjectIds() {
    const projects = await this.getAll<Project>('/projects', { membership: true, simple: true });
    return new Set(projects.map((p) => p.id));
  }

  mergeRequestsByBranch(sourceBranch: string) {
    return this.getAll<MergeRequest>('/merge_requests', { scope: 'all', state: 'opened', source_branch: sourceBranch });
  }

  searchProjects(search: string) {
    return this.get<Project[]>('/projects', {
      membership: true,
      simple: true,
      search: search || undefined,
      order_by: 'last_activity_at',
      per_page: 30,
    });
  }

  projectMergeRequests(projectId: number) {
    return this.getAll<MergeRequest>(`/projects/${projectId}/merge_requests`, { state: 'opened' });
  }

  mergeRequest(mr: MrRef) {
    return this.get<MergeRequest>(this.mrPath(mr));
  }

  async diffs(mr: MrRef): Promise<FileDiff[]> {
    try {
      return await this.getAll<FileDiff>(`${this.mrPath(mr)}/diffs`);
    } catch (e) {
      // /diffs exists since GitLab 15.7; older instances only have /changes.
      if (!(e instanceof ApiError) || e.status !== 404) throw e;
      const res = await this.get<{ changes: FileDiff[] }>(`${this.mrPath(mr)}/changes`);
      return res.changes;
    }
  }

  approvals(mr: MrRef) {
    return this.get<Approvals>(`${this.mrPath(mr)}/approvals`);
  }

  reviewers(mr: MrRef) {
    return this.get<Reviewer[]>(`${this.mrPath(mr)}/reviewers`);
  }

  /** File content at commit `ref`, as lines. */
  async fileLines(projectId: number | string, ref: string, path: string): Promise<string[]> {
    const res = await fetch(
      `${this.baseUrl}/api/v4/projects/${projectId}/repository/files/${encodeURIComponent(path)}/raw?ref=${ref}`,
      { headers: { 'PRIVATE-TOKEN': this.token } },
    );
    if (!res.ok) throw new ApiError(res.status, `${res.status}: ${res.statusText}`);
    return splitLines(await res.text());
  }

  draftNotes(mr: MrRef) {
    return this.getAll<DraftNote>(`${this.mrPath(mr)}/draft_notes`);
  }

  createDraftNote(mr: MrRef, note: string, position?: Position) {
    return this.post<DraftNote>(`${this.mrPath(mr)}/draft_notes`, { note, position });
  }

  updateDraftNote(mr: MrRef, id: number, note: string) {
    return this.request<DraftNote>('PUT', `${this.mrPath(mr)}/draft_notes/${id}`, { body: { note } }).then((r) => r.data);
  }

  deleteDraftNote(mr: MrRef, id: number) {
    return this.request<void>('DELETE', `${this.mrPath(mr)}/draft_notes/${id}`);
  }

  publishDrafts(mr: MrRef) {
    return this.post<void>(`${this.mrPath(mr)}/draft_notes/bulk_publish`);
  }

  /** Passing the head sha makes GitLab reject the approval if new commits landed after we loaded the diff. */
  approve(mr: MrRef, sha: string) {
    return this.post<void>(`${this.mrPath(mr)}/approve`, { sha });
  }
}
