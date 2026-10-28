import { useEffect, useState } from 'react';
import type { GitLab, MergeRequest, Project } from '../gitlab';
import { loadTaskGroups, type TaskGroup } from '../tasks';

type Props = { api: GitLab; username: string; onOpen: (mrs: MergeRequest[]) => void };

type Tab = 'review' | 'tasks' | 'repos';

const TABS: { id: Tab; label: string }[] = [
  { id: 'review', label: 'Do review' },
  { id: 'tasks', label: 'Taski' },
  { id: 'repos', label: 'Repozytoria' },
];

export function Inbox({ api, username, onOpen }: Props) {
  const [tab, setTab] = useState<Tab>('review');
  return (
    <div className="screen">
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'review' && <ReviewList api={api} username={username} onOpen={onOpen} />}
      {tab === 'tasks' && <TaskList api={api} username={username} onOpen={onOpen} />}
      {tab === 'repos' && <RepoBrowser api={api} onOpen={onOpen} />}
    </div>
  );
}

function ReviewList({ api, username, onOpen }: Props) {
  const [mrs, setMrs] = useState<MergeRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.reviewRequests(username).then(setMrs, (e) => setError(String(e.message ?? e)));
  }, [api, username]);

  if (error) return <div className="error">{error}</div>;
  if (!mrs) return <div className="loading">Ładuję…</div>;
  if (!mrs.length) return <div className="empty">Nikt nie czeka na Twoje review 🎉</div>;

  return (
    <div className="list">
      {mrs.map((mr) => (
        <MrRow key={mr.id} mr={mr} onClick={() => onOpen([mr])} />
      ))}
    </div>
  );
}

function TaskList({ api, username, onOpen }: Props) {
  const [groups, setGroups] = useState<TaskGroup[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadTaskGroups(api, username).then(setGroups, (e) => setError(String(e.message ?? e)));
  }, [api, username]);

  if (error) return <div className="error">{error}</div>;
  if (!groups) return <div className="loading">Szukam MR po ticketach…</div>;
  if (!groups.length) {
    return <div className="empty">Brak MR z ticketem Jiry (np. WOH-123) przypisanych do Ciebie ani czekających na Twoje review.</div>;
  }

  return (
    <div className="list">
      {groups.map((g) => (
        <div key={g.key} className="group">
          <div className="group-head" onClick={() => setOpen(open === g.key ? null : g.key)}>
            <div>
              <div className="group-title">{g.key}</div>
              <div className="meta">
                {g.mrs.length} MR · {new Set(g.mrs.map((m) => m.project_id)).size} repo · {open === g.key ? 'zwiń ▴' : 'pokaż ▾'}
              </div>
            </div>
            <button
              className="primary small"
              onClick={(e) => {
                e.stopPropagation();
                onOpen(g.mrs);
              }}
            >
              Review całości
            </button>
          </div>
          {open === g.key && g.mrs.map((mr) => <MrRow key={mr.id} mr={mr} onClick={() => onOpen([mr])} />)}
        </div>
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
          <MrRow key={mr.id} mr={mr} onClick={() => onOpen([mr])}>
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

function MrRow({ mr, onClick, children }: { mr: MergeRequest; onClick: () => void; children?: React.ReactNode }) {
  return (
    <div className="row-item" onClick={onClick}>
      <div className="meta">
        {mr.references.full}
        {mr.draft && <span className="badge">draft</span>}
      </div>
      <div className="title">{mr.title}</div>
      <div className="meta">
        {mr.author.name} · <code>{mr.source_branch}</code> → <code>{mr.target_branch}</code>
      </div>
      {children}
    </div>
  );
}
