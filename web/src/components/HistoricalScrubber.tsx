import type { HistoryPointDto } from '@api';
import { useHistoricalView } from '../contexts/HistoricalView.js';

/**
 * The red slidable circle under each graph. Dragging it left enters
 * historical view mode pinned to the date under the thumb; dragging it all
 * the way right (today) leaves the mode — as does the floating reset button.
 */
export function HistoricalScrubber({ points }: { points: HistoryPointDto[] }) {
  const { asOf, setAsOf } = useHistoricalView();
  if (points.length < 2) return null;

  // Thumb position: the last point on or before asOf (rightmost = live view).
  let idx = points.length - 1;
  if (asOf) {
    idx = 0;
    for (let i = 0; i < points.length; i++) {
      if (points[i]!.date <= asOf) idx = i;
      else break;
    }
  }

  const onChange = (i: number) => {
    setAsOf(i >= points.length - 1 ? null : points[i]!.date);
  };

  return (
    <div className="mt-1 flex items-center gap-2 px-1">
      <input
        type="range"
        min={0}
        max={points.length - 1}
        value={idx}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Historical view date"
        title="Slide left to view your finances as they were on a past date"
        className="h-1 w-full cursor-pointer accent-loss-500"
      />
      <span
        className={`tabular shrink-0 whitespace-nowrap text-[10px] font-medium uppercase tracking-wider ${
          asOf ? 'text-loss-400' : 'text-ink-600'
        }`}
      >
        {asOf ? `Viewing ${asOf}` : 'Today'}
      </span>
    </div>
  );
}
