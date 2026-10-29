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
  author: User;
  references: { full: string };
  updated_at: string;
  diff_refs?: DiffRefs;
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

export type Position = DiffRefs & {
  position_type: 'text' | 'file';
  old_path: string;
  new_path: string;
  old_line?: number | null;
  new_line?: number | null;
};

export type DraftNote = { id: number; note: string; position?: Partial<Position> | null };

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | undefined>;

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

  private mrPath(mr: Pick<MergeRequest, 'project_id' | 'iid'>) {
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

  /** Searches open MRs in all visible projects by title/description. */
  searchMergeRequests(search: string) {
    return this.getAll<MergeRequest>('/merge_requests', { scope: 'all', state: 'opened', search }, 3);
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

  mergeRequest(mr: Pick<MergeRequest, 'project_id' | 'iid'>) {
    return this.get<MergeRequest>(this.mrPath(mr));
  }

  async diffs(mr: MergeRequest): Promise<FileDiff[]> {
    try {
      return await this.getAll<FileDiff>(`${this.mrPath(mr)}/diffs`);
    } catch (e) {
      // /diffs exists since GitLab 15.7; older instances only have /changes.
      if (!(e instanceof ApiError) || e.status !== 404) throw e;
      const res = await this.get<{ changes: FileDiff[] }>(`${this.mrPath(mr)}/changes`);
      return res.changes;
    }
  }

  /** File content at the MR's head commit, as lines. */
  async fileLines(mr: MergeRequest, path: string): Promise<string[]> {
    const ref = mr.diff_refs?.head_sha ?? mr.sha;
    const res = await fetch(
      `${this.baseUrl}/api/v4/projects/${mr.project_id}/repository/files/${encodeURIComponent(path)}/raw?ref=${ref}`,
      { headers: { 'PRIVATE-TOKEN': this.token } },
    );
    if (!res.ok) throw new ApiError(res.status, `${res.status}: ${res.statusText}`);
    const text = await res.text();
    const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));
    if (text.endsWith('\n')) lines.pop();
    return lines;
  }

  draftNotes(mr: MergeRequest) {
    return this.getAll<DraftNote>(`${this.mrPath(mr)}/draft_notes`);
  }

  createDraftNote(mr: MergeRequest, note: string, position?: Position) {
    return this.post<DraftNote>(`${this.mrPath(mr)}/draft_notes`, { note, position });
  }

  deleteDraftNote(mr: MergeRequest, id: number) {
    return this.request<void>('DELETE', `${this.mrPath(mr)}/draft_notes/${id}`);
  }

  publishDrafts(mr: MergeRequest) {
    return this.post<void>(`${this.mrPath(mr)}/draft_notes/bulk_publish`);
  }

  approve(mr: MergeRequest) {
    // Passing sha makes GitLab reject the approval if new commits landed after we loaded the diff.
    return this.post<void>(`${this.mrPath(mr)}/approve`, { sha: mr.sha });
  }
}
