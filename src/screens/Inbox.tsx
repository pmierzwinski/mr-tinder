import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { GitLab, MergeRequest, Project, User } from '../gitlab';
import { loadRecent } from '../storage';
import { loadInbox, MERGED_DAYS, type InboxData, type TaskGroup } from '../tasks';

/** `taskKey` is set when the MRs were opened from a task, so the review can lead back to it. */
type Props = { api: GitLab; username: string; onOpen: (mrs: MergeRequest[], taskKey?: string) => void };

type Tab = 'review' | 'recent' | 'repos';

const TABS: { id: Tab; label: string }[] = [
  { id: 'review', label: 'Do review' },
  { id: 'recent', label: 'Ostatnie' },
  { id: 'repos', label: 'Repozytoria' },
];

// Survives the Inbox unmounting while a deck is open, so coming back lands on the same tab.
let lastTab: Tab = 'review';
// Likewise for the expanded task, so finishing a review returns to that task's MR list.
let lastOpenTask: string | null = null;

type MrStatus = {
  me: string;
  approvedBy: User[];
  required: number;
  changes: User[];
  approvedByMe: boolean;
  /** Merged, approved by me, or approved by someone with no approvals left. */
  done: boolean;
};

type StatusLoader = (mr: MergeRequest) => Promise<MrStatus | null>;

// One loader per Inbox mount: statuses are cached while browsing tabs and refetched after a review.
const StatusContext = createContext<StatusLoader | null>(null);

function createStatusLoader(api: GitLab, username: string): StatusLoader {
  const cache = new Map<number, Promise<MrStatus | null>>();
  const load = async (mr: MergeRequest): Promise<MrStatus | null> => {
    // Reviewer states need a newer GitLab; without them we just show approvals.
    const [approvals, reviewers] = await Promise.all([api.approvals(mr).catch(() => null), api.reviewers(mr).catch(() => [])]);
    if (!approvals) return null;
    const approvedBy = (approvals.approved_by ?? []).map((a) => a.user);
    const approvedByMe = approvedBy.some((u) => u.username === username);
    return {
      me: username,
      approvedBy,
      required: approvals.approvals_required ?? 0,
      changes: (Array.isArray(reviewers) ? reviewers : []).filter((r) => r.state === 'requested_changes').map((r) => r.user),
      approvedByMe,
      done: mr.state === 'merged' || approvedByMe || (approvedBy.length > 0 && (approvals.approvals_left ?? 0) <= 0),
    };
  };
  return (mr) => {
    if (!cache.has(mr.id)) cache.set(mr.id, load(mr));
    return cache.get(mr.id)!;
  };
}

/** Statuses for all given MRs, or null until every one has loaded. */
function useStatuses(mrs: MergeRequest[] | null) {
  const loadStatus = useContext(StatusContext)!;
  const [statuses, setStatuses] = useState<Map<number, MrStatus | null> | null>(null);

  useEffect(() => {
    if (!mrs) return;
    let cancelled = false;
    setStatuses(null);
    Promise.all(mrs.map(async (mr) => [mr.id, await loadStatus(mr)] as const)).then(
      (entries) => !cancelled && setStatuses(new Map(entries)),
    );
    return () => {
      cancelled = true;
    };
  }, [mrs, loadStatus]);

  return statuses;
}

