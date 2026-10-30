import { useState } from 'react';
import { ConnectSheet } from '../components/ConnectSheet';
import type { Account } from '../providers';
import { PROVIDER_LABEL, type ProviderKind } from '../review';

type Props = {
  accounts: Account[];
  onAccountsChange: (accounts: Account[]) => void;
  onClose: () => void;
};

const KINDS: ProviderKind[] = ['gitlab', 'github'];

export function Settings({ accounts, onAccountsChange, onClose }: Props) {
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
