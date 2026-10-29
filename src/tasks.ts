import type { GitLab, MergeRequest } from './gitlab';

export type TaskGroup = { key: string; mrs: MergeRequest[] };

export const MERGED_DAYS = 7;

// Titles use upper case ("WOH-123: Fix…"); branches are often lower case ("feature/woh-123-fix").
const KEY_IN_TITLE = /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/;
const KEY_IN_BRANCH = /(?:^|\/)([a-z][a-z0-9]{1,9}-\d+)(?=$|[^0-9])/i;

export function jiraKey(mr: MergeRequest): string | null {
  const key = KEY_IN_TITLE.exec(mr.title)?.[1] ?? KEY_IN_BRANCH.exec(mr.source_branch)?.[1];
  return key?.toUpperCase() ?? null;
}

function mentionsKey(mr: MergeRequest, key: string) {
  const re = new RegExp(`(^|[^A-Za-z0-9])${key}(?![0-9])`, 'i');
  return re.test(mr.title) || re.test(mr.source_branch);
}

export type InboxData = {
  /** Tickets with more than one MR. */
  tasks: TaskGroup[];
  /** MRs waiting for my review that aren't part of a multi-MR ticket. */
  singles: MergeRequest[];
};

/**
 * Everything for the "Do review" tab. Tickets come from MRs assigned to me or waiting for my review
 * (open, or merged recently); each ticket collects every open or merged MR mentioning it (title or
 * branch) in projects I'm a member of. Review requests without a multi-MR ticket stay single MRs.
 */
export async function loadInbox(api: GitLab, username: string): Promise<InboxData> {
  const [assigned, reviewing, assignedMerged, reviewedMerged, member] = await Promise.all([
    api.assignedMergeRequests(username),
    api.reviewRequests(username),
    // Recently merged ones keep finished work around instead of vanishing on merge.
    api.recentlyMerged('assignee_username', username, MERGED_DAYS),
    api.recentlyMerged('reviewer_username', username, MERGED_DAYS),
    api.memberProjectIds(),
  ]);
  const seeds = new Map<string, MergeRequest[]>();
  for (const mr of [...assigned, ...reviewing, ...assignedMerged, ...reviewedMerged]) {
    const key = jiraKey(mr);
    if (key) seeds.set(key, [...(seeds.get(key) ?? []), mr]);
  }

  const groups = await Promise.all(
    [...seeds].map(async ([key, own]) => {
      const found = await api.searchMergeRequests(key);
      const related = found.filter((mr) => member.has(mr.project_id) && mentionsKey(mr, key));
      const byId = new Map([...own, ...related].map((mr) => [mr.id, mr]));
      return { key, mrs: [...byId.values()] };
    }),
  );

  const tasks = groups.filter((g) => g.mrs.length > 1);
  const inTask = new Set(tasks.flatMap((g) => g.mrs.map((mr) => mr.id)));
  const singles = [...reviewing, ...reviewedMerged].filter((mr) => !inTask.has(mr.id));
  return { tasks, singles };
}
