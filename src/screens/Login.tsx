import { useState } from 'react';
import { GitLab } from '../gitlab';
import { loadCredentials, normalizeUrl, saveCredentials, type Session } from '../storage';

export function Login({ onLogin }: { onLogin: (s: Session) => void }) {
  const [saved] = useState(loadCredentials);
  const [baseUrl, setBaseUrl] = useState(saved.baseUrl.replace(/^https:\/\//, ''));
  const [token, setToken] = useState(saved.token);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const url = normalizeUrl(baseUrl);
  const tokenLink = `${url}/-/user_settings/personal_access_tokens?name=MR%20Tinder&scopes=api`;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const user = await new GitLab(url, token.trim()).currentUser();
      saveCredentials({ baseUrl: url, token: token.trim() });
      onLogin({ baseUrl: url, token: token.trim(), user });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const forgetToken = () => {
    setToken('');
    saveCredentials({ baseUrl: url, token: '' });
  };

  return (
    <div className="screen login">
      <h1>MR Tinder</h1>
      <p className="hint">Przesuń w prawo — obejrzane. W lewo — komentarz.</p>
      <label>
        GitLab
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          inputMode="url"
          placeholder="gitlab.example.com"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </label>
      <label>
        <span>
          Personal Access Token (scope <code>api</code>)
        </span>
        <input value={token} onChange={(e) => setToken(e.target.value)} type="password" autoComplete="off" />
      </label>
      {saved.token && token === saved.token ? (
        <button className="link" onClick={forgetToken}>
          Zapomnij zapisany token
        </button>
      ) : (
        url && (
          <a href={tokenLink} target="_blank" rel="noreferrer">
            Utwórz token w GitLabie →
          </a>
        )
      )}
      {error && <div className="error">{error}</div>}
      <button className="primary" disabled={!url || !token.trim() || busy} onClick={submit}>
        {busy ? 'Sprawdzam…' : 'Zaloguj'}
      </button>
      <p className="hint small">Adres i token zostają tylko w tej przeglądarce (localStorage).</p>
    </div>
  );
}
