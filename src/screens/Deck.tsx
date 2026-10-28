import { useCallback, useEffect, useMemo, useState } from 'react';
import { CommentSheet } from '../components/CommentSheet';
import { DiffView } from '../components/DiffView';
import { SwipeCard } from '../components/SwipeCard';
import { diffStats, parseDiff, type DiffLine } from '../diff';
import { ApiError, type DraftNote, type FileDiff, type GitLab, type MergeRequest, type Position } from '../gitlab';
import { hashDiff, isViewed, setViewed } from '../storage';
import { Summary } from './Summary';

export type Card = { mr: MergeRequest; file: FileDiff; hash: string; lines: DiffLine[] };

export const mrKey = (mr: Pick<MergeRequest, 'project_id' | 'iid'>) => `${mr.project_id}:${mr.iid}`;

type Props = { api: GitLab; mrs: MergeRequest[]; onExit: () => void };

function buildPosition(mr: MergeRequest, file: FileDiff, line: DiffLine | null): Position {
  const base = { ...mr.diff_refs!, old_path: file.old_path, new_path: file.new_path };
  if (!line) return { ...base, position_type: 'file' };
  return {
    ...base,
    position_type: 'text',
    old_line: line.type === 'add' ? undefined : line.oldLine,
    new_line: line.type === 'del' ? undefined : line.newLine,
  };
}

function draftsForFile(drafts: DraftNote[], file: FileDiff) {
  return drafts.filter((d) => d.position?.new_path === file.new_path || d.position?.old_path === file.old_path);
}

export function Deck({ api, mrs, onExit }: Props) {
  const [mergeRequests, setMergeRequests] = useState<MergeRequest[]>([]);
  const [cards, setCards] = useState<Card[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftNote[]>>({});
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [commenting, setCommenting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = await Promise.all(
        mrs.map(async (m) => {
          const mr = await api.mergeRequest(m);
          const [files, notes] = await Promise.all([api.diffs(mr), api.draftNotes(mr)]);
          return { mr, files, notes };
        }),
      );
      if (cancelled) return;
      const all: Card[] = loaded.flatMap(({ mr, files }) =>
        files.map((file) => ({ mr, file, hash: hashDiff(file.diff), lines: parseDiff(file.diff) })),
      );
      setMergeRequests(loaded.map((l) => l.mr));
      setDrafts(Object.fromEntries(loaded.map((l) => [mrKey(l.mr), l.notes])));
      setCards(all);
      const firstUnviewed = all.findIndex((c) => !isViewed(c.mr, c.file.new_path, c.hash));
      setIndex(firstUnviewed === -1 ? all.length : firstUnviewed);
    })().catch((e) => !cancelled && setError(String(e instanceof Error ? e.message : e)));
    return () => {
      cancelled = true;
    };
  }, [api, mrs]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  const card = cards?.[index];

  const next = useCallback(() => {
    if (!card) return;
    setViewed(card.mr, card.file.new_path, card.hash);
    setSelected(null);
    setIndex((i) => i + 1);
  }, [card]);

  const undo = () => {
    if (!cards || index === 0) return;
    const prev = cards[index - 1];
    setViewed(prev.mr, prev.file.new_path, null);
    setSelected(null);
    setIndex(index - 1);
  };

  useEffect(() => {
    if (commenting || !card) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') setCommenting(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [card, commenting, next]);

  const fileDrafts = useMemo(() => (card ? draftsForFile(drafts[mrKey(card.mr)] ?? [], card.file) : []), [card, drafts]);

  if (error) {
    return (
      <div className="screen">
        <div className="error">{error}</div>
        <button className="secondary" onClick={onExit}>
          Wróć
        </button>
      </div>
    );
  }
  if (!cards) return <div className="screen loading">Ładuję diffy…</div>;

  if (!card) {
    return (
      <Summary
        api={api}
        mrs={mergeRequests}
        cards={cards}
        drafts={drafts}
        setDrafts={setDrafts}
        onExit={onExit}
        onRestart={() => setIndex(0)}
      />
    );
  }

  const selectedLine = selected === null ? null : card.lines[selected];
  const { added, removed } = diffStats(card.lines);
  const { file, mr } = card;

  const addComment = async (text: string) => {
    let note: DraftNote;
    try {
      note = await api.createDraftNote(mr, text, buildPosition(mr, file, selectedLine));
    } catch (e) {
      // File-level positions need a recent GitLab; fall back to a general comment naming the file.
      if (selectedLine || !(e instanceof ApiError) || e.status !== 400) throw e;
      note = await api.createDraftNote(mr, `**\`${file.new_path}\`**\n\n${text}`);
      note.position = { old_path: file.old_path, new_path: file.new_path };
    }
    setDrafts((d) => ({ ...d, [mrKey(mr)]: [...(d[mrKey(mr)] ?? []), note] }));
    setCommenting(false);
    setSelected(null);
    setToast('Komentarz dodany do review');
  };

  const commented = (l: DiffLine) =>
    fileDrafts.some((d) =>
      l.type === 'del' ? d.position?.old_line === l.oldLine && !d.position?.new_line : l.newLine !== undefined && d.position?.new_line === l.newLine,
    );

  return (
    <div className="screen deck">
      <div className="deck-top">
        <button className="link" onClick={onExit}>
          ✕
        </button>
        <div className="progress">
          <div className="progress-bar" style={{ width: `${(index / cards.length) * 100}%` }} />
        </div>
        <span className="meta">
          {index + 1}/{cards.length}
        </span>
        <button className="link" onClick={() => setIndex(cards.length)}>
          Koniec →
        </button>
      </div>

      <div className="stack">
        {index + 1 < cards.length && <div className="swipe-card ghost" />}
        <SwipeCard key={index} onSwipeRight={next} onSwipeLeft={() => setCommenting(true)} rightLabel="VIEWED" leftLabel="KOMENTARZ">
          <div className="card-head">
            {mergeRequests.length > 1 && <div className="meta">{mr.references.full}</div>}
            <div className="path">
              {file.renamed_file ? `${file.old_path} → ${file.new_path}` : file.new_path}
            </div>
            <div className="meta">
              {file.new_file && <span className="badge add">nowy</span>}
              {file.deleted_file && <span className="badge del">usunięty</span>}
              <span className="plus">+{added}</span> <span className="minus">−{removed}</span>
              {fileDrafts.length > 0 && <span className="badge">💬 {fileDrafts.length}</span>}
            </div>
          </div>
          {file.too_large || file.collapsed || !file.diff ? (
            <div className="empty">
              {file.diff ? 'Diff za duży do pokazania.' : 'Brak diffu tekstowego (plik binarny / zmiana uprawnień).'}{' '}
              <a href={`${mr.web_url}/diffs`} target="_blank" rel="noreferrer">
                Otwórz w GitLabie
              </a>
            </div>
          ) : (
            <DiffView lines={card.lines} selected={selected} onSelect={setSelected} commented={commented} />
          )}
        </SwipeCard>
      </div>

      <div className="actions">
        <button className="round" onClick={undo} disabled={index === 0} title="Cofnij">
          ↶
        </button>
        <button className="round comment" onClick={() => setCommenting(true)} title="Komentarz (←)">
          💬
        </button>
        <button className="round ok" onClick={next} title="Viewed (→)">
          ✓
        </button>
      </div>

      {toast && <div className="toast">{toast}</div>}

      {commenting && (
        <CommentSheet path={file.new_path} line={selectedLine} onCancel={() => setCommenting(false)} onSubmit={addComment} />
      )}
    </div>
  );
}
