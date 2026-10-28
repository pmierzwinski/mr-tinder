import { useEffect, useMemo, useState } from 'react';
import type { GitLab, MergeRequest, Project } from '../gitlab';

type Props = { api: GitLab; username: string; onOpen: (mrs: MergeRequest[]) => void };

type Group = { key: string; mrs: MergeRequest[] };

// MRs belonging to one feature across repos share a Jira key or, failing that, the branch name.
const JIRA_KEY = /[A-Z][A-Z0-9]{1,9}-\d+/;

function groupKey(mr: MergeRequest) {
  return JIRA_KEY.exec(mr.source_branch)?.[0] ?? JIRA_KEY.exec(mr.title)?.[0] ?? mr.source_branch;
}

function groupMergeRequests(mrs: MergeRequest[]): Group[] {
  const map = new Map<string, MergeRequest[]>();
  for (const mr of mrs) {
    const key = groupKey(mr);
    map.set(key, [...(map.get(key) ?? []), mr]);
  }
  return [...map].map(([key, mrs]) => ({ key, mrs })).sort((a, b) => b.mrs.length - a.mrs.length);
}

export function Inbox({ api, username, onOpen }: Props) {
  const [tab, setTab] = useState<'review' | 'repos'>('review');
  return (
    <div className="screen">
      <div className="tabs">
        <button className={tab === 'review' ? 'active' : ''} onClick={() => setTab('review')}>
          Do review
        </button>
        <button className={tab === 'repos' ? 'active' : ''} onClick={() => setTab('repos')}>
          Repozytoria
        </button>
      </div>
      {tab === 'review' ? <ReviewList api={api} username={username} onOpen={onOpen} /> : <RepoBrowser api={api} onOpen={onOpen} />}
    </div>
  );
}

function ReviewList({ api, username, onOpen }: Props) {
  const [mrs, setMrs] = useState<MergeRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.reviewRequests(username).then(setMrs, (e) => setError(String(e.message ?? e)));
  }, [api, username]);

  const groups = useMemo(() => (mrs ? groupMergeRequests(mrs) : []), [mrs]);

  if (error) return <div className="error">{error}</div>;
  if (!mrs) return <div className="loading">Ładuję…</div>;
  if (!mrs.length) return <div className="empty">Nikt nie czeka na Twoje review 🎉</div>;

  return (
    <div className="list">
      {groups.map((g) =>
        g.mrs.length > 1 ? (
          <div key={g.key} className="group">
            <div className="group-head">
              <div>
                <div className="group-title">{g.key}</div>
                <div className="meta">
                  {g.mrs.length} MR · {new Set(g.mrs.map((m) => m.project_id)).size} repo
                </div>
              </div>
              <button className="primary small" onClick={() => onOpen(g.mrs)}>
                Review całości
              </button>
            </div>
            {g.mrs.map((mr) => (
              <MrRow key={mr.id} mr={mr} onClick={() => onOpen([mr])} />
            ))}
          </div>
        ) : (
          <MrRow key={g.mrs[0].id} mr={g.mrs[0]} onClick={() => onOpen(g.mrs)} />
        ),
      )}
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
