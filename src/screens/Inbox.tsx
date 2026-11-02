import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  PROVIDER_LABEL,
  providerFor,
  type Person,
  type ProviderKind,
  type Providers,
  type Repo,
  type Review,
} from '../review';
import { loadRecent, loadWatched, reviewedSha } from '../storage';
import { loadInbox, taskKey, MERGED_DAYS, type InboxData, type TaskGroup } from '../tasks';

/**
 * `taskKey` is set when the reviews were opened from a task, so the review can lead back to it.
 * `queue` holds the task's other reviews still to do, in the order to offer them next.
 */
type Props = {
  providers: Providers;
  onOpen: (reviews: Review[], taskKey?: string, queue?: Review[]) => void;
  onOpenSettings: () => void;
};

type Tab = 'review' | 'recent' | 'repos';

const TABS: { id: Tab; label: string }[] = [
  { id: 'review', label: 'Do review' },
  { id: 'repos', label: 'Obserwowane' },
  { id: 'recent', label: 'Ostatnie' },
];

// Survives the Inbox unmounting while a deck is open, so coming back lands on the same tab.
let lastTab: Tab = 'review';
// Likewise for the expanded task, so finishing a review returns to that task's list.
let lastOpenTask: string | null = null;

type Status = {
  me: string;
  approvedBy: Person[];
  required: number;
  changesRequestedBy: Person[];
  approvedByMe: boolean;
  /** I viewed every file: at the current head commit, or before newer commits arrived. */
  seen: 'current' | 'stale' | null;
  /** Merged, approved by me, or approved by someone with no approvals left. */
  done: boolean;
};

type StatusLoader = (review: Review) => Promise<Status | null>;

// One loader per Inbox mount: statuses are cached while browsing tabs and refetched after a review.
const StatusContext = createContext<StatusLoader | null>(null);

function createStatusLoader(providers: Providers): StatusLoader {
  const cache = new Map<string, Promise<Status | null>>();
  const load = async (review: Review): Promise<Status | null> => {
    const provider = providers[review.provider];
    const status = await provider?.status(review).catch(() => null);
    if (!provider || !status) return null;
    const me = provider.me.username;
    const approvedByMe = status.approvedBy.some((u) => u.username === me);
    const fullyApproved = status.approvedBy.length > 0 && status.approvalsLeft !== undefined && status.approvalsLeft <= 0;
    const sha = reviewedSha(review);
    const seen = !sha ? null : sha === review.headSha ? 'current' : 'stale';
    return { ...status, me, approvedByMe, seen, done: review.state === 'merged' || approvedByMe || fullyApproved };
  };
  return (review) => {
    if (!cache.has(review.id)) cache.set(review.id, load(review));
    return cache.get(review.id)!;
  };
}

/** Statuses for all given reviews, or null until every one has loaded. */
function useStatuses(reviews: Review[] | null) {
  const loadStatus = useContext(StatusContext)!;
  const [statuses, setStatuses] = useState<Map<string, Status | null> | null>(null);

  useEffect(() => {
    if (!reviews) return;
    let cancelled = false;
    setStatuses(null);
    Promise.all(reviews.map(async (r) => [r.id, await loadStatus(r)] as const)).then(
      (entries) => !cancelled && setStatuses(new Map(entries)),
    );
    return () => {
      cancelled = true;
    };
  }, [reviews, loadStatus]);

  return statuses;
}

