import { Fragment, useEffect, useRef, useState } from 'react';
import { isCommentable, type DiffLine } from '../diff';
import type { DraftNote } from '../gitlab';

type Props = {
  lines: DiffLine[];
  notesFor: (line: DiffLine) => DraftNote[];
  onDeleteNote: (note: DraftNote) => void;
  /** Line-picking mode: dragging a finger highlights lines, releasing picks one. */
  picking: boolean;
  onPick: (index: number) => void;
  onPickFile: () => void;
  onCancelPick: () => void;
  /** Line kept highlighted while its comment is being written. */
  highlight: number | null;
};

const EDGE = 56; // px from the top/bottom edge where dragging auto-scrolls

export function DiffView({ lines, notesFor, onDeleteNote, picking, onPick, onPickFile, onCancelPick, highlight }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const hoverRef = useRef<number | null>(null);
  const frame = useRef(0);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    if (!picking) {
      hoverRef.current = null;
      setHover(null);
    }
  }, [picking]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const updateHover = () => {
    const el = scroller.current;
    const p = pointer.current;
    if (!el || !p) return;
    const r = el.getBoundingClientRect();
    const y = Math.min(Math.max(p.y, r.top + 1), r.bottom - 1);
    const line = document.elementFromPoint(r.left + r.width / 2, y)?.closest<HTMLElement>('[data-line]');
    if (line) {
      const i = Number(line.dataset.line);
      if (i !== hoverRef.current) {
        hoverRef.current = i;
        setHover(i);
        navigator.vibrate?.(5);
      }
    }
  };

  const tick = () => {
    const el = scroller.current;
    const p = pointer.current;
    if (!el || !p) return;
    const r = el.getBoundingClientRect();
    if (p.y < r.top + EDGE) el.scrollTop -= Math.ceil((r.top + EDGE - p.y) / 4);
    else if (p.y > r.bottom - EDGE) el.scrollTop += Math.ceil((p.y - (r.bottom - EDGE)) / 4);
    updateHover();
    frame.current = requestAnimationFrame(tick);
  };

  const stop = () => {
    cancelAnimationFrame(frame.current);
    pointer.current = null;
  };

  const pickHandlers = picking
    ? {
        onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          pointer.current = { x: e.clientX, y: e.clientY };
          cancelAnimationFrame(frame.current);
          tick();
        },
        onPointerMove: (e: React.PointerEvent) => {
          if (pointer.current) pointer.current = { x: e.clientX, y: e.clientY };
        },
        onPointerUp: () => {
          stop();
          if (hoverRef.current !== null) onPick(hoverRef.current);
        },
        onPointerCancel: stop,
      }
    : {};

  const active = picking ? hover : highlight;
  const activeLine = active === null ? null : lines[active];

  return (
    <div className="diff-wrap">
      {picking && (
        <div className="pick-bar">
          <div className="pick-info">
            {activeLine ? (
              <>
                <span className={`pick-ln ${activeLine.type}`}>
                  {activeLine.type === 'del' ? `−${activeLine.oldLine}` : activeLine.newLine}
                </span>
                <code>{activeLine.text.trim() || ' '}</code>
              </>
            ) : (
              <span>Przeciągnij palcem po liniach, puść na tej do komentarza</span>
            )}
          </div>
          <div className="row">
            <button className="link small" onClick={onPickFile}>
              Cały plik
            </button>
            <button className="link small" onClick={onCancelPick}>
              Anuluj
            </button>
          </div>
        </div>
      )}
      <div ref={scroller} className={`diff${picking ? ' picking' : ''}`} {...pickHandlers}>
        {lines.map((l, i) => (
          <Fragment key={i}>
            <div
              data-line={isCommentable(l) ? i : undefined}
              className={`diff-line ${l.type}${active === i ? ' active' : ''}`}
            >
              <span className="ln">{l.oldLine ?? ''}</span>
              <span className="ln">{l.newLine ?? ''}</span>
              <span className="code">{l.text || ' '}</span>
            </div>
            {notesFor(l).map((n) => (
              <InlineNote key={n.id} note={n} onDelete={() => onDeleteNote(n)} />
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

export function InlineNote({ note, onDelete }: { note: DraftNote; onDelete: () => void }) {
  return (
    <div className="inline-note">
      <div className="inline-note-head">
        <span className="badge">draft</span>
        <button className="link small" onClick={onDelete}>
          usuń
        </button>
      </div>
      <div className="note">{note.note}</div>
    </div>
  );
}
