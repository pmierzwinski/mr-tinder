import { useState } from 'react';
import { GitLab } from '../gitlab';
import { loadGitLabUrl, saveGitLabUrl, type Session } from '../storage';

export function Login({ onLogin }: { onLogin: (s: Session) => void }) {
  const [baseUrl, setBaseUrl] = useState(loadGitLabUrl);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const url = baseUrl.trim().replace(/\/+$/, '');
  const tokenLink = `${url}/-/user_settings/personal_access_tokens?name=MR%20Tinder&scopes=api`;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const user = await new GitLab(url, token.trim()).currentUser();
      saveGitLabUrl(url);
      onLogin({ baseUrl: url, token: token.trim(), user });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
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
          placeholder="https://gitlab.example.com"
          autoCapitalize="off"
        />
      </label>
      <label>
        Personal Access Token (scope <code>api</code>)
        <input value={token} onChange={(e) => setToken(e.target.value)} type="password" autoComplete="off" />
      </label>
      {url && (
        <a href={tokenLink} target="_blank" rel="noreferrer">
          Utwórz token w GitLabie →
        </a>
      )}
      {error && <div className="error">{error}</div>}
      <button className="primary" disabled={!url || !token.trim() || busy} onClick={submit}>
        {busy ? 'Sprawdzam…' : 'Zaloguj'}
      </button>
      <p className="hint small">Adres i token zostają tylko w tej przeglądarce (localStorage).</p>
    </div>
  );
}