export function Inbox({ providers, onOpen, onOpenSettings }: Props) {
  const [tab, setTab] = useState<Tab>(lastTab);
  const loadStatus = useMemo(() => createStatusLoader(providers), [providers]);

  const select = (t: Tab) => {
    lastTab = t;
    setTab(t);
  };

  return (
    <StatusContext.Provider value={loadStatus}>
      <div className="screen">
        <div className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => select(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        {tab === 'review' && <ReviewInbox providers={providers} onOpen={onOpen} onOpenSettings={onOpenSettings} />}
        {tab === 'repos' && <WatchedFeed providers={providers} onOpen={onOpen} onOpenSettings={onOpenSettings} />}
        {tab === 'recent' && <RecentList providers={providers} onOpen={onOpen} onOpenSettings={onOpenSettings} />}
      </div>
    </StatusContext.Provider>
  );
}

function ShowHidden({ count, shown, label, onToggle }: { count: number; shown: boolean; label: string; onToggle: () => void }) {
  if (!count) return null;
  return (
    <button className="link small show-hidden" onClick={onToggle}>
      {shown ? `Ukryj ${label}` : `Pokaż ${label} (${count})`}
    </button>
  );
}

type InboxItem = { kind: 'task'; task: TaskGroup } | { kind: 'review'; review: Review };

const updatedAt = (r: Review) => Date.parse(r.updatedAt) || 0;
const itemUpdatedAt = (item: InboxItem) =>
  item.kind === 'review' ? updatedAt(item.review) : Math.max(...item.task.reviews.map(updatedAt));

/** Tasks (several reviews under one ticket, expandable) and single reviews in one list. */
function ReviewInbox({ providers, onOpen }: Props) {
  const [data, setData] = useState<InboxData | null>(null);
  const [open, setOpenState] = useState<string | null>(lastOpenTask);
  const setOpen = (key: string | null) => {
    lastOpenTask = key;
    setOpenState(key);
  };
  const [showDone, setShowDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const all = useMemo(() => (data ? [...data.tasks.flatMap((g) => g.reviews), ...data.singles] : null), [data]);
  const statuses = useStatuses(all);

  useEffect(() => {
    loadInbox(providers).then(setData, (e) => setError(String(e.message ?? e)));
  }, [providers]);

  if (error) return <div className="error">{error}</div>;
  if (!data || !statuses) return <div className="loading">Ładuję…</div>;

  const taskDone = (g: TaskGroup) => g.reviews.every((r) => statuses.get(r.id)?.done);
  // A single review I approved hides until it's merged; merged ones stay visible for a while.
  const singleDone = (r: Review) => r.state !== 'merged' && !!statuses.get(r.id)?.approvedByMe;

  const active: InboxItem[] = [
    ...data.tasks.filter((g) => !taskDone(g)).map((task) => ({ kind: 'task' as const, task })),
    ...data.singles.filter((r) => r.state !== 'merged' && !singleDone(r)).map((review) => ({ kind: 'review' as const, review })),
  ].sort((a, b) => itemUpdatedAt(b) - itemUpdatedAt(a));
  const merged = data.singles.filter((r) => r.state === 'merged');
  const done: InboxItem[] = [
    ...data.tasks.filter(taskDone).map((task) => ({ kind: 'task' as const, task })),
    ...data.singles.filter(singleDone).map((review) => ({ kind: 'review' as const, review })),
  ];

  const renderTask = (g: TaskGroup) => (
    <TaskCard
      key={g.key}
      task={g}
      statuses={statuses}
      expanded={open === g.key}
      onToggle={() => setOpen(open === g.key ? null : g.key)}
      onOpen={(reviews, queue) => {
        setOpen(g.key);
        onOpen(reviews, g.key, queue);
      }}
    />
  );

  const renderItem = (item: InboxItem) =>
    item.kind === 'task' ? (
      renderTask(item.task)
    ) : (
      <ReviewRow key={item.review.id} review={item.review} status={statuses.get(item.review.id)} chip onClick={() => onOpen([item.review])} />
    );

  return (
    <div className="list">
      {data.errors.map((e) => (
        <div key={e} className="error">
          {e}
        </div>
      ))}
      {!active.length && <div className="empty">Nic nie czeka na Twoje review 🎉</div>}
      {active.map(renderItem)}
      {merged.length > 0 && <div className="section-title">Zmergowane w ostatnich {MERGED_DAYS} dniach</div>}
      {merged.map((r) => (
        <ReviewRow key={r.id} review={r} status={statuses.get(r.id)} chip onClick={() => onOpen([r])} />
      ))}
      <ShowHidden count={done.length} shown={showDone} label="zakończone" onToggle={() => setShowDone(!showDone)} />
      {showDone && done.map(renderItem)}
    </div>
  );
}

type TaskCardProps = {
  task: TaskGroup;
  statuses: Map<string, Status | null>;
  expanded: boolean;
  onToggle: () => void;
  onOpen: (reviews: Review[], queue?: Review[]) => void;
};

/** Several reviews under one ticket: opens as one deck, or expands into its reviews. */
function TaskCard({ task: g, statuses, expanded, onToggle, onOpen }: TaskCardProps) {
  const isDone = (r: Review) => !!statuses.get(r.id)?.done;
  return (
    <div className={`group${g.reviews.every(isDone) ? ' finished' : ''}`}>
      <div className="group-head" onClick={onToggle}>
        <div>
          <div className="group-title">
            <span className="kind-chip task">TASK</span> {g.key}
          </div>
          <div className="meta">
            {g.reviews.length} MR · {g.reviews.filter(isDone).length} gotowe · {new Set(g.reviews.map((r) => r.repo)).size} repo ·{' '}
            {expanded ? 'zwiń ▴' : 'pokaż ▾'}
          </div>
        </div>
        <button
          className="primary small"
          onClick={(e) => {
            e.stopPropagation();
            // Merged reviews can't be reviewed any more, unless nothing else is left.
            const pending = g.reviews.filter((r) => r.state !== 'merged');
            onOpen(pending.length ? pending : g.reviews);
          }}
        >
          Review całości
        </button>
      </div>
      {expanded &&
        g.reviews.map((r, i) => {
          // The ones after this review first, then wrap around to the ones before it.
          const queue = [...g.reviews.slice(i + 1), ...g.reviews.slice(0, i)].filter((o) => o.state !== 'merged' && !isDone(o));
          return <ReviewRow key={r.id} review={r} status={statuses.get(r.id)} onClick={() => onOpen([r], queue)} />;
        })}
    </div>
  );
}

/** Feed items: reviews sharing a task key become one task, placed where its most recently updated review would be. */
function groupFeed(reviews: Review[]): InboxItem[] {
  const keyOf = (r: Review) => taskKey(r)?.toLowerCase() ?? `review:${r.id}`;
  const byKey = new Map<string, Review[]>();
  for (const r of reviews) byKey.set(keyOf(r), [...(byKey.get(keyOf(r)) ?? []), r]);
  const items: InboxItem[] = [];
  const placed = new Set<string>();
  for (const r of reviews) {
    const key = keyOf(r);
    const group = byKey.get(key)!;
    if (group.length === 1) items.push({ kind: 'review', review: r });
    else if (!placed.has(key)) {
      placed.add(key);
      items.push({ kind: 'task', task: { key: taskKey(r)!, reviews: group } });
    }
  }
  return items;
}

function timeAgo(ms: number) {
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 1) return 'przed chwilą';
  if (minutes < 60) return `${minutes} min temu`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} godz. temu`;
  return `${Math.round(hours / 24)} dni temu`;
}

function RecentList({ providers, onOpen }: Props) {
  // Only reviews from providers that are still connected.
  const [recent] = useState(() => loadRecent().filter((e) => providers[e.review.provider]));
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const statuses = useStatuses(reviews);

  useEffect(() => {
    // Stored copies are snapshots from when the review was opened; refresh them to show merges etc.
    Promise.all(recent.map((e) => providerFor(providers, e.review).refresh(e.review).catch(() => e.review))).then(setReviews);
  }, [providers, recent]);

  if (!recent.length) return <div className="empty">Tu pojawią się MR, które otworzysz w aplikacji.</div>;
  if (!reviews || !statuses) return <div className="loading">Ładuję…</div>;

  return (
    <div className="list">
      {reviews.map((r, i) => (
        <ReviewRow key={r.id} review={r} status={statuses.get(r.id)} onClick={() => onOpen([r])}>
          <div className="meta">Otwarte {timeAgo(recent[i].openedAt)}</div>
        </ReviewRow>
      ))}
    </div>
  );
}

const FEED_DAYS = 2;

const watchedLabel = (watched: Repo[]) => {
  const groups = watched.filter((r) => r.group).length;
  const repos = watched.length - groups;
  return [groups && `${groups} ${groups === 1 ? 'projekt' : 'projekty'}`, repos && `${repos} repo`].filter(Boolean).join(' + ');
};

/** Recent reviews (open and merged) in the repositories picked in the settings, newest first. */
function WatchedFeed({ providers, onOpen, onOpenSettings }: Props) {
  const [watched] = useState(() => loadWatched().filter((r) => providers[r.provider]));
  const [days, setDays] = useState(FEED_DAYS);
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const statuses = useStatuses(reviews);

  useEffect(() => {
    if (!watched.length) return;
    let cancelled = false;
    setLoadingMore(true);
    const since = new Date(Date.now() - days * 86400000);
    const failed: string[] = [];
    Promise.all(
      watched.map((repo) =>
        providers[repo.provider]!.repoReviews(repo, since).catch((e) => {
          failed.push(`${repo.path}: ${e instanceof Error ? e.message : e}`);
          return [];
        }),
      ),
    ).then((found) => {
      if (cancelled) return;
      // A repository can also be watched through its group: show each review once.
      const unique = [...new Map(found.flat().map((r) => [r.id, r])).values()];
      setReviews(unique.sort((x, y) => updatedAt(y) - updatedAt(x)));
      setErrors(failed);
      setLoadingMore(false);
    });
    return () => {
      cancelled = true;
    };
  }, [providers, watched, days]);

  if (!watched.length) {
    return (
      <div className="empty">
        <p>Wybierz repozytoria, które chcesz obserwować — zobaczysz tu ich najnowsze MR, także zmergowane.</p>
        <button className="primary" onClick={onOpenSettings}>
          Wybierz repozytoria
        </button>
      </div>
    );
  }
  if (!reviews || !statuses) return <div className="loading">Ładuję…</div>;

  return (
    <div className="list">
      <div className="feed-head meta">
        {watchedLabel(watched)} · ostatnie {days} dni ·{' '}
        <button className="link small" onClick={onOpenSettings}>
          zmień repozytoria
        </button>
      </div>
      {errors.map((e) => (
        <div key={e} className="error">
          {e}
        </div>
      ))}
      {reviews.length === 0 && <div className="empty">Brak MR z ostatnich {days} dni.</div>}
      {groupFeed(reviews).map((item) => {
        if (item.kind === 'task') {
          const g = item.task;
          return (
            <TaskCard
              key={g.key}
              task={g}
              statuses={statuses}
              expanded={open === g.key}
              onToggle={() => setOpen(open === g.key ? null : g.key)}
              onOpen={(rs, queue) => onOpen(rs, g.key, queue)}
            />
          );
        }
        const r = item.review;
        return (
          <ReviewRow key={r.id} review={r} status={statuses.get(r.id)} onClick={() => onOpen([r])}>
            <div className="meta">Aktualizacja {timeAgo(updatedAt(r))}</div>
          </ReviewRow>
        );
      })}
      <button className="secondary" disabled={loadingMore} onClick={() => setDays((d) => d * 2)}>
        {loadingMore ? 'Ładuję…' : `Pokaż starsze (ostatnie ${days * 2} dni)`}
      </button>
    </div>
  );
}

function ProviderChip({ kind }: { kind: ProviderKind }) {
  return <span className={`provider-chip ${kind}`}>{PROVIDER_LABEL[kind]}</span>;
}

/** `chip` marks a standalone review in a list that also holds tasks. */
type ReviewRowProps = { review: Review; status?: Status | null; chip?: boolean; onClick: () => void; children?: React.ReactNode };

function ReviewRow({ review, status, chip, onClick, children }: ReviewRowProps) {
  return (
    <div className={`row-item${status?.approvedByMe ? ' approved' : status?.seen === 'current' ? ' seen' : ''}`} onClick={onClick}>
      <div className="meta">
        {chip && <span className="kind-chip">{review.provider === 'github' ? 'PR' : 'MR'}</span>}
        <ProviderChip kind={review.provider} />
        {review.ref}
        {review.draft && <span className="badge">draft</span>}
        {review.state === 'merged' && <span className="badge merged">merged</span>}
        {review.state === 'closed' && <span className="badge">zamknięty</span>}
      </div>
      <div className="title">{review.title}</div>
      <div className="meta">
        {review.author.name} · <code>{review.sourceBranch}</code> → <code>{review.targetBranch}</code>
      </div>
      {status && <StatusBadges status={status} />}
      {children}
    </div>
  );
}

const firstNames = (users: Person[]) => users.map((u) => u.name.split(' ')[0]).join(', ');

// My own approval is shown as the row's green frame; badges cover everyone else.
function StatusBadges({ status }: { status: Status }) {
  const { me, approvedBy, required, changesRequestedBy, approvedByMe, seen } = status;
  const others = approvedBy.filter((u) => u.username !== me);
  const count = required ? `${approvedBy.length}/${required}` : String(approvedBy.length);

  return (
    <div className="mr-status">
      {!approvedByMe && seen && (
        <span className="status seen">{seen === 'current' ? '👁 Obejrzane, bez approve' : '👁 Obejrzane — są nowe zmiany'}</span>
      )}
      {others.length > 0 ? (
        <span className="status ok" title={others.map((u) => u.name).join(', ')}>
          ✓ {count} approve: {firstNames(others)}
        </span>
      ) : (
        !approvedByMe && <span className="status muted">Brak approve{required ? ` (0/${required})` : ''}</span>
      )}
      {changesRequestedBy.length > 0 && (
        <span className="status bad">
          ✗ {changesRequestedBy.some((u) => u.username === me) ? 'Prosisz o zmiany' : `Zmiany: ${firstNames(changesRequestedBy)}`}
        </span>
      )}
    </div>
  );
}
