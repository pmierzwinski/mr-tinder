import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { QuizView } from '../components/QuizView';
import type { DraftNote, GitLab, MergeRequest } from '../gitlab';
import { isViewed, loadAiKey } from '../storage';
import { mrKey, type Card } from './Deck';

type Props = {
  api: GitLab;
  mrs: MergeRequest[];
  cards: Card[];
  drafts: Record<string, DraftNote[]>;
  setDrafts: Dispatch<SetStateAction<Record<string, DraftNote[]>>>;
  exitLabel: string;
  onExit: () => void;
  onRestart: () => void;
};

type Status = { busy?: boolean; done?: string; error?: string };

type Outcome = 'comment' | 'approve';

const DONE: Record<Outcome, string> = {
  comment: 'Komentarze wysłane ✓',
  approve: 'Zatwierdzone ✓',
};

export function Summary({ api, mrs, cards, drafts, setDrafts, exitLabel, onExit, onRestart }: Props) {
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [aiKey] = useState(loadAiKey);
  const [quizOpen, setQuizOpen] = useState(false);
  const quizChanges = useMemo(
    () => mrs.map((mr) => ({ mr, files: cards.filter((c) => mrKey(c.mr) === mrKey(mr)).map((c) => c.file) })),
    [mrs, cards],
  );

  const update = (mr: MergeRequest, s: Status) => setStatus((prev) => ({ ...prev, [mrKey(mr)]: s }));

  const run = async (mr: MergeRequest, outcome: Outcome) => {
    const key = mrKey(mr);
    update(mr, { busy: true });
    try {
      const summary = summaries[key]?.trim();
      if (summary) await api.createDraftNote(mr, summary);
      if (summary || drafts[key]?.length) await api.publishDrafts(mr);
      setDrafts((d) => ({ ...d, [key]: [] }));
      setSummaries((s) => ({ ...s, [key]: '' }));
      if (outcome === 'approve') await api.approve(mr);
      update(mr, { done: DONE[outcome] });
    } catch (e) {
      update(mr, { error: String(e instanceof Error ? e.message : e) });
    }
  };

  const removeDraft = async (mr: MergeRequest, note: DraftNote) => {
    try {
      await api.deleteDraftNote(mr, note.id);
      setDrafts((d) => ({ ...d, [mrKey(mr)]: d[mrKey(mr)].filter((n) => n.id !== note.id) }));
    } catch (e) {
      update(mr, { error: String(e instanceof Error ? e.message : e) });
    }
  };

  const saveDraft = async (mr: MergeRequest, note: DraftNote, text: string) => {
    const updated = await api.updateDraftNote(mr, note.id, text);
    setDrafts((d) => ({
      ...d,
      // Keep our copy of the position: the fallback file-level notes only have it locally.
      [mrKey(mr)]: d[mrKey(mr)].map((n) => (n.id === note.id ? { ...n, note: updated?.note ?? text } : n)),
    }));
  };

  return (
    <div className="screen summary">
      <h2 className="summary-title">Podsumowanie</h2>
      {quizOpen ? (
        <QuizView apiKey={aiKey} changes={quizChanges} onClose={() => setQuizOpen(false)} />
      ) : aiKey ? (
        <button className="quiz-start" onClick={() => setQuizOpen(true)}>
          🧠 Sprawdź się — quiz z tych zmian (5 pytań)
        </button>
      ) : (
        <div className="meta">Dodaj klucz API (Gemini albo Anthropic) w ustawieniach (⚙︎ na liście MR), żeby po review wygenerować quiz ze zmian.</div>
      )}
      {mrs.map((mr) => {
        const key = mrKey(mr);
        const files = cards.filter((c) => mrKey(c.mr) === key);
        const viewed = files.filter((c) => isViewed(c.mr, c.file.new_path, c.hash)).length;
        const notes = drafts[key] ?? [];
        const s = status[key] ?? {};
        return (
          <div key={key} className="summary-mr">
            <div className="meta">{mr.references.full}</div>
            <a className="title" href={mr.web_url} target="_blank" rel="noreferrer">
              {mr.title}
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
                    onSave={(text) => saveDraft(mr, n, text)}
                    onDelete={() => removeDraft(mr, n)}
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
                <button className="primary" disabled={s.busy} onClick={() => run(mr, 'approve')}>
                  ✓ Approve
                </button>
                <button className="secondary" disabled={s.busy || !(drafts[key]?.length || summaries[key]?.trim())} onClick={() => run(mr, 'comment')}>
                  Wyślij komentarze bez approve
                </button>
              </div>
            )}
          </div>
        );
      })}

      {mrs.length > 1 && (
        <button className="primary wide" onClick={() => mrs.filter((mr) => !status[mrKey(mr)]?.done).forEach((mr) => run(mr, 'approve'))}>
          Approve wszystkie ({mrs.length})
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

type DraftItemProps = { note: DraftNote; onSave: (text: string) => Promise<void>; onDelete: () => void };

function DraftItem({ note, onSave, onDelete }: DraftItemProps) {
  const [text, setText] = useState<string | null>(null); // null = not editing
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const p = note.position;

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
        {p?.new_path ?? 'ogólny'}
        {p?.new_line ? `:${p.new_line}` : p?.old_line ? `:-${p.old_line}` : ''}
      </div>
      {text === null ? (
        <>
          <div className="note editable" onClick={() => setText(note.note)}>
            {note.note}
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
