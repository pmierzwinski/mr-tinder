import { useEffect, useMemo, useState } from 'react';
import { ConnectSheet } from '../components/ConnectSheet';
import type { Account } from '../providers';
import { PROVIDER_LABEL, type ProviderKind, type Providers, type Repo, type ReviewProvider } from '../review';
import { jiraProjects, setJiraProjects } from '../tasks';
import { loadIgnore, saveIgnore, type IgnoreRules } from '../ignore';
import { loadWatched, saveWatched } from '../storage';

type Props = {
  accounts: Account[];
  providers: Providers;
  onAccountsChange: (accounts: Account[]) => void;
  onClose: () => void;
};

const KINDS: ProviderKind[] = ['gitlab', 'github'];

export function Settings({ accounts, providers, onAccountsChange, onClose }: Props) {
  const [connecting, setConnecting] = useState<ProviderKind | null>(null);

  const accountOf = (kind: ProviderKind) => accounts.find((a) => a.kind === kind);

  const disconnect = (kind: ProviderKind) => {
    if (!confirm(`Odłączyć ${PROVIDER_LABEL[kind]} na tym urządzeniu?`)) return;
    onAccountsChange(accounts.filter((a) => a.kind !== kind));
  };

  return (
    <div className="screen settings">
      <div className="deck-top">
        <button className="link" onClick={onClose}>
          ← Wróć
        </button>
      </div>
      <h2 className="summary-title">Ustawienia</h2>

      {KINDS.map((kind) => {
        const account = accountOf(kind);
        return (
          <section key={kind} className="settings-section">
            <h3>{PROVIDER_LABEL[kind]}</h3>
            {account ? (
              <>
                <div className="meta">
                  Połączono jako {account.user.name} (@{account.user.username}) · {account.baseUrl.replace(/^https:\/\//, '')}
                </div>
                <div className="row">
                  <button className="secondary small" onClick={() => setConnecting(kind)}>
                    Zmień token
                  </button>
                  <button className="link small logout" onClick={() => disconnect(kind)}>
                    Odłącz
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="hint small">Nie połączono — MR z {PROVIDER_LABEL[kind]} nie pojawią się na liście.</p>
                <button className="primary small" onClick={() => setConnecting(kind)}>
                  Połącz {PROVIDER_LABEL[kind]}
                </button>
              </>
            )}
          </section>
        );
      })}


      <WatchedRepos providers={providers} />

      <IgnoreSettings />

      <JiraSettings />

      {connecting && (
        <ConnectSheet
          kind={connecting}
          current={accountOf(connecting)}
          onConnected={(account) => {
            onAccountsChange([...accounts.filter((a) => a.kind !== account.kind), account]);
            setConnecting(null);
          }}
          onCancel={() => setConnecting(null)}
        />
      )}
    </div>
  );
}

// Group and project ids are separate sequences on GitLab.
const repoKey = (r: Repo) => `${r.provider}:${r.group ? 'group:' : ''}${r.id}`;

/** Picks the repositories whose recent reviews the "Obserwowane" tab lists. */
function WatchedRepos({ providers }: { providers: Providers }) {
  const [watched, setWatched] = useState(loadWatched);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Repo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = useMemo(() => Object.values(providers) as ReviewProvider[], [providers]);

  useEffect(() => {
    if (!query.trim()) {
      setFound(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      Promise.all(list.map((p) => p.repos(query))).then(
        (r) => !cancelled && (setFound(r.flat()), setError(null)),
        (e) => !cancelled && setError(String(e instanceof Error ? e.message : e)),
      );
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [list, query]);

  const update = (next: Repo[]) => {
    saveWatched(next);
    setWatched(next);
  };
  const isWatched = (r: Repo) => watched.some((w) => repoKey(w) === repoKey(r));

  return (
    <section className="settings-section">
      <h3>Obserwowane repozytoria</h3>
      <p className="hint small">
        Ich najnowsze MR (także zmergowane) zobaczysz w zakładce „Obserwowane”. Cały projekt (grupa GitLaba / organizacja GitHuba)
        obejmuje też repozytoria dodane do niego później.
      </p>
      {watched.length > 0 && (
        <ul className="watched">
          {watched.map((r) => (
            <li key={repoKey(r)}>
              <span className={`provider-chip ${r.provider}`}>{PROVIDER_LABEL[r.provider]}</span>
              <RepoPath repo={r} />
              <button className="link small" onClick={() => update(watched.filter((w) => repoKey(w) !== repoKey(r)))}>
                usuń
              </button>
            </li>
          ))}
        </ul>
      )}
      <input className="search" placeholder="Dodaj repozytorium lub cały projekt — wpisz nazwę…" value={query} onChange={(e) => setQuery(e.target.value)} />
      {error && <div className="error">{error}</div>}
      {found && found.length === 0 && <p className="hint small">Nic nie znaleziono.</p>}
      {found && found.length > 0 && (
        <ul className="watched found">
          {found.map((r) => (
            <li key={repoKey(r)}>
              <span className={`provider-chip ${r.provider}`}>{PROVIDER_LABEL[r.provider]}</span>
              <RepoPath repo={r} />
              {isWatched(r) ? (
                <span className="hint small">✓ obserwujesz</span>
              ) : (
                <button className="secondary small" onClick={() => update([...watched, r])}>
                  {r.group ? '+ Cały projekt' : '+ Obserwuj'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RepoPath({ repo }: { repo: Repo }) {
  return (
    <span className="watched-path">
      {repo.group && '📁 '}
      {repo.path}
      {repo.group && <span className="hint small"> · cały projekt</span>}
    </span>
  );
}

const toLines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean);

/** Files the deck leaves out: generated code, lock files, Unity .meta and the like. */
function IgnoreSettings() {
  const [rules] = useState(loadIgnore);
  const [paths, setPaths] = useState(rules.paths.join('\n'));
  const [contents, setContents] = useState(rules.contents.join('\n'));

  const save = (next: Partial<IgnoreRules>) => saveIgnore({ ...loadIgnore(), ...next });

  return (
    <section className="settings-section">
      <h3>Pomijane pliki</h3>
      <p className="hint small">Pasujące pliki nie trafiają do talii (lista jest w podsumowaniu). Jedna reguła w linii.</p>
      <label>
        Nazwa / ścieżka pliku — np. <code>*.meta</code>, <code>package-lock.json</code>, <code>Generated/</code>
        <textarea
          rows={3}
          value={paths}
          placeholder={'*.meta\npackage-lock.json'}
          onChange={(e) => {
            setPaths(e.target.value);
            save({ paths: toLines(e.target.value) });
          }}
        />
      </label>
      <label>
        Tekst w zmianach pliku — np. <code>&lt;auto-generated&gt;</code>
        <textarea
          rows={3}
          value={contents}
          placeholder="<auto-generated>"
          onChange={(e) => {
            setContents(e.target.value);
            save({ contents: toLines(e.target.value) });
          }}
        />
      </label>
    </section>
  );
}

/** Jira projects whose keys are found however written ("woh 5", "WOH_5"); filled in automatically as well. */
function JiraSettings() {
  const [text, setText] = useState(() => jiraProjects().join(', '));
  return (
    <section className="settings-section">
      <h3>Projekty Jiry</h3>
      <p className="hint small">
        Klucz ticketu (np. <code>WOH-5</code>) ma pierwszeństwo przy grupowaniu. Dla tych projektów znajdzie go w tytule, branchu
        albo opisie MR zapisany dowolnie: <code>woh-5</code>, <code>WOH_5</code>, <code>woh 5</code>, <code>[WOH5]</code>. Projekty
        dopisują się same, gdy gdzieś pojawi się klucz w postaci <code>WOH-5</code>.
      </p>
      <input
        className="search"
        placeholder="WOH, ABC"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setJiraProjects(e.target.value.split(/[\s,;]+/));
        }}
      />
    </section>
  );
}
