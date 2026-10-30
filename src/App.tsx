import { useEffect, useMemo, useState } from 'react';
import { createProviders, type Account } from './providers';
import type { Person, Review } from './review';
import { Deck } from './screens/Deck';
import { Inbox } from './screens/Inbox';
import { Settings } from './screens/Settings';
import { Welcome } from './screens/Welcome';
import { addRecent, loadAccounts, saveAccounts } from './storage';

export function App() {
  const [accounts, setAccounts] = useState<Account[]>(loadAccounts);
  const [deck, setDeck] = useState<{ reviews: Review[]; taskKey?: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const providers = useMemo(() => createProviders(accounts), [accounts]);

  const updateAccounts = (next: Account[]) => {
    saveAccounts(next);
    setAccounts(next);
    // Disconnecting the last account leads back to the welcome screen, not to settings behind it.
    if (!next.length) setSettingsOpen(false);
  };

  // Make the phone's back gesture leave the deck instead of the app.
  useEffect(() => {
    if (!deck) return;
    history.pushState({ deck: true }, '');
    const onPop = () => setDeck(null);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [deck]);

  if (!accounts.length) {
    return <Welcome onConnected={(account) => updateAccounts([account])} />;
  }

  if (deck) {
    return (
      <Deck
        providers={providers}
        reviews={deck.reviews}
        exitLabel={deck.taskKey ? `Wróć do ${deck.taskKey}` : 'Lista MR'}
        onExit={() => history.back()}
      />
    );
  }

  if (settingsOpen) {
    return <Settings accounts={accounts} onAccountsChange={updateAccounts} onClose={() => setSettingsOpen(false)} />;
  }

  return (
    <>
      <header className="app-header">
        <span>MR Tinder</span>
        <button className="link settings-button" onClick={() => setSettingsOpen(true)} title="Ustawienia">
          {accounts.map((a) => (
            <Avatar key={a.kind} user={a.user} />
          ))}{' '}
          ⚙︎
        </button>
      </header>
      <Inbox
        providers={providers}
        onOpen={(reviews, taskKey) => {
          addRecent(reviews);
          setDeck({ reviews, taskKey });
        }}
      />
    </>
  );
}

// GitLab-hosted avatars often need a GitLab session cookie, so fall back to initials when they fail.
function Avatar({ user }: { user: Person }) {
  const [failed, setFailed] = useState(!user.avatarUrl);
  const initials = user.name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return failed ? (
    <span className="avatar">{initials}</span>
  ) : (
    <img className="avatar" src={user.avatarUrl} alt="" onError={() => setFailed(true)} />
  );
}
