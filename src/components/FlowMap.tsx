import { useState } from 'react';
import { diffStats } from '../diff';
import type { FlowInfo } from '../flow';
import type { Card } from '../screens/Deck';
import { isViewed, type CardOrder } from '../storage';

type Props = {
  cards: Card[];
  index: number;
  order: CardOrder;
  aiOrdered: boolean;
  canUseAi: boolean;
  onJump: (index: number) => void;
  onOrder: (order: CardOrder) => void;
  /** Asks Claude for the order; rejects with the error to show. */
  onAi: () => Promise<void>;
  onClearAi: () => void;
  onClose: () => void;
};

const fileName = (path: string) => path.split('/').pop()!;

/** One line on why a file comes where it does in the flow. */
export function flowLabel(flow: FlowInfo | undefined) {
  if (flow?.note) return `✨ ${flow.note}`;
  if (flow?.from) return `↳ z ${fileName(flow.from.path)} · ${flow.from.symbol}${flow.from.call ? '()' : ''}`;
  return null;
}

/** Bottom sheet with the deck's files in reading order, indented by call depth; tap one to jump to it. */
export function FlowMap({ cards, index, order, aiOrdered, canUseAi, onJump, onOrder, onAi, onClearAi, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const multi = new Set(cards.map((c) => c.review.id)).size > 1;

  const askAi = async () => {
    setBusy(true);
    setError(null);
    try {
      await onAi();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet flow-map" onClick={(e) => e.stopPropagation()}>
        <div className="flow-map-head">
          <div className="sheet-title">Mapa przepływu</div>
          <div className="segmented">
            <button className={order === 'flow' ? 'on' : ''} onClick={() => onOrder('flow')}>
              Przepływ
            </button>
            <button className={order === 'files' ? 'on' : ''} onClick={() => onOrder('files')}>
              Pliki
            </button>
          </div>
        </div>
        {order === 'flow' && (
          <p className="hint small">
            {aiOrdered
              ? 'Kolejność ułożona przez Claude.'
              : 'Plik wywołujący metodę jest przed plikiem z jej definicją (zgadywane z nazw w zmienionych liniach — wywołania przez interfejsy czy eventy mogą umknąć).'}
          </p>
        )}

        <ol className="flow-list">
          {cards.map((c, i) => {
            const { added, removed } = diffStats(c.lines);
            const label = order === 'flow' ? flowLabel(c.flow) : null;
            const viewed = isViewed(c.review, c.file.new_path, c.hash);
            return (
              <li key={`${c.review.id}:${c.file.new_path}`}>
                <button
                  className={`flow-row${i === index ? ' current' : ''}${viewed ? ' viewed' : ''}`}
                  style={{ paddingLeft: 8 + Math.min(c.flow?.depth ?? 0, 6) * 12 }}
                  onClick={() => onJump(i)}
                >
                  <span className="flow-row-main">
                    <span className="flow-check">{viewed ? '✓' : i + 1}</span>
                    <span className="flow-name">{fileName(c.file.new_path)}</span>
                    <span className="line-stats">
                      (<span className="minus">−{removed}</span> <span className="plus">+{added}</span>)
                    </span>
                  </span>
                  <span className="flow-sub">
                    {multi && `${c.review.repo.split('/').pop()} · `}
                    {label ?? c.file.new_path}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        {order === 'flow' && !canUseAi && (
          <p className="hint small">✨ Kolejność z opisem roli każdego pliku może ułożyć AI — dodaj klucz API Claude w ⚙︎ Ustawieniach.</p>
        )}
        {order === 'flow' && canUseAi && (
          <>
            {error && <div className="error">{error}</div>}
            {aiOrdered ? (
              <button className="link small" onClick={onClearAi}>
                Wróć do kolejności bez AI
              </button>
            ) : (
              <>
                <button className="secondary" disabled={busy} onClick={askAi}>
                  {busy ? 'Układam…' : '✨ Ułóż z AI (Claude)'}
                </button>
                <p className="hint small">
                  Wysyła diffy do Anthropic (płatne API, kilkanaście sekund).
                </p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
