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

function mentionsKey(r: Review, key: string) {
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

  const seeds = new Map<string, Review[]>();
  for (const r of [...reviewing, ...mine]) {
    const key = jiraKey(r);
    if (key) seeds.set(key, [...(seeds.get(key) ?? []), r]);
  }

  const groups = await Promise.all(
    [...seeds].map(async ([key, own]) => {
      const found = await Promise.all(list.map((p) => p.search(key).catch(() => [])));
      return { key, reviews: unique([...own, ...found.flat().filter((r) => mentionsKey(r, key))]) };
    }),
  );

  const tasks = groups.filter((g) => g.reviews.length > 1);
  const inTask = new Set(tasks.flatMap((g) => g.reviews.map((r) => r.id)));
  const singles = unique(reviewing).filter((r) => !inTask.has(r.id));
  return { tasks, singles, errors };
}
