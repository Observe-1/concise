import { useEffect, useId, useRef, useState } from 'react';

/**
 * A themed date picker: a typeable YYYY-MM-DD text field (so it stays
 * keyboard- and paste-friendly, and forms submit the same string the rest of
 * the app expects) plus a calendar button that opens an inline month grid
 * matching the app's dark/gold styling — a consistent replacement for the
 * browser-native `<input type="date">`, whose look varies per platform.
 *
 * The calendar expands inline (rather than floating) so it never gets clipped
 * inside the app's scrollable bottom-sheet modals.
 */

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const todayISO = () => new Date().toISOString().slice(0, 10);
const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (year: number, month: number, day: number) => `${year}-${pad(month + 1)}-${pad(day)}`;
const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
const firstWeekday = (year: number, month: number) => new Date(Date.UTC(year, month, 1)).getUTCDay();

const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric',
  });

interface ViewMonth { year: number; month: number }

/** The month the grid opens on: the selected value, else the nearest in-range
 *  month to today, else today's month. */
function initialView(value: string, min?: string, max?: string): ViewMonth {
  let base = ISO_RE.test(value) ? value : todayISO();
  if (max && base > max) base = max;
  if (min && base < min) base = min;
  const [y, m] = base.split('-').map(Number);
  return { year: y!, month: m! - 1 };
}

export interface DatePickerProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  /** Inclusive YYYY-MM-DD bounds; out-of-range days are disabled in the grid. */
  min?: string;
  max?: string;
  required?: boolean;
  placeholder?: string;
  'aria-label'?: string;
}

const fieldClass =
  'w-full rounded-xl border border-ink-700 bg-ink-900 py-2.5 pl-3.5 pr-11 text-base text-ink-100 ' +
  'placeholder:text-ink-600 focus:border-gold-500 focus:outline-none min-h-11';

export function DatePicker({
  id, value, onChange, min, max, required, placeholder = 'YYYY-MM-DD', ...rest
}: DatePickerProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<ViewMonth>(() => initialView(value, min, max));
  const wrapRef = useRef<HTMLDivElement>(null);

  // Re-centre the grid on the value whenever it changes from outside (or via
  // typing) so opening the calendar shows the right month.
  useEffect(() => {
    if (ISO_RE.test(value)) setView(initialView(value, min, max));
  }, [value, min, max]);

  // Close on Escape or a click outside the picker.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  const inRange = (iso: string) => (!min || iso >= min) && (!max || iso <= max);
  const select = (iso: string) => {
    onChange(iso);
    setOpen(false);
  };
  const shiftMonth = (delta: number) => setView((v) => {
    const next = new Date(Date.UTC(v.year, v.month + delta, 1));
    return { year: next.getUTCFullYear(), month: next.getUTCMonth() };
  });

  const total = daysInMonth(view.year, view.month);
  const lead = firstWeekday(view.year, view.month);
  const cells: (number | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: total }, (_, i) => i + 1),
  ];
  const prevDisabled = !!min && isoOf(view.year, view.month, 1) <= min;
  const nextDisabled = !!max && isoOf(view.year, view.month, total) >= max;
  const today = todayISO();

  return (
    <div ref={wrapRef} className="relative">
      <input
        id={inputId}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        required={required}
        aria-label={rest['aria-label']}
        onChange={(e) => onChange(e.target.value)}
        className={fieldClass}
      />
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Hide calendar' : 'Choose date from calendar'}
        aria-expanded={open}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-ink-400 hover:text-gold-400"
      >
        <CalendarIcon />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Choose a date"
          className="mt-2 rounded-xl border border-ink-700 bg-ink-900 p-3 shadow-xl"
        >
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              disabled={prevDisabled}
              aria-label="Previous month"
              className="rounded-lg p-1.5 text-ink-400 hover:text-gold-400 disabled:opacity-30"
            >
              <Chevron dir="left" />
            </button>
            <span className="tabular text-sm font-medium text-ink-100">
              {MONTHS[view.month]} {view.year}
            </span>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              disabled={nextDisabled}
              aria-label="Next month"
              className="rounded-lg p-1.5 text-ink-400 hover:text-gold-400 disabled:opacity-30"
            >
              <Chevron dir="right" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-0.5 text-center">
            {WEEKDAYS.map((w) => (
              <span key={w} className="py-1 text-[10px] font-medium uppercase tracking-wider text-ink-600">
                {w}
              </span>
            ))}
            {cells.map((day, i) => {
              if (day === null) return <span key={`pad-${i}`} />;
              const iso = isoOf(view.year, view.month, day);
              const disabled = !inRange(iso);
              const selected = iso === value;
              const isToday = iso === today;
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => select(iso)}
                  disabled={disabled}
                  aria-label={longDate(iso)}
                  aria-pressed={selected}
                  className={`tabular h-9 rounded-lg text-sm transition-colors ${
                    selected
                      ? 'bg-gold-500 font-semibold text-ink-950'
                      : disabled
                        ? 'cursor-not-allowed text-ink-700'
                        : `text-ink-200 hover:bg-ink-800 ${isToday ? 'ring-1 ring-inset ring-gold-500/50' : ''}`
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>

          <div className="mt-2 flex items-center justify-between border-t border-ink-800 pt-2">
            <button
              type="button"
              onClick={() => onChange('')}
              className="rounded-lg px-2 py-1 text-xs text-ink-400 hover:text-ink-100"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => inRange(today) && select(today)}
              disabled={!inRange(today)}
              className="rounded-lg px-2 py-1 text-xs font-medium text-gold-400 hover:text-gold-300 disabled:opacity-30"
            >
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="2.5" y="3.5" width="13" height="12" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2.5 7h13M6 2.5v2M12 2.5v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d={dir === 'left' ? 'M10 3L5 8l5 5' : 'M6 3l5 5-5 5'}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
