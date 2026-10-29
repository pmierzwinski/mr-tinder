import { useEffect, useMemo, useState } from 'react';
import { GitLab, type MergeRequest, type User } from './gitlab';
import { Deck } from './screens/Deck';
import { Inbox } from './screens/Inbox';
import { Login } from './screens/Login';
import { addRecent, clearSession, loadSession, saveSession, type Session } from './storage';

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
          <Avatar user={session.user} /> wyloguj
        </button>
      </header>
      <Inbox
        api={api}
        username={session.user.username}
        onOpen={(mrs) => {
          addRecent(mrs);
          setDeck(mrs);
        }}
      />
    </>
  );
}

// GitLab-hosted avatars often need a GitLab session cookie, so fall back to initials when they fail.
function Avatar({ user }: { user: User }) {
  const [failed, setFailed] = useState(!user.avatar_url);
  const initials = user.name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return failed ? (
    <span className="avatar">{initials}</span>
  ) : (
    <img className="avatar" src={user.avatar_url} alt="" onError={() => setFailed(true)} />
  );
}
