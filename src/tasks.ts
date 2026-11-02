import { PROVIDER_LABEL, type ProviderKind, type Providers, type Review, type ReviewProvider } from './review';

export type TaskGroup = { key: string; reviews: Review[] };

export const MERGED_DAYS = 7;

// Titles use upper case ("WOH-123: Fix…"); branches are often lower case ("feature/woh-123-fix").
const KEY_IN_TITLE = /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/;
const KEY_IN_BRANCH = /(?:^|\/)([a-z][a-z0-9]{1,9}-\d+)(?=$|[^0-9])/i;

export function jiraKey(r: Review): string | null {
  const key = KEY_IN_TITLE.exec(r.title)?.[1] ?? KEY_IN_BRANCH.exec(r.sourceBranch)?.[1];
  return key?.toUpperCase() ?? null;
}

/** Naming convention: the title part before the first "/" ("Zadanie 1/ winman", "Zadanie 1 / UI" → "Zadanie 1"). */
export function titleGroup(r: Review): string | null {
  const slash = r.title.indexOf('/');
  const group = slash > 0 ? r.title.slice(0, slash).trim().replace(/\s+/g, ' ') : '';
  return group || null;
}

/** What groups reviews into one task: the Jira key, otherwise the title part before "/". */
export const taskKey = (r: Review) => jiraKey(r) ?? titleGroup(r);

const IS_JIRA_KEY = /^[A-Z][A-Z0-9]{1,9}-\d+$/;

export function belongsTo(r: Review, key: string) {
  if (!IS_JIRA_KEY.test(key)) return titleGroup(r)?.toLowerCase() === key.toLowerCase();
  const re = new RegExp(`(^|[^A-Za-z0-9])${key}(?![0-9])`, 'i');
  return re.test(r.title) || re.test(r.sourceBranch);
}

const unique = (reviews: Review[]) => [...new Map(reviews.map((r) => [r.id, r])).values()];

export type InboxData = {
  /** Tickets with more than one review, possibly spanning GitLab and GitHub. */
  tasks: TaskGroup[];
  /** Reviews waiting for me that aren't part of a multi-review ticket. */
  singles: Review[];
  /** Providers that failed to load; the rest of the inbox still shows. */
  errors: string[];
};

/**
 * Everything for the "Do review" tab. Tickets come from reviews assigned to me or waiting for my
 * review (open, or merged recently) in every connected provider; each ticket then collects every
 * open or merged review mentioning it in my repositories, again across providers.
 */
export async function loadInbox(providers: Providers): Promise<InboxData> {
  const list = Object.values(providers) as ReviewProvider[];
  const errors: string[] = [];
  const failed = (kind: ProviderKind) => (e: unknown) => {
    errors.push(`${PROVIDER_LABEL[kind]}: ${e instanceof Error ? e.message : e}`);
    return null;
  };

  const inboxes = await Promise.all(list.map((p) => p.inbox(MERGED_DAYS).catch(failed(p.kind))));
  const reviewing = inboxes.flatMap((i) => i?.reviewing ?? []);
  const mine = inboxes.flatMap((i) => i?.mine ?? []);

  // Keyed case-insensitively, labelled as first written ("Zadanie 1" and "zadanie 1" are one task).
  const seeds = new Map<string, { key: string; reviews: Review[] }>();
  for (const r of [...reviewing, ...mine]) {
    const key = taskKey(r);
    if (!key) continue;
    const seed = seeds.get(key.toLowerCase()) ?? { key, reviews: [] };
    seeds.set(key.toLowerCase(), { ...seed, reviews: [...seed.reviews, r] });
  }

  const groups = await Promise.all(
    [...seeds.values()].map(async ({ key, reviews: own }) => {
      const found = await Promise.all(list.map((p) => p.search(key).catch(() => [])));
      return { key, reviews: unique([...own, ...found.flat().filter((r) => belongsTo(r, key))]) };
    }),
  );

  const tasks = groups.filter((g) => g.reviews.length > 1);
  const inTask = new Set(tasks.flatMap((g) => g.reviews.map((r) => r.id)));
  const singles = unique(reviewing).filter((r) => !inTask.has(r.id));
  return { tasks, singles, errors };
}
