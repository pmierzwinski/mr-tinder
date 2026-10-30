import { useState } from 'react';
import { connectAccount, githubApiUrl, type Account } from '../providers';
import { PROVIDER_LABEL, type ProviderKind } from '../review';
import { normalizeUrl } from '../storage';

type Props = {
  kind: ProviderKind;
  /** The account being reconnected (e.g. to change its token). */
  current?: Account;
  onConnected: (account: Account) => void;
  onCancel: () => void;
};

/** Bottom sheet that checks a token against GitLab/GitHub and returns the account to store. */
export function ConnectSheet({ kind, current, onConnected, onCancel }: Props) {
  const [address, setAddress] = useState(() => initialAddress(kind, current));
  const [token, setToken] = useState('');
  const [enterprise, setEnterprise] = useState(kind === 'github' && !!address);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const baseUrl = kind === 'gitlab' ? normalizeUrl(address) : githubApiUrl(address);
  const webUrl = kind === 'gitlab' ? baseUrl : `https://${address.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '') || 'github.com'}`;
  const tokenLink =
    kind === 'gitlab'
      ? `${webUrl}/-/user_settings/personal_access_tokens?name=MR%20Tinder&scopes=api`
      : `${webUrl}/settings/tokens/new?scopes=repo&description=MR%20Tinder`;

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      onConnected(await connectAccount(kind, baseUrl, token.trim()));
    } catch (e) {
      setError(`${PROVIDER_LABEL[kind]} odrzucił dane: ${e instanceof Error ? e.message : e}`);
      setBusy(false);
    }
  };

  return (
    <div className="sheet-backdrop" onClick={onCancel}>
      <div className="sheet connect" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-title">{current ? `Zmień token ${PROVIDER_LABEL[kind]}` : `Połącz ${PROVIDER_LABEL[kind]}`}</div>

        {kind === 'gitlab' && (
          <label>
            Adres GitLaba
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              inputMode="url"
              placeholder="gitlab.example.com"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>
        )}
        {kind === 'github' &&
          (enterprise ? (
            <label>
              Adres GitHub Enterprise (puste = github.com)
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                inputMode="url"
                placeholder="github.example.com"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </label>
          ) : (
            <button className="link small" onClick={() => setEnterprise(true)}>
              Używasz GitHub Enterprise na własnym serwerze?
            </button>
          ))}

        <label>
          <span>
            {kind === 'gitlab' ? (
              <>
                Personal Access Token (scope <code>api</code>)
              </>
            ) : (
              <>
                Personal access token (classic, scope <code>repo</code>)
              </>
            )}
          </span>
          <input value={token} onChange={(e) => setToken(e.target.value)} type="password" autoComplete="off" autoFocus />
        </label>
        {(kind === 'github' || baseUrl) && (
          <a href={tokenLink} target="_blank" rel="noreferrer">
            Utwórz token w {PROVIDER_LABEL[kind]} →
          </a>
        )}
        {kind === 'github' && (
          <p className="hint small">
            Jeśli organizacja używa logowania SSO, po utworzeniu tokena kliknij przy nim „Configure SSO” i autoryzuj organizację.
          </p>
        )}
        <p className="hint small">Token zostaje tylko na tym urządzeniu.</p>

        {error && <div className="error">{error}</div>}
        <div className="row">
          <button className="secondary" onClick={onCancel}>
            Anuluj
          </button>
          <button className="primary" disabled={!token.trim() || !baseUrl || busy} onClick={connect}>
            {busy ? 'Sprawdzam…' : 'Połącz'}
          </button>
        </div>
      </div>
    </div>
  );
}

function initialAddress(kind: ProviderKind, current?: Account) {
  if (!current) return '';
  if (kind === 'gitlab') return current.baseUrl.replace(/^https:\/\//, '');
  // Only Enterprise hosts are shown; github.com is the default.
  const host = current.baseUrl.replace(/^https?:\/\//, '').replace(/\/api\/v3$/, '');
  return host === 'api.github.com' ? '' : host;
}
