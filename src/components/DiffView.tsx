import { isCommentable, type DiffLine } from '../diff';

type Props = {
  lines: DiffLine[];
  selected: number | null;
  onSelect: (index: number | null) => void;
  commented: (line: DiffLine) => boolean;
};

export function DiffView({ lines, selected, onSelect, commented }: Props) {
  return (
    <div className="diff">
      {lines.map((l, i) => (
        <div
          key={i}
          className={`diff-line ${l.type}${selected === i ? ' selected' : ''}`}
          onClick={() => isCommentable(l) && onSelect(selected === i ? null : i)}
        >
          <span className="ln">{l.oldLine ?? ''}</span>
          <span className="ln">{l.newLine ?? ''}</span>
          <span className="code">
            {commented(l) && <span className="note-marker">💬</span>}
            {l.text || ' '}
          </span>
        </div>
      ))}
    </div>
  );
}
