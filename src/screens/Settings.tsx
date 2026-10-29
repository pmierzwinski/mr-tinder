import { useEffect, useState } from 'react';
import { GitLab } from '../gitlab';
import { providerForKey } from '../quiz';
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

  // The confirmation lives on the save button itself, where the user is looking.
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(t);
  }, [saved]);

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
        <button className="link small logout" onClick={() => confirm('Wylogować z GitLaba na tym urządzeniu?') && onLogout()}>
          Wyloguj
        </button>
      </section>

      <section className="settings-section">
        <h3>AI (quiz po review)</h3>
        <label>
          Klucz API — Gemini (darmowy) albo Anthropic
          <input
            value={aiKey}
            onChange={(e) => setAiKey(e.target.value)}
            type="password"
            autoComplete="off"
            placeholder="AIza… albo sk-ant-…"
          />
        </label>
        {aiKey.trim() && (
          <div className="meta">
            Rozpoznany dostawca: <b>{providerForKey(aiKey.trim()) === 'gemini' ? 'Google Gemini' : 'Anthropic Claude'}</b>
          </div>
        )}
        <p className="hint small">
          Po review możesz wygenerować quiz z 5 pytań o zmiany. Klucz Gemini utworzysz w{' '}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
            Google AI Studio
          </a>
          , klucz Anthropic w{' '}
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
            konsoli Anthropic
          </a>
          . Klucz zostaje tylko na tym urządzeniu, a diffy trafiają do dostawcy tylko przy generowaniu quizu.
        </p>
        {providerForKey(aiKey.trim()) === 'gemini' && aiKey.trim() && (
          <div className="warning">
            Uwaga: w darmowym planie Gemini Google może wykorzystywać przesłane treści (tu: diffy kodu) do ulepszania
            swoich produktów, a mogą je czytać ludzie. Upewnij się, że to zgodne z zasadami firmy.
          </div>
        )}
      </section>

      {error && <div className="error">{error}</div>}

      <div className="bottom-bar">
        <button className={`primary big${saved ? ' saved' : ''}`} onClick={save} disabled={busy || !url}>
          {busy ? 'Sprawdzam…' : saved ? 'Zapisano ✓' : 'Zapisz'}
        </button>
      </div>
    </div>
  );
}
