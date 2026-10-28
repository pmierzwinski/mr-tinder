import { useEffect, useMemo, useState } from 'react';
import { GitLab, type MergeRequest } from './gitlab';
import { Deck } from './screens/Deck';
import { Inbox } from './screens/Inbox';
import { Login } from './screens/Login';
import { clearSession, loadSession, saveSession, type Session } from './storage';

export function App() {
  const [session, setSession] = useState<Session | null>(loadSession);
  const [deck, setDeck] = useState<MergeRequest[] | null>(null);
  const api = useMemo(() => (session ? new GitLab(session.baseUrl, session.token) : null), [session]);

  // Make the phone's back gesture leave the deck instead of the app.
  useEffect(() => {
    if (!deck) return;
    history.pushState({ deck: true }, '');
    const onPop = () => setDeck(null);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [deck]);

  if (!session || !api) {
    return (
      <Login
        onLogin={(s) => {
          saveSession(s);
          setSession(s);
        }}
      />
    );
  }

  if (deck) {
    return <Deck api={api} mrs={deck} onExit={() => history.back()} />;
  }

  return (
    <>
      <header className="app-header">
        <span>MR Tinder</span>
        <button
          className="link"
          onClick={() => {
            clearSession();
            setSession(null);
          }}
        >
          <img src={session.user.avatar_url} alt="" /> wyloguj
        </button>
      </header>
      <Inbox api={api} username={session.user.username} onOpen={setDeck} />
    </>
  );
}
