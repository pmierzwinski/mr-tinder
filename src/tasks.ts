import type { GitLab, MergeRequest } from './gitlab';

export type TaskGroup = { key: string; mrs: MergeRequest[] };

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

/**
 * Tickets come from MRs assigned to me or waiting for my review; each ticket then collects
 * every open MR mentioning it (title or branch) in projects I'm a member of.
 */
export async function loadTaskGroups(api: GitLab, username: string): Promise<TaskGroup[]> {
  const [assigned, reviewing, member] = await Promise.all([
    api.assignedMergeRequests(username),
    api.reviewRequests(username),
    api.memberProjectIds(),
  ]);
  const seeds = new Map<string, MergeRequest[]>();
  for (const mr of [...assigned, ...reviewing]) {
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

  const latest = (g: TaskGroup) => Math.max(...g.mrs.map((mr) => Date.parse(mr.updated_at) || 0));
  return groups.sort((a, b) => latest(b) - latest(a));
}
