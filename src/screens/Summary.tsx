import { useState, type Dispatch, type SetStateAction } from 'react';
import type { DraftNote, GitLab, MergeRequest } from '../gitlab';
import { isViewed } from '../storage';
import { mrKey, type Card } from './Deck';

type Props = {
  api: GitLab;
  mrs: MergeRequest[];
  cards: Card[];
  drafts: Record<string, DraftNote[]>;
  setDrafts: Dispatch<SetStateAction<Record<string, DraftNote[]>>>;
  onExit: () => void;
  onRestart: () => void;
};

type Status = { busy?: boolean; done?: string; error?: string };

export function Summary({ api, mrs, cards, drafts, setDrafts, onExit, onRestart }: Props) {
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<string, Status>>({});

  const update = (mr: MergeRequest, s: Status) => setStatus((prev) => ({ ...prev, [mrKey(mr)]: s }));

  const run = async (mr: MergeRequest, approve: boolean) => {
    const key = mrKey(mr);
    update(mr, { busy: true });
    try {
      const summary = summaries[key]?.trim();
      if (summary) await api.createDraftNote(mr, summary);
      if (summary || drafts[key]?.length) await api.publishDrafts(mr);
      setDrafts((d) => ({ ...d, [key]: [] }));
      setSummaries((s) => ({ ...s, [key]: '' }));
      if (approve) await api.approve(mr);
      update(mr, { done: approve ? 'Zatwierdzone ✓' : 'Review wysłane ✓' });
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

  return (
    <div className="screen summary">
      <h2 className="summary-title">Podsumowanie</h2>
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
                  <li key={n.id}>
                    <div className="meta">
                      {n.position?.new_path ?? 'ogólny'}
                      {n.position?.new_line ? `:${n.position.new_line}` : n.position?.old_line ? `:-${n.position.old_line}` : ''}
                    </div>
                    <div className="note">{n.note}</div>
                    <button className="link small" onClick={() => removeDraft(mr, n)}>
                      usuń
                    </button>
                  </li>
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
              <div className="row">
                <button className="secondary" disabled={s.busy} onClick={() => run(mr, false)}>
                  Wyślij review
                </button>
                <button className="primary" disabled={s.busy} onClick={() => run(mr, true)}>
                  Approve
                </button>
              </div>
            )}
          </div>
        );
      })}

      {mrs.length > 1 && (
        <button className="primary wide" onClick={() => mrs.filter((mr) => !status[mrKey(mr)]?.done).forEach((mr) => run(mr, true))}>
          Approve wszystkie ({mrs.length})
        </button>
      )}

      <div className="bottom-bar">
        <button className="secondary big" onClick={onRestart}>
          ↺ Jeszcze raz
        </button>
        <button className="secondary big" onClick={onExit}>
          ☰ Lista MR
        </button>
      </div>
    </div>
  );
}
