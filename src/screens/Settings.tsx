import { useEffect, useState } from 'react';
import { ConnectSheet } from '../components/ConnectSheet';
import type { Account } from '../providers';
import { PROVIDER_LABEL, type ProviderKind } from '../review';
import { loadAiKey, saveAiKey } from '../storage';

type Props = {
  accounts: Account[];
  onAccountsChange: (accounts: Account[]) => void;
  onClose: () => void;
};

const KINDS: ProviderKind[] = ['gitlab', 'github'];

export function Settings({ accounts, onAccountsChange, onClose }: Props) {
  const [connecting, setConnecting] = useState<ProviderKind | null>(null);
  const [aiKey, setAiKey] = useState(loadAiKey);
  const [saved, setSaved] = useState(false);

  // The confirmation lives on the save button itself, where the user is looking.
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(t);
  }, [saved]);

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

      <section className="settings-section">
        <h3>AI: quiz i kolejność plików (Claude)</h3>
        <label>
          Klucz API Claude (Anthropic)
          <input
            value={aiKey}
            onChange={(e) => setAiKey(e.target.value)}
            type="password"
            autoComplete="off"
            placeholder="sk-ant-…"
          />
        </label>
        {aiKey.trim() && !aiKey.trim().startsWith('sk-ant-') && (
          <div className="error">To nie wygląda na klucz Anthropic — powinien zaczynać się od „sk-ant-”.</div>
        )}
        <p className="hint small">
          Z kluczem możesz po review wygenerować quiz z 5 pytań o zmiany, a w talii (🗺 → „Ułóż z AI”) poprosić o kolejność
          plików wzdłuż przepływu kodu. Klucz utworzysz w{' '}
          <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noreferrer">
            Claude Console
          </a>
          . Zostaje tylko na tym urządzeniu, a diffy trafiają do Anthropic tylko wtedy, gdy sam o to poprosisz.
        </p>
        <div className="warning">
          API Claude jest płatne (rozliczane od zużycia na koncie w Console). Wysyłając diffy, przekazujesz kod firmie
          Anthropic — upewnij się, że to zgodne z zasadami firmy.
        </div>
        <button
          className={`primary small${saved ? ' saved' : ''}`}
          onClick={() => {
            saveAiKey(aiKey.trim());
            setSaved(true);
          }}
        >
          {saved ? 'Zapisano ✓' : 'Zapisz klucz'}
        </button>
      </section>

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
