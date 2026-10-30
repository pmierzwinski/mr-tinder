import { GitLab } from '../gitlab';
import type { Person, ProviderKind, Providers } from '../review';
import { GITHUB_API, GitHubProvider } from './githubProvider';
import { GitLabProvider } from './gitlabProvider';

/** A connected GitLab or GitHub account; `baseUrl` is the GitLab instance or the GitHub API root. */
export type Account = { kind: ProviderKind; baseUrl: string; token: string; user: Person };

export function createProviders(accounts: Account[]): Providers {
  const providers: Providers = {};
  for (const a of accounts) {
    providers[a.kind] = a.kind === 'gitlab' ? new GitLabProvider(new GitLab(a.baseUrl, a.token), a.user) : new GitHubProvider(a.baseUrl, a.token, a.user);
  }
  return providers;
}

/** Checks the token against the server and returns the account to store. */
export async function connectAccount(kind: ProviderKind, baseUrl: string, token: string): Promise<Account> {
  const user = kind === 'gitlab' ? await GitLabProvider.connect(baseUrl, token) : await GitHubProvider.connect(baseUrl, token);
  return { kind, baseUrl, token, user };
}

/** github.com, or the API root of a GitHub Enterprise host ("github.example.com" -> ".../api/v3"). */
export function githubApiUrl(host: string) {
  const h = host.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return !h || h === 'github.com' || h === 'api.github.com' ? GITHUB_API : `https://${h}/api/v3`;
}
