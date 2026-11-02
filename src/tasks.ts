import { loadJiraProjects, saveJiraProjects } from './storage';
import { PROVIDER_LABEL, type ProviderKind, type Providers, type Review, type ReviewProvider } from './review';

export type TaskGroup = { key: string; reviews: Review[] };

export const MERGED_DAYS = 7;

// Unambiguous ticket keys: upper case in titles and descriptions ("WOH-123: Fix…", ".../browse/WOH-123"),
// any case right after a "/" in branches ("feature/woh-123-fix").
const STRICT_TEXT = /(?<![A-Za-z0-9])([A-Z][A-Z0-9]{1,9})-(\d+)(?![0-9])/g;
const STRICT_BRANCH = /(?:^|\/)([a-z][a-z0-9]{1,9})-(\d+)(?=$|[^0-9])/gi;
// Prefixes that look like keys but aren't Jira projects ("UTF-8", "SHA-256", branches like "fix-2", "release-3").
const NOT_PROJECTS = new Set([
  ...['UTF', 'SHA', 'MD', 'ISO', 'RFC', 'HTTP', 'TLS', 'SSL', 'IPV', 'X', 'V', 'VER', 'VERSION'],
  ...['FIX', 'BUGFIX', 'HOTFIX', 'FEAT', 'FEATURE', 'RELEASE', 'PART', 'STEP', 'PHASE', 'ROUND', 'TRY', 'ATTEMPT', 'BUILD', 'WIP'],
]);

/** Jira projects seen so far (and added in the settings): once known, their keys are found however written. */
let projects = new Set(loadJiraProjects());
let looseKey: RegExp | null = null;

/** Remembers the projects of the unambiguous keys in these titles and branches (descriptions mention too much), so "woh 5" or "WOH_5" elsewhere is found too. */
export function learnJiraProjects(reviews: Review[]) {
  const found = new Set(projects);
  for (const r of reviews) {
    for (const [text, re] of [[r.title, STRICT_TEXT], [r.sourceBranch, STRICT_BRANCH]] as const) {
      for (const m of text.matchAll(re)) if (!NOT_PROJECTS.has(m[1].toUpperCase())) found.add(m[1].toUpperCase());
    }
  }
  if (found.size !== projects.size) {
    projects = found;
    looseKey = null;
    saveJiraProjects([...found]);
  }
}

export const jiraProjects = () => [...projects];

export function setJiraProjects(list: string[]) {
  projects = new Set(list.map((p) => p.trim().toUpperCase()).filter(Boolean));
  looseKey = null;
  saveJiraProjects([...projects]);
}

/** "WOH-5", "woh-5", "WOH_5", "woh 5", "[WOH5]" — for the known projects, anywhere in the text. */
function loose() {
  if (!projects.size) return null;
  looseKey ??= new RegExp(`(?<![A-Za-z0-9])(${[...projects].join('|')})[\\s_-]?(\\d+)(?![0-9])`, 'i');
  return looseKey;
}

function keyIn(text: string | undefined, re: RegExp | null) {
  if (!text || !re) return null;
  const m = new RegExp(re.source, re.flags.replace('g', '')).exec(text);
  return m && !NOT_PROJECTS.has(m[1].toUpperCase()) ? `${m[1].toUpperCase()}-${Number(m[2])}` : null;
}

/** The ticket of the review: from the title first, then the branch, then the description. */
export function jiraKey(r: Review): string | null {
  return (
    keyIn(r.title, STRICT_TEXT) ??
    keyIn(r.title, loose()) ??
    keyIn(r.sourceBranch, STRICT_BRANCH) ??
    keyIn(r.sourceBranch, loose()) ??
    keyIn(r.description, STRICT_TEXT) ??
    keyIn(r.description, loose())
  );
}

// GitLab marks unfinished MRs in the title; that's not part of the task name.
const DRAFT_PREFIX = /^\s*(\[(draft|wip)\]|\(?(draft|wip)\)?:)\s*/i;
// "jan.kowalski/…": people put their name before the title; a dot and no spaces tells it from a task name.
const AUTHOR_PREFIX = /^[^\s/:]+\.[^\s/:]+\s*\/\s*/;
// "fix: …", "feat(ui): …" describe the kind of change, not a task, so they don't group.
const CHANGE_TYPE = /^(feat|feature|fix|bugfix|hotfix|chore|refactor|docs|test|tests|style|perf|build|ci|revert|merge)(\(.*\))?!?$/i;

/**
 * Naming convention: the title part before the first ":" or "/" is the task name
 * ("Task abc: doing something", "Task abc/ doing something" → "Task abc").
 */
export function titleGroup(r: Review): string | null {
  const title = r.title.replace(DRAFT_PREFIX, '').replace(AUTHOR_PREFIX, '');
  const end = title.search(/[:/]/);
  const group = end > 0 ? title.slice(0, end).trim().replace(/\s+/g, ' ') : '';
  return group && !CHANGE_TYPE.test(group) ? group : null;
}

/** What groups reviews into one task: the Jira key, otherwise the title part before ":" or "/". */
export const taskKey = (r: Review) => jiraKey(r) ?? titleGroup(r);

const IS_JIRA_KEY = /^[A-Z][A-Z0-9]{1,9}-\d+$/;

export function belongsTo(r: Review, key: string) {
  if (!IS_JIRA_KEY.test(key)) return titleGroup(r)?.toLowerCase() === key.toLowerCase();
  return jiraKey(r) === key;
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
  learnJiraProjects([...reviewing, ...mine]);
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
