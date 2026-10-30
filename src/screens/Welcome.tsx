import { useState } from 'react';
import { ConnectSheet } from '../components/ConnectSheet';
import type { Account } from '../providers';
import type { ProviderKind } from '../review';

/** First run: no accounts yet, so offer to connect GitLab and/or GitHub. */
export function Welcome({ onConnected }: { onConnected: (account: Account) => void }) {
  const [connecting, setConnecting] = useState<ProviderKind | null>(null);

  return (
    <div className="screen login">
      <h1>MR Tinder</h1>
      <p className="hint">Code review na telefonie: przesuń w prawo — obejrzane, w lewo — komentarz.</p>
      <p className="hint">Połącz konto, z którego chcesz robić review. Drugie możesz dodać później w ustawieniach.</p>
      <button className="primary big" onClick={() => setConnecting('gitlab')}>
        Połącz GitLab
      </button>
      <button className="secondary big" onClick={() => setConnecting('github')}>
        Połącz GitHub
      </button>
      {connecting && (
        <ConnectSheet
          kind={connecting}
          onConnected={(account) => {
            setConnecting(null);
            onConnected(account);
          }}
          onCancel={() => setConnecting(null)}
        />
      )}
    </div>
  );
}
