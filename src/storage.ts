import type { MergeRequest, User } from './gitlab';

export type Session = { baseUrl: string; token: string; user: User };

const SESSION_KEY = 'mr-tinder:session';

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

export const loadSession = () => readJson<Session>(SESSION_KEY);
export const saveSession = (s: Session) => writeJson(SESSION_KEY, s);
export const clearSession = () => localStorage.removeItem(SESSION_KEY);

// Kept separately from the session so the GitLab URL survives logging out.
const URL_KEY = 'mr-tinder:gitlab-url';
export const loadGitLabUrl = () => readJson<string>(URL_KEY) ?? '';
export const saveGitLabUrl = (url: string) => writeJson(URL_KEY, url);

// GitLab keeps its own "Viewed" checkbox in the browser only (no API), so we track it ourselves.
// We store a hash of each file's diff: when a new push changes the file, it shows up again.
type ViewedMap = Record<string, string>;

const viewedKey = (mr: MergeRequest) => `mr-tinder:viewed:${mr.project_id}:${mr.iid}`;

export function hashDiff(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function isViewed(mr: MergeRequest, path: string, hash: string) {
  return readJson<ViewedMap>(viewedKey(mr))?.[path] === hash;
}

export function setViewed(mr: MergeRequest, path: string, hash: string | null) {
  const map = readJson<ViewedMap>(viewedKey(mr)) ?? {};
  if (hash) map[path] = hash;
  else delete map[path];
  writeJson(viewedKey(mr), map);
}
