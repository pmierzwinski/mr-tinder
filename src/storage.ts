import type { Account } from './providers';
import type { Draft, Review } from './review';

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode) - state just won't persist */
  }
}

// Connected GitLab/GitHub accounts. Older versions stored a single GitLab login as "session".
const ACCOUNTS_KEY = 'mr-tinder:accounts';
const LEGACY_SESSION_KEY = 'mr-tinder:session';

type LegacySession = { baseUrl: string; token: string; user: { username: string; name: string; avatar_url?: string } };

export function loadAccounts(): Account[] {
  const accounts = readJson<Account[]>(ACCOUNTS_KEY);
  if (accounts) return accounts;
  const legacy = readJson<LegacySession>(LEGACY_SESSION_KEY);
  if (!legacy) return [];
  const { username, name, avatar_url } = legacy.user;
  return [{ kind: 'gitlab', baseUrl: legacy.baseUrl, token: legacy.token, user: { username, name, avatarUrl: avatar_url } }];
}

export const saveAccounts = (accounts: Account[]) => writeJson(ACCOUNTS_KEY, accounts);

// Reviews opened in the app, newest first, for the "Ostatnie" tab.
export type RecentEntry = { review: Review; openedAt: number };
const RECENT_KEY = 'mr-tinder:recent-reviews';
const RECENT_LIMIT = 30;

export const loadRecent = () => readJson<RecentEntry[]>(RECENT_KEY) ?? [];

export function addRecent(reviews: Review[]) {
  const now = Date.now();
  const ids = new Set(reviews.map((r) => r.id));
  const rest = loadRecent().filter((e) => !ids.has(e.review.id));
  writeJson(RECENT_KEY, [...reviews.map((review) => ({ review, openedAt: now })), ...rest].slice(0, RECENT_LIMIT));
}

// GitHub has no API for building up a pending review comment by comment, so drafts wait here until submit.
const githubDraftsKey = (reviewId: string) => `mr-tinder:github-drafts:${reviewId}`;
export const loadGithubDrafts = (reviewId: string) => readJson<Draft[]>(githubDraftsKey(reviewId)) ?? [];
export const saveGithubDrafts = (reviewId: string, drafts: Draft[]) => writeJson(githubDraftsKey(reviewId), drafts);

// Gemini API key for generating review quizzes; stays on this device only.
const AI_KEY = 'mr-tinder:ai-key';
export const loadAiKey = () => readJson<string>(AI_KEY) ?? '';
export const saveAiKey = (key: string) => writeJson(AI_KEY, key);

// Per-device display preference: smaller code font in the diff.
const SMALL_CODE_KEY = 'mr-tinder:small-code';
export const loadSmallCode = () => readJson<boolean>(SMALL_CODE_KEY) ?? false;
export const saveSmallCode = (on: boolean) => writeJson(SMALL_CODE_KEY, on);

/** Accepts "gitlab.example.com", "https://gitlab.example.com/" etc. */
export function normalizeUrl(input: string) {
  const url = input.trim().replace(/\/+$/, '');
  if (!url) return '';
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

// GitLab keeps its own "Viewed" checkbox in the browser only (no API), so we track it ourselves.
// We store a hash of each file's diff: when a new push changes the file, it shows up again.
type ViewedMap = Record<string, string>;

// GitLab keeps the key format of earlier versions so already viewed files stay viewed.
const viewedKey = (r: Review) =>
  r.provider === 'gitlab' ? `mr-tinder:viewed:${r.repoId}:${r.number}` : `mr-tinder:viewed:${r.id}`;

export function hashDiff(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function isViewed(review: Review, path: string, hash: string) {
  return readJson<ViewedMap>(viewedKey(review))?.[path] === hash;
}

export function setViewed(review: Review, path: string, hash: string | null) {
  const map = readJson<ViewedMap>(viewedKey(review)) ?? {};
  if (hash) map[path] = hash;
  else delete map[path];
  writeJson(viewedKey(review), map);
}
