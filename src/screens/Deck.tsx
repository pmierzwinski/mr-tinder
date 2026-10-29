import { useCallback, useEffect, useMemo, useState } from 'react';
import { CommentSheet } from '../components/CommentSheet';
import { DiffView, InlineNote } from '../components/DiffView';
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

const hasTextDiff = (file: FileDiff) => !file.too_large && !file.collapsed && !!file.diff;

function isOnLine(d: DraftNote, l: DiffLine) {
  if (l.type === 'del') return d.position?.old_line === l.oldLine && !d.position?.new_line;
  return l.newLine !== undefined && d.position?.new_line === l.newLine;
}

export function Deck({ api, mrs, onExit }: Props) {
  const [mergeRequests, setMergeRequests] = useState<MergeRequest[]>([]);
  const [cards, setCards] = useState<Card[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftNote[]>>({});
  const [index, setIndex] = useState(0);
  const [picking, setPicking] = useState(false);
  // undefined = no comment sheet, null = comment on the whole file, number = index of the diff line
  const [commentAt, setCommentAt] = useState<number | null | undefined>(undefined);
  const commenting = commentAt !== undefined;
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
    setPicking(false);
    setIndex((i) => i + 1);
  }, [card]);

  // No diff lines to pick from (binary/too large) -> comment on the whole file right away.
  const startComment = useCallback(() => {
    if (card && hasTextDiff(card.file)) setPicking(true);
    else setCommentAt(null);
  }, [card]);

  const undo = () => {
    if (!cards || index === 0) return;
    const prev = cards[index - 1];
    setViewed(prev.mr, prev.file.new_path, null);
    setPicking(false);
    setIndex(index - 1);
  };

  useEffect(() => {
    if (commenting || !card) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPicking(false);
      else if (picking) return;
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') startComment();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [card, commenting, picking, next, startComment]);

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

  const commentLine = commentAt == null ? null : card.lines[commentAt];
  const { added, removed } = diffStats(card.lines);
  const { file, mr } = card;

  const addComment = async (text: string) => {
    let note: DraftNote;
    try {
      note = await api.createDraftNote(mr, text, buildPosition(mr, file, commentLine));
    } catch (e) {
      // File-level positions need a recent GitLab; fall back to a general comment naming the file.
      if (commentLine || !(e instanceof ApiError) || e.status !== 400) throw e;
      note = await api.createDraftNote(mr, `**\`${file.new_path}\`**\n\n${text}`);
      note.position = { old_path: file.old_path, new_path: file.new_path };
    }
    setDrafts((d) => ({ ...d, [mrKey(mr)]: [...(d[mrKey(mr)] ?? []), note] }));
    setCommentAt(undefined);
    setToast('Komentarz dodany do review');
  };

  const deleteNote = async (note: DraftNote) => {
    if (!confirm('Usunąć ten komentarz z review?')) return;
    try {
      await api.deleteDraftNote(mr, note.id);
      setDrafts((d) => ({ ...d, [mrKey(mr)]: d[mrKey(mr)].filter((n) => n.id !== note.id) }));
    } catch (e) {
      setToast(`Nie udało się usunąć: ${e instanceof Error ? e.message : e}`);
    }
  };

  const fileNotes = fileDrafts.filter((d) => !d.position?.new_line && !d.position?.old_line);

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
        <SwipeCard
          key={index}
          onSwipeRight={next}
          onSwipeLeft={startComment}
          rightLabel="VIEWED"
          leftLabel="KOMENTARZ"
          disabled={picking}
        >
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
            {fileNotes.map((n) => (
              <InlineNote key={n.id} note={n} onDelete={() => deleteNote(n)} />
            ))}
          </div>
          {!hasTextDiff(file) ? (
            <div className="empty">
              {file.diff ? 'Diff za duży do pokazania.' : 'Brak diffu tekstowego (plik binarny / zmiana uprawnień).'}{' '}
              <a href={`${mr.web_url}/diffs`} target="_blank" rel="noreferrer">
                Otwórz w GitLabie
              </a>
            </div>
          ) : (
            <DiffView
              path={file.new_path}
              lines={card.lines}
              notesFor={(l) => fileDrafts.filter((d) => isOnLine(d, l))}
              onDeleteNote={deleteNote}
              picking={picking}
              onPick={(i) => {
                setPicking(false);
                setCommentAt(i);
              }}
              onPickFile={() => {
                setPicking(false);
                setCommentAt(null);
              }}
              onCancelPick={() => setPicking(false)}
              highlight={commentAt ?? null}
            />
          )}
        </SwipeCard>
      </div>

      <div className="actions">
        <button className="round" onClick={undo} disabled={index === 0} title="Cofnij">
          ↶
        </button>
        <button
          className={`round comment${picking ? ' on' : ''}`}
          onClick={() => (picking ? setPicking(false) : startComment())}
          title="Komentarz (←)"
        >
          💬
        </button>
        <button className="round ok" onClick={next} title="Viewed (→)">
          ✓
        </button>
      </div>

      {toast && <div className="toast">{toast}</div>}

      {commenting && (
        <CommentSheet path={file.new_path} line={commentLine} onCancel={() => setCommentAt(undefined)} onSubmit={addComment} />
      )}
    </div>
  );
}