export function Inbox({ api, username, onOpen }: Props) {
  const [tab, setTab] = useState<Tab>(lastTab);
  const loadStatus = useMemo(() => createStatusLoader(api, username), [api, username]);

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
        {tab === 'review' && <ReviewInbox api={api} username={username} onOpen={onOpen} />}
        {tab === 'recent' && <RecentList api={api} onOpen={onOpen} />}
        {tab === 'repos' && <RepoBrowser api={api} onOpen={onOpen} />}
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

type InboxItem = { kind: 'task'; task: TaskGroup } | { kind: 'mr'; mr: MergeRequest };

const updatedAt = (mr: MergeRequest) => Date.parse(mr.updated_at) || 0;
const itemUpdatedAt = (item: InboxItem) =>
  item.kind === 'mr' ? updatedAt(item.mr) : Math.max(...item.task.mrs.map(updatedAt));

/** Tasks (several MRs under one ticket, expandable) and single MRs in one list. */
function ReviewInbox({ api, username, onOpen }: Props) {
  const [data, setData] = useState<InboxData | null>(null);
  const [open, setOpenState] = useState<string | null>(lastOpenTask);
  const setOpen = (key: string | null) => {
    lastOpenTask = key;
    setOpenState(key);
  };
  const [showDone, setShowDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allMrs = useMemo(() => (data ? [...data.tasks.flatMap((g) => g.mrs), ...data.singles] : null), [data]);
  const statuses = useStatuses(allMrs);

  useEffect(() => {
    loadInbox(api, username).then(setData, (e) => setError(String(e.message ?? e)));
  }, [api, username]);

  if (error) return <div className="error">{error}</div>;
  if (!data || !statuses) return <div className="loading">Ładuję…</div>;

  const taskDone = (g: TaskGroup) => g.mrs.every((mr) => statuses.get(mr.id)?.done);
  // A single MR I approved hides until it's merged; merged ones stay visible for a while.
  const singleDone = (mr: MergeRequest) => mr.state !== 'merged' && !!statuses.get(mr.id)?.approvedByMe;

  const active: InboxItem[] = [
    ...data.tasks.filter((g) => !taskDone(g)).map((task) => ({ kind: 'task' as const, task })),
    ...data.singles.filter((mr) => mr.state !== 'merged' && !singleDone(mr)).map((mr) => ({ kind: 'mr' as const, mr })),
  ].sort((a, b) => itemUpdatedAt(b) - itemUpdatedAt(a));
  const merged = data.singles.filter((mr) => mr.state === 'merged');
  const done: InboxItem[] = [
    ...data.tasks.filter(taskDone).map((task) => ({ kind: 'task' as const, task })),
    ...data.singles.filter(singleDone).map((mr) => ({ kind: 'mr' as const, mr })),
  ];

  const renderTask = (g: TaskGroup) => (
    <div key={g.key} className={`group${taskDone(g) ? ' finished' : ''}`}>
      <div className="group-head" onClick={() => setOpen(open === g.key ? null : g.key)}>
        <div>
          <div className="group-title">
            <span className="kind-chip task">TASK</span> {g.key}
          </div>
          <div className="meta">
            {g.mrs.length} MR · {g.mrs.filter((mr) => statuses.get(mr.id)?.done).length} gotowe ·{' '}
            {new Set(g.mrs.map((m) => m.project_id)).size} repo · {open === g.key ? 'zwiń ▴' : 'pokaż ▾'}
          </div>
        </div>
        <button
          className="primary small"
          onClick={(e) => {
            e.stopPropagation();
            // Merged MRs can't be reviewed any more, unless nothing else is left.
            const pending = g.mrs.filter((mr) => mr.state !== 'merged');
            setOpen(g.key);
            onOpen(pending.length ? pending : g.mrs, g.key);
          }}
        >
          Review całości
        </button>
      </div>
      {open === g.key &&
        g.mrs.map((mr) => <MrRow key={mr.id} mr={mr} status={statuses.get(mr.id)} onClick={() => onOpen([mr], g.key)} />)}
    </div>
  );

  const renderItem = (item: InboxItem) =>
    item.kind === 'task' ? (
      renderTask(item.task)
    ) : (
      <MrRow key={item.mr.id} mr={item.mr} status={statuses.get(item.mr.id)} chip onClick={() => onOpen([item.mr])} />
    );

  return (
    <div className="list">
      {!active.length && <div className="empty">Nic nie czeka na Twoje review 🎉</div>}
      {active.map(renderItem)}
      {merged.length > 0 && <div className="section-title">Zmergowane w ostatnich {MERGED_DAYS} dniach</div>}
      {merged.map((mr) => (
        <MrRow key={mr.id} mr={mr} status={statuses.get(mr.id)} chip onClick={() => onOpen([mr])} />
      ))}
      <ShowHidden count={done.length} shown={showDone} label="zakończone" onToggle={() => setShowDone(!showDone)} />
      {showDone && done.map(renderItem)}
    </div>
  );
}

function timeAgo(ms: number) {
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 1) return 'przed chwilą';
  if (minutes < 60) return `${minutes} min temu`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} godz. temu`;
  return `${Math.round(hours / 24)} dni temu`;
}

function RecentList({ api, onOpen }: Omit<Props, 'username'>) {
  const [recent] = useState(loadRecent);
  const [mrs, setMrs] = useState<MergeRequest[] | null>(null);
  const statuses = useStatuses(mrs);

  useEffect(() => {
    // Stored copies are snapshots from when the MR was opened; refresh them to show merges etc.
    Promise.all(recent.map((e) => api.mergeRequest(e.mr).catch(() => e.mr))).then(setMrs);
  }, [api, recent]);

  if (!recent.length) return <div className="empty">Tu pojawią się MR, które otworzysz w aplikacji.</div>;
  if (!mrs || !statuses) return <div className="loading">Ładuję…</div>;

  return (
    <div className="list">
      {mrs.map((mr, i) => (
        <MrRow key={mr.id} mr={mr} status={statuses.get(mr.id)} onClick={() => onOpen([mr])}>
          <div className="meta">Otwarte {timeAgo(recent[i].openedAt)}</div>
        </MrRow>
      ))}
    </div>
  );
}

function RepoBrowser({ api, onOpen }: Omit<Props, 'username'>) {
  const [query, setQuery] = useState('');
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [mrs, setMrs] = useState<MergeRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const statuses = useStatuses(mrs);

  useEffect(() => {
    const t = setTimeout(() => {
      api.searchProjects(query).then(setProjects, (e) => setError(String(e.message ?? e)));
    }, 300);
    return () => clearTimeout(t);
  }, [api, query]);

  useEffect(() => {
    if (!project) return;
    setMrs(null);
    api.projectMergeRequests(project.id).then(setMrs, (e) => setError(String(e.message ?? e)));
  }, [api, project]);

  const openFeature = async (mr: MergeRequest) => {
    try {
      const related = await api.mergeRequestsByBranch(mr.source_branch);
      onOpen(related.length ? related : [mr]);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  };

  if (error) return <div className="error">{error}</div>;

  if (project) {
    return (
      <div className="list">
        <button className="link" onClick={() => setProject(null)}>
          ← {project.path_with_namespace}
        </button>
        {!mrs && <div className="loading">Ładuję…</div>}
        {mrs?.length === 0 && <div className="empty">Brak otwartych MR</div>}
        {mrs?.map((mr) => (
          <MrRow key={mr.id} mr={mr} status={statuses?.get(mr.id)} onClick={() => onOpen([mr])}>
            <button
              className="link small"
              onClick={(e) => {
                e.stopPropagation();
                openFeature(mr);
              }}
            >
              + MR z tym samym branchem w innych repo
            </button>
          </MrRow>
        ))}
      </div>
    );
  }

  return (
    <div className="list">
      <input className="search" placeholder="Szukaj repozytorium…" value={query} onChange={(e) => setQuery(e.target.value)} />
      {!projects && <div className="loading">Ładuję…</div>}
      {projects?.map((p) => (
        <div key={p.id} className="row-item" onClick={() => setProject(p)}>
          <div className="title">{p.name}</div>
          <div className="meta">{p.path_with_namespace}</div>
        </div>
      ))}
    </div>
  );
}

/** `chip` marks a standalone MR in a list that also holds tasks. */
type MrRowProps = { mr: MergeRequest; status?: MrStatus | null; chip?: boolean; onClick: () => void; children?: React.ReactNode };

function MrRow({ mr, status, chip, onClick, children }: MrRowProps) {
  return (
    <div className={`row-item${status?.approvedByMe ? ' approved' : ''}`} onClick={onClick}>
      <div className="meta">
        {chip && <span className="kind-chip">MR</span>}
        {mr.references.full}
        {mr.draft && <span className="badge">draft</span>}
        {mr.state === 'merged' && <span className="badge merged">merged</span>}
        {mr.state === 'closed' && <span className="badge">zamknięty</span>}
      </div>
      <div className="title">{mr.title}</div>
      <div className="meta">
        {mr.author.name} · <code>{mr.source_branch}</code> → <code>{mr.target_branch}</code>
      </div>
      {status && <MrStatusBadges status={status} />}
      {children}
    </div>
  );
}

const firstNames = (users: User[]) => users.map((u) => u.name.split(' ')[0]).join(', ');

// My own approval is shown as the row's green frame; badges cover everyone else.
function MrStatusBadges({ status }: { status: MrStatus }) {
  const { me, approvedBy, required, changes, approvedByMe } = status;
  const others = approvedBy.filter((u) => u.username !== me);
  const count = required ? `${approvedBy.length}/${required}` : String(approvedBy.length);

  return (
    <div className="mr-status">
      {others.length > 0 ? (
        <span className="status ok" title={others.map((u) => u.name).join(', ')}>
          ✓ {count} approve: {firstNames(others)}
        </span>
      ) : (
        !approvedByMe && <span className="status muted">Brak approve{required ? ` (0/${required})` : ''}</span>
      )}
      {changes.length > 0 && (
        <span className="status bad">
          ✗ {changes.some((u) => u.username === me) ? 'Prosisz o zmiany' : `Zmiany: ${firstNames(changes)}`}
        </span>
      )}
    </div>
  );
}
