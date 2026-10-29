import { useRef, useState, type ReactNode } from 'react';

const THRESHOLD = 90;
const LOCK_DISTANCE = 10;

type Props = {
  onSwipeRight: () => void;
  onSwipeLeft: () => void;
  rightLabel: string;
  leftLabel: string;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
};

type Drag = { id: number; x: number; y: number; axis: 'h' | 'v' | null };

// Horizontal drag swipes the card; vertical movement is left to the browser (touch-action: pan-y)
// so the diff inside stays scrollable.
export function SwipeCard({ onSwipeRight, onSwipeLeft, rightLabel, leftLabel, disabled, className, children }: Props) {
  const [dx, setDx] = useState(0);
  const [animating, setAnimating] = useState(false);
  const drag = useRef<Drag | null>(null);
  const moved = useRef(false);

  const reset = () => {
    drag.current = null;
    setAnimating(true);
    setDx(0);
  };

  return (
    <div
      className={`swipe-card ${className ?? ''}`}
      style={{
        transform: `translateX(${dx}px) rotate(${dx / 25}deg)`,
        transition: animating ? 'transform 0.22s ease-out' : 'none',
      }}
      onTransitionEnd={() => setAnimating(false)}
      onPointerDown={(e) => {
        // Reset before the disabled check, or clicks stay swallowed after the swipe that disabled the card.
        moved.current = false;
        if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
        drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, axis: null };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        const ddx = e.clientX - d.x;
        const ddy = e.clientY - d.y;
        if (!d.axis) {
          if (Math.abs(ddx) > LOCK_DISTANCE && Math.abs(ddx) > Math.abs(ddy) * 1.2) {
            d.axis = 'h';
            moved.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
          } else if (Math.abs(ddy) > LOCK_DISTANCE) {
            d.axis = 'v';
          }
        }
        if (d.axis === 'h') setDx(ddx);
      }}
      onPointerUp={() => {
        if (drag.current?.axis !== 'h') {
          drag.current = null;
          return;
        }
        if (dx > THRESHOLD) {
          drag.current = null;
          setAnimating(true);
          setDx(window.innerWidth * 1.2);
          setTimeout(() => {
            setAnimating(false);
            setDx(0);
            onSwipeRight();
          }, 200);
        } else {
          if (dx < -THRESHOLD) onSwipeLeft();
          reset();
        }
      }}
      onPointerCancel={reset}
      onClickCapture={(e) => {
        // A horizontal drag ends with a click on whatever was under the finger - swallow it.
        if (moved.current) e.stopPropagation();
      }}
    >
      <div className="swipe-badge right" style={{ opacity: Math.max(0, dx / THRESHOLD) }}>
        {rightLabel}
      </div>
      <div className="swipe-badge left" style={{ opacity: Math.max(0, -dx / THRESHOLD) }}>
        {leftLabel}
      </div>
      {children}
    </div>
  );
}
