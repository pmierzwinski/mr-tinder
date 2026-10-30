import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CommentSheet } from '../components/CommentSheet';
import { DiffView, InlineNote } from '../components/DiffView';
import { SwipeCard } from '../components/SwipeCard';
import { diffStats, expandEnd, expandHunk, parseDiff, trailingGap, type DiffLine, type ExpandMode } from '../diff';
import {
  draftsForFile,
  isDraftOnLine,
  isFileDraft,
  PROVIDER_LABEL,
  providerFor,
  type Draft,
  type FileDiff,
  type Providers,
  type Review,
} from '../review';
import { hashDiff, isViewed, loadSmallCode, saveSmallCode, setViewed } from '../storage';
import { Summary } from './Summary';

/** `fileLength` is known once the full file was fetched to expand context. */
export type Card = { review: Review; file: FileDiff; hash: string; lines: DiffLine[]; fileLength?: number };

/** The task's next review to offer once this one is sent. */
export type NextReview = { review: Review; taskKey: string; open: () => void };

type Props = { providers: Providers; reviews: Review[]; exitLabel: string; onExit: () => void; next?: NextReview };

const hasTextDiff = (file: FileDiff) => !file.too_large && !file.collapsed && !!file.diff;

const firstUnviewed = (cards: Card[]) => {
  const i = cards.findIndex((c) => !isViewed(c.review, c.file.new_path, c.hash));
  return i === -1 ? cards.length : i;
};


