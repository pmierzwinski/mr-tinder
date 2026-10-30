import { useRef, useState } from 'react';
import type { DiffLine } from '../diff';

type Props = {
  path: string;
  line: DiffLine | null;
  onCancel: () => void;
  onSubmit: (text: string) => Promise<void>;
};

export function CommentSheet({ path, line, onCancel, onSubmit }: Props) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tapping a line opens the sheet on touchend; the click the browser fires right after must not close it.
  const openedAt = useRef(Date.now());

  const insert = (snippet: string) => setText((t) => (t ? `${t}\n${snippet}` : snippet));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(text.trim());
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setBusy(false);
    }
  };

  return (
    <div className="sheet-backdrop" onClick={() => Date.now() - openedAt.current > 400 && onCancel()}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-title">
          Komentarz do <code>{path}</code>
        </div>
        {line ? (
          <div className={`sheet-line diff-line ${line.type}`}>
            <span className="ln">{line.newLine ?? line.oldLine}</span>
            <span className="code">{line.text}</span>
          </div>
        ) : (
          <div className="hint">Komentarz do całego pliku.</div>
        )}
        <div className="chips">
          <button onClick={() => insert('nit: ')}>nit</button>
          <button onClick={() => insert('question: ')}>pytanie</button>
          {line && line.type !== 'del' && (
            <button onClick={() => insert('```suggestion:-0+0\n' + line.text + '\n```')}>suggestion</button>
          )}
        </div>
        <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Co tu jest nie tak?" rows={5} />
        {error && <div className="error">{error}</div>}
        <div className="row">
          <button className="secondary" onClick={onCancel}>
            Anuluj
          </button>
          <button className="primary" disabled={!text.trim() || busy} onClick={submit}>
            {busy ? 'Zapisuję…' : 'Dodaj do review'}
          </button>
        </div>
      </div>
    </div>
  );
}
