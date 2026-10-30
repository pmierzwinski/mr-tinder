import { useState, type Dispatch, type SetStateAction } from 'react';
import { providerFor, type Draft, type Providers, type Review } from '../review';
import { isViewed } from '../storage';
import type { Card, NextReview } from './Deck';

type Props = {
  providers: Providers;
  reviews: Review[];
  cards: Card[];
  drafts: Record<string, Draft[]>;
  setDrafts: Dispatch<SetStateAction<Record<string, Draft[]>>>;
  exitLabel: string;
  onExit: () => void;
  next?: NextReview;
  onRestart: () => void;
};

type Status = { busy?: boolean; done?: string; error?: string };

type Outcome = 'comment' | 'approve';

const DONE: Record<Outcome, string> = {
  comment: 'Komentarze wysłane ✓',
  approve: 'Zatwierdzone ✓',
};

export function Summary({ providers, reviews, cards, drafts, setDrafts, exitLabel, onExit, next, onRestart }: Props) {
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<string, Status>>({});

  const update = (review: Review, s: Status) => setStatus((prev) => ({ ...prev, [review.id]: s }));

  const run = async (review: Review, outcome: Outcome) => {
    update(review, { busy: true });
    try {
      const summary = summaries[review.id]?.trim();
      await providerFor(providers, review).submit(review, { summary, approve: outcome === 'approve' });
      setDrafts((d) => ({ ...d, [review.id]: [] }));
      setSummaries((s) => ({ ...s, [review.id]: '' }));
      update(review, { done: DONE[outcome] });
    } catch (e) {
      update(review, { error: String(e instanceof Error ? e.message : e) });
    }
  };

  const removeDraft = async (review: Review, note: Draft) => {
    try {
      await providerFor(providers, review).deleteDraft(review, note);
      setDrafts((d) => ({ ...d, [review.id]: d[review.id].filter((n) => n.id !== note.id) }));
    } catch (e) {
      update(review, { error: String(e instanceof Error ? e.message : e) });
    }
  };

  const saveDraft = async (review: Review, note: Draft, text: string) => {
    const updated = await providerFor(providers, review).updateDraft(review, note, text);
    setDrafts((d) => ({ ...d, [review.id]: d[review.id].map((n) => (n.id === note.id ? updated : n)) }));
  };

  return (
    <div className="screen summary">
      <h2 className="summary-title">Podsumowanie</h2>
      {reviews.map((review) => {
        const key = review.id;
        const files = cards.filter((c) => c.review.id === key);
        const viewed = files.filter((c) => isViewed(c.review, c.file.new_path, c.hash)).length;
        const notes = drafts[key] ?? [];
        const s = status[key] ?? {};
        const hasComments = notes.length > 0 || !!summaries[key]?.trim();
        return (
          <div key={key} className="summary-mr">
            <div className="meta">{review.ref}</div>
            <a className="title" href={review.webUrl} target="_blank" rel="noreferrer">
              {review.title}
            </a>
            <div className="meta">
              Obejrzane pliki: {viewed}/{files.length} · Komentarze w drafcie: {notes.length}
            </div>
            {notes.length > 0 && (
              <ul className="drafts">
                {notes.map((n) => (
                  <DraftItem
                    key={n.id}
                    note={n}
                    onSave={(text) => saveDraft(review, n, text)}
                    onDelete={() => removeDraft(review, n)}
                  />
                ))}
              </ul>
            )}
            <textarea
              rows={2}
              placeholder="Podsumowanie review (opcjonalne)"
              value={summaries[key] ?? ''}
              onChange={(e) => setSummaries((p) => ({ ...p, [key]: e.target.value }))}
            />
            {s.error && <div className="error">{s.error}</div>}
            {s.done ? (
              <div className="done">{s.done}</div>
            ) : (
              <div className="review-actions">
                {hasComments ? (
                  <>
                    <button className="primary" disabled={s.busy} onClick={() => run(review, 'comment')}>
                      Wyślij komentarze
                    </button>
                    <button className="secondary" disabled={s.busy} onClick={() => run(review, 'approve')}>
                      Wyślij komentarze i approve
                    </button>
                  </>
                ) : (
                  <button className="primary" disabled={s.busy} onClick={() => run(review, 'approve')}>
                    ✓ Approve
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {reviews.length > 1 && (
        <button className="primary wide" onClick={() => reviews.filter((r) => !status[r.id]?.done).forEach((r) => run(r, 'approve'))}>
          Approve wszystkie ({reviews.length})
        </button>
      )}

      {next && reviews.every((r) => status[r.id]?.done) && (
        <button className="primary wide next-review" onClick={next.open}>
          Następny MR z {next.taskKey} →<span className="meta">{next.review.ref} · {next.review.title}</span>
        </button>
      )}

      <div className="bottom-bar">
        <button className="secondary big" onClick={onRestart}>
          ↺ Jeszcze raz
        </button>
        <button className="secondary big" onClick={onExit}>
          ☰ {exitLabel}
        </button>
      </div>
    </div>
  );
}

type DraftItemProps = { note: Draft; onSave: (text: string) => Promise<void>; onDelete: () => void };

function DraftItem({ note, onSave, onDelete }: DraftItemProps) {
  const [text, setText] = useState<string | null>(null); // null = not editing
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave(text!.trim());
      setText(null);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
    setBusy(false);
  };

  return (
    <li>
      <div className="meta">
        {note.path ?? 'ogólny'}
        {note.newLine ? `:${note.newLine}` : note.oldLine ? `:-${note.oldLine}` : ''}
      </div>
      {text === null ? (
        <>
          <div className="note editable" onClick={() => setText(note.body)}>
            {note.body}
            <span className="edit-hint"> ✎</span>
          </div>
          <button className="link small" onClick={onDelete}>
            usuń
          </button>
        </>
      ) : (
        <div className="draft-edit">
          <textarea autoFocus rows={4} value={text} onChange={(e) => setText(e.target.value)} />
          {error && <div className="error">{error}</div>}
          <div className="row">
            <button className="secondary small" onClick={() => setText(null)} disabled={busy}>
              Anuluj
            </button>
            <button className="primary small" onClick={save} disabled={busy || !text.trim()}>
              {busy ? 'Zapisuję…' : 'Zapisz'}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