export function Deck({ providers, reviews: requested, exitLabel, onExit, next: nextReview }: Props) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [cards, setCards] = useState<Card[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft[]>>({});
  const [index, setIndex] = useState(0);
  const [picking, setPickingState] = useState(false);
  // Comments added since line picking started; picking stays on after each one until "Gotowe".
  const [pickedCount, setPickedCount] = useState(0);
  const setPicking = useCallback((on: boolean) => {
    setPickingState(on);
    if (!on) setPickedCount(0);
  }, []);
  // undefined = no comment sheet, null = comment on the whole file, number = index of the diff line
  const [commentAt, setCommentAt] = useState<number | null | undefined>(undefined);
  const commenting = commentAt !== undefined;
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const fileCache = useRef(new Map<string, Promise<string[]>>());
  const [smallCode, setSmallCode] = useState(loadSmallCode);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = await Promise.all(
        requested.map(async (r) => {
          const provider = providerFor(providers, r);
          const review = await provider.refresh(r);
          const [files, notes] = await Promise.all([provider.files(review), provider.drafts(review)]);
          return { review, files, notes };
        }),
      );
      if (cancelled) return;
      const all: Card[] = loaded.flatMap(({ review, files }) =>
        files.map((file) => ({ review, file, hash: hashDiff(file.diff), lines: parseDiff(file.diff) })),
      );
      setReviews(loaded.map((l) => l.review));
      setDrafts(Object.fromEntries(loaded.map((l) => [l.review.id, l.notes])));
      setCards(all);
      setIndex(firstUnviewed(all));
    })().catch((e) => !cancelled && setError(String(e instanceof Error ? e.message : e)));
    return () => {
      cancelled = true;
    };
  }, [providers, requested]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  const card = cards?.[index];

  const next = useCallback(() => {
    if (!card) return;
    setViewed(card.review, card.file.new_path, card.hash);
    setPicking(false);
    setIndex((i) => i + 1);
  }, [card, setPicking]);

  // No diff lines to pick from (binary/too large) -> comment on the whole file right away.
  const startComment = useCallback(() => {
    if (card && hasTextDiff(card.file)) setPicking(true);
    else setCommentAt(null);
  }, [card, setPicking]);

  const undo = () => {
    if (!cards || index === 0) return;
    const prev = cards[index - 1];
    setViewed(prev.review, prev.file.new_path, null);
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
  }, [card, commenting, picking, next, startComment, setPicking]);

  const fileDrafts = useMemo(() => (card ? draftsForFile(drafts[card.review.id] ?? [], card.file) : []), [card, drafts]);

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
        providers={providers}
        reviews={reviews}
        cards={cards}
        drafts={drafts}
        setDrafts={setDrafts}
        exitLabel={exitLabel}
        onExit={onExit}
        next={nextReview}
        onRestart={() => setIndex(0)}
      />
    );
  }

  const commentLine = commentAt == null ? null : card.lines[commentAt];
  const { file, review } = card;
  const provider = providerFor(providers, review);
  // Expanded context only adds unchanged lines, so these counts stay those of the diff.
  const { added, removed } = diffStats(card.lines);

  const addComment = async (text: string) => {
    const note = await provider.addDraft(review, file, commentLine, text);
    setDrafts((d) => ({ ...d, [review.id]: [...(d[review.id] ?? []), note] }));
    setCommentAt(undefined);
    // Back to choosing a line for the next comment; "Gotowe" ends it.
    if (hasTextDiff(file)) {
      setPickingState(true);
      setPickedCount((n) => n + 1);
    }
    setToast('Komentarz dodany do review');
  };

  const deleteNote = async (note: Draft) => {
    if (!confirm('Usunąć ten komentarz z review?')) return;
    try {
      await provider.deleteDraft(review, note);
      setDrafts((d) => ({ ...d, [review.id]: d[review.id].filter((n) => n.id !== note.id) }));
    } catch (e) {
      setToast(`Nie udało się usunąć: ${e instanceof Error ? e.message : e}`);
    }
  };

  const expand = async (at: number | 'end', mode: ExpandMode) => {
    const key = `${review.id}:${file.new_path}`;
    if (!fileCache.current.has(key)) fileCache.current.set(key, provider.fileLines(review, file.new_path));
    let content: string[];
    try {
      content = await fileCache.current.get(key)!;
    } catch (e) {
      fileCache.current.delete(key);
      setToast(`Nie udało się pobrać pliku: ${e instanceof Error ? e.message : e}`);
      return;
    }
    const current = index;
    setCards((cs) =>
      cs!.map((c, i) =>
        i !== current
          ? c
          : {
              ...c,
              fileLength: content.length,
              lines: at === 'end' ? expandEnd(c.lines, content) : expandHunk(c.lines, at, content, mode),
            },
      ),
    );
  };

  const canExpandEnd =
    !file.new_file && !file.deleted_file && (card.fileLength === undefined || trailingGap(card.lines, card.fileLength) > 0);

  const pickFile = () => {
    setPickingState(false);
    setCommentAt(null);
  };

  // Cancelling a line comment goes back to choosing a line, not straight to browsing.
  const cancelComment = () => {
    if (commentAt !== null || pickedCount > 0) setPickingState(true);
    setCommentAt(undefined);
  };

  const fileNotes = fileDrafts.filter(isFileDraft);

  return (
    <div className={`screen deck${smallCode ? ' small-code' : ''}`}>
      <div className="deck-top">
        <button className="link" onClick={onExit}>
          ✕
        </button>
        <ReviewProgress
          review={review}
          position={reviews.findIndex((r) => r.id === review.id) + 1}
          total={reviews.length}
          done={index}
          count={cards.length}
        />
        <button
          className={`font-toggle${smallCode ? ' on' : ''}`}
          onClick={() => {
            saveSmallCode(!smallCode);
            setSmallCode(!smallCode);
          }}
          title="Mniejsza czcionka kodu"
        >
          A<small>A</small>
        </button>
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
          className={picking ? 'picking' : ''}
        >
          <div className="card-head">
            <div className="path-row">
              <span className="path">{file.renamed_file ? `${file.old_path} → ${file.new_path}` : file.new_path}</span>
              <span className="line-stats">
                (<span className="minus">−{removed}</span> <span className="plus">+{added}</span>)
              </span>
            </div>
            {(file.new_file || file.deleted_file || fileDrafts.length > 0) && (
              <div className="meta">
                {file.new_file && <span className="badge add">nowy</span>}
                {file.deleted_file && <span className="badge del">usunięty</span>}
                {fileDrafts.length > 0 && <span className="badge">💬 {fileDrafts.length}</span>}
              </div>
            )}
            {fileNotes.map((n) => (
              <InlineNote key={n.id} note={n} onDelete={() => deleteNote(n)} />
            ))}
          </div>
          {!hasTextDiff(file) ? (
            <div className="empty">
              {file.diff ? 'Diff za duży do pokazania.' : 'Brak diffu tekstowego (plik binarny / zmiana uprawnień).'}{' '}
              <a href={review.webUrl} target="_blank" rel="noreferrer">
                Otwórz w {PROVIDER_LABEL[review.provider]}
              </a>
            </div>
          ) : (
            <DiffView
              path={file.new_path}
              lines={card.lines}
              notesFor={(l) => fileDrafts.filter((d) => isDraftOnLine(d, l))}
              onDeleteNote={deleteNote}
              picking={picking}
              onPick={(i) => {
                setPickingState(false);
                setCommentAt(i);
              }}
              highlight={commentAt ?? null}
              onExpand={expand}
              canExpandEnd={canExpandEnd}
              canCommentOnContext={provider.canCommentOnContext}
            />
          )}
        </SwipeCard>
      </div>

      {picking ? (
        <div className="actions pick-actions">
          {pickedCount > 0 ? (
            <button className="primary big" onClick={() => setPicking(false)}>
              ✓ Gotowe ({pickedCount})
            </button>
          ) : (
            <button className="secondary big" onClick={() => setPicking(false)}>
              ✕ Anuluj
            </button>
          )}
          <button className="secondary big" onClick={pickFile}>
            Komentarz do pliku
          </button>
        </div>
      ) : (
        <div className="actions">
          <button className="round" onClick={undo} disabled={index === 0} title="Cofnij">
            ↶
          </button>
          <button className="round comment" onClick={startComment} title="Komentarz (←)">
            💬
          </button>
          <button className="round ok" onClick={next} title="Viewed (→)">
            ✓
          </button>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}

      {commenting && (
        <CommentSheet path={file.new_path} line={commentLine} onCancel={cancelComment} onSubmit={addComment} />
      )}
    </div>
  );
}

/**
 * Progress bar that doubles as the review header: repo, MR/PR number, target branch and title,
 * filling up as files are reviewed. Tapping it opens the review in GitLab/GitHub.
 */
function ReviewProgress({ review, position, total, done, count }: { review: Review; position: number; total: number; done: number; count: number }) {
  const slash = review.repo.lastIndexOf('/');
  return (
    <a className="mr-progress" href={review.webUrl} target="_blank" rel="noreferrer">
      <div className="mr-progress-fill" style={{ width: `${(done / count) * 100}%` }} />
      <div className="mr-progress-line">
        {total > 1 && (
          <span className="badge">
            {position}/{total}
          </span>
        )}
        <span className="mr-progress-group">{review.repo.slice(0, slash + 1)}</span>
        <span className="mr-progress-repo">{review.repo.slice(slash + 1)}</span>
        <span className="mr-progress-iid">
          {review.provider === 'gitlab' ? '!' : '#'}
          {review.number}
        </span>
        <span className="mr-progress-target">→ {review.targetBranch}</span>
        <span className="mr-progress-count">
          {done + 1}/{count}
        </span>
      </div>
      <div className="mr-progress-title">{review.title}</div>
    </a>
  );
}
