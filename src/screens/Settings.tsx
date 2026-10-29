import { useState } from 'react';
import { GitLab } from '../gitlab';
import { loadAiKey, normalizeUrl, saveAiKey, saveCredentials, type Session } from '../storage';

type Props = {
  session: Session;
  onSessionChange: (s: Session) => void;
  onLogout: () => void;
  onClose: () => void;
};

export function Settings({ session, onSessionChange, onLogout, onClose }: Props) {
  const [baseUrl, setBaseUrl] = useState(session.baseUrl.replace(/^https:\/\//, ''));
  // Empty token field = keep the current one.
  const [token, setToken] = useState('');
  const [aiKey, setAiKey] = useState(loadAiKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const url = normalizeUrl(baseUrl);
  const gitlabChanged = url !== session.baseUrl || token.trim() !== '';
  const tokenLink = `${url}/-/user_settings/personal_access_tokens?name=MR%20Tinder&scopes=api`;

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      if (gitlabChanged) {
        const newToken = token.trim() || session.token;
        // Check the new URL/token before replacing the working ones.
        const user = await new GitLab(url, newToken).currentUser();
        saveCredentials({ baseUrl: url, token: newToken });
        onSessionChange({ baseUrl: url, token: newToken, user });
        setToken('');
      }
      saveAiKey(aiKey.trim());
      setSaved(true);
    } catch (e) {
      setError(`GitLab odrzucił dane: ${e instanceof Error ? e.message : e}`);
    }
    setBusy(false);
  };

  return (
    <div className="screen settings">
      <div className="deck-top">
        <button className="link" onClick={onClose}>
          ← Wróć
        </button>
      </div>
      <h2 className="summary-title">Ustawienia</h2>

      <section className="settings-section">
        <h3>GitLab</h3>
        <label>
          Adres
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
        </label>
        <label>
          <span>
            Nowy Personal Access Token (scope <code>api</code>)
          </span>
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            type="password"
            autoComplete="off"
            placeholder={`obecny: ••••${session.token.slice(-4)}`}
          />
        </label>
        <div className="meta">
          Zalogowany jako {session.user.name} (@{session.user.username}) ·{' '}
          <a href={tokenLink} target="_blank" rel="noreferrer">
            utwórz nowy token
          </a>
        </div>
      </section>

      <section className="settings-section">
        <h3>AI (quiz po review)</h3>
        <label>
          Klucz API Anthropic
          <input
            value={aiKey}
            onChange={(e) => setAiKey(e.target.value)}
            type="password"
            autoComplete="off"
            placeholder="sk-ant-…"
          />
        </label>
        <div className="meta">
          Po review możesz wygenerować quiz z 5 pytań o zmiany. Klucz utworzysz w{' '}
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
            konsoli Anthropic
          </a>
          ; zostaje tylko na tym urządzeniu, a diffy trafiają do API Anthropic tylko przy generowaniu quizu.
        </div>
      </section>

      {error && <div className="error">{error}</div>}
      {saved && <div className="done">Zapisano ✓</div>}

      <div className="bottom-bar">
        <button className="secondary big" onClick={onLogout}>
          Wyloguj
        </button>
        <button className="primary big" onClick={save} disabled={busy || !url}>
          {busy ? 'Sprawdzam…' : 'Zapisz'}
        </button>
      </div>
    </div>
  );
}
