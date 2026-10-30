import type { DiffLine } from '../diff';
import { ApiError, GitLab, type DraftNote, type MergeRequest, type MrRef, type Position, type User } from '../gitlab';
import type { Draft, FileDiff, Person, Repo, Review, ReviewProvider, ReviewStatus } from '../review';

const toPerson = (u: User): Person => ({ username: u.username, name: u.name, avatarUrl: u.avatar_url });

function toReview(mr: MergeRequest): Review {
  return {
    id: `gitlab:${mr.project_id}:${mr.iid}`,
    provider: 'gitlab',
    repoId: String(mr.project_id),
    repo: mr.references.full.split('!')[0],
    number: mr.iid,
    ref: mr.references.full,
    title: mr.title,
    description: mr.description ?? '',
    sourceBranch: mr.source_branch,
    targetBranch: mr.target_branch,
    webUrl: mr.web_url,
    headSha: mr.diff_refs?.head_sha ?? mr.sha,
    baseSha: mr.diff_refs?.base_sha,
    startSha: mr.diff_refs?.start_sha,
    draft: mr.draft,
    state: mr.state === 'merged' ? 'merged' : mr.state === 'opened' || mr.state === 'locked' ? 'open' : 'closed',
    author: toPerson(mr.author),
    updatedAt: mr.updated_at,
  };
}

const ref = (r: Review): MrRef => ({ project_id: r.repoId, iid: r.number });

function toDraft(n: DraftNote, fallbackPath?: string): Draft {
  return {
    id: String(n.id),
    body: n.note,
    path: n.position?.new_path ?? n.position?.old_path ?? fallbackPath,
    oldLine: n.position?.old_line ?? undefined,
    newLine: n.position?.new_line ?? undefined,
  };
}

export class GitLabProvider implements ReviewProvider {
  readonly kind = 'gitlab' as const;
  readonly canCommentOnContext = true;
  private memberIds: Promise<Set<number>> | null = null;

  constructor(
    private readonly api: GitLab,
    readonly me: Person,
  ) {}

  static async connect(baseUrl: string, token: string) {
    const api = new GitLab(baseUrl, token);
    return toPerson(await api.currentUser());
  }

  async inbox(mergedDays: number) {
    const me = this.me.username;
    const [reviewing, reviewedMerged, mine, mineMerged] = await Promise.all([
      this.api.reviewRequests(me),
      this.api.recentlyMerged('reviewer_username', me, mergedDays),
      this.api.assignedMergeRequests(me),
      this.api.recentlyMerged('assignee_username', me, mergedDays),
    ]);
    return { reviewing: [...reviewing, ...reviewedMerged].map(toReview), mine: [...mine, ...mineMerged].map(toReview) };
  }

  async search(term: string) {
    this.memberIds ??= this.api.memberProjectIds();
    const [found, member] = await Promise.all([this.api.searchMergeRequests(term), this.memberIds]);
    return found.filter((mr) => member.has(mr.project_id)).map(toReview);
  }

  async byBranch(branch: string) {
    return (await this.api.mergeRequestsByBranch(branch)).map(toReview);
  }

  async repos(query: string): Promise<Repo[]> {
    const projects = await this.api.searchProjects(query);
    return projects.map((p) => ({ provider: 'gitlab', id: String(p.id), name: p.name, path: p.path_with_namespace }));
  }

  async repoReviews(repo: Repo) {
    return (await this.api.projectMergeRequests(Number(repo.id))).map(toReview);
  }

  async refresh(review: Review) {
    return toReview(await this.api.mergeRequest(ref(review)));
  }

  files(review: Review) {
    return this.api.diffs(ref(review));
  }

  fileLines(review: Review, path: string) {
    return this.api.fileLines(review.repoId, review.headSha, path);
  }

  async status(review: Review): Promise<ReviewStatus | null> {
    // Reviewer states need a newer GitLab; without them we just show approvals.
    const [approvals, reviewers] = await Promise.all([
      this.api.approvals(ref(review)).catch(() => null),
      this.api.reviewers(ref(review)).catch(() => []),
    ]);
    if (!approvals) return null;
    return {
      approvedBy: (approvals.approved_by ?? []).map((a) => toPerson(a.user)),
      required: approvals.approvals_required ?? 0,
      approvalsLeft: approvals.approvals_left,
      changesRequestedBy: (Array.isArray(reviewers) ? reviewers : [])
        .filter((r) => r.state === 'requested_changes')
        .map((r) => toPerson(r.user)),
    };
  }

  async drafts(review: Review) {
    return (await this.api.draftNotes(ref(review))).map((n) => toDraft(n));
  }

  async addDraft(review: Review, file: FileDiff, line: DiffLine | null, body: string) {
    const position: Position = {
      base_sha: review.baseSha!,
      start_sha: review.startSha!,
      head_sha: review.headSha,
      old_path: file.old_path,
      new_path: file.new_path,
      position_type: line ? 'text' : 'file',
      old_line: line && line.type !== 'add' ? line.oldLine : undefined,
      new_line: line && line.type !== 'del' ? line.newLine : undefined,
    };
    try {
      return toDraft(await this.api.createDraftNote(ref(review), body, position));
    } catch (e) {
      // File-level positions need a recent GitLab; fall back to a general comment naming the file.
      if (line || !(e instanceof ApiError) || e.status !== 400) throw e;
      return toDraft(await this.api.createDraftNote(ref(review), `**\`${file.new_path}\`**\n\n${body}`), file.new_path);
    }
  }

  async updateDraft(review: Review, draft: Draft, body: string) {
    const updated = await this.api.updateDraftNote(ref(review), Number(draft.id), body);
    // Keep our copy of the path: file-level fallback notes only have it locally.
    return { ...draft, body: updated?.note ?? body };
  }

  async deleteDraft(review: Review, draft: Draft) {
    await this.api.deleteDraftNote(ref(review), Number(draft.id));
  }

  async submit(review: Review, { summary, approve }: { summary?: string; approve: boolean }) {
    if (summary) await this.api.createDraftNote(ref(review), summary);
    const pending = await this.api.draftNotes(ref(review));
    if (pending.length) await this.api.publishDrafts(ref(review));
    if (approve) await this.api.approve(ref(review), review.headSha);
  }
}
