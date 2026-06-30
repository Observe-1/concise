import {
  useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent,
} from 'react';
import type { AssetCategory, HistoryRange, HoldingDto, RecurringDto, SymbolLookupDto } from '@api';
import { ASSET_CATEGORIES, ASSET_VALUATION_MODES, LIABILITY_CATEGORIES, METALS } from '@api';
import {
  useCreateHolding, useDeleteHolding, useHoldingChanges, useHoldingComposition, useHoldingHistory,
  useHoldingPrediction, useHoldings, useInstruments, useMarketRefresh,
  useMe, usePropertyCountries, useRecurring, useRevalueHolding, useSymbolLookup, useUpdateHolding,
  type HoldingKind,
} from '../api/queries.js';
import { NetWorthChart, RANGES, RangePicker } from '../components/NetWorthChart.js';
import { CompositionPie } from '../components/PieCharts.js';
import { Button, Card, ChangeBadge, EmptyState, ErrorNote, Field, Input, Modal, Select, Spinner } from '../components/ui.js';
import { useHistoricalView } from '../contexts/HistoricalView.js';
import { categoryDisplay, categoryLabel, type HoldingSide } from '../lib/categories.js';
import { formatMinor, minorToInput, parseToMinor } from '../lib/money.js';

const METAL_LABELS: Record<string, string> = {
  gold: 'Gold', silver: 'Silver', platinum: 'Platinum', palladium: 'Palladium',
};

/** Valuation methods an asset category may use (cash: manual only). */
function modesFor(kind: HoldingKind, category: string): readonly string[] {
  if (kind !== 'assets') return ['manual'];
  return ASSET_VALUATION_MODES[category as AssetCategory] ?? ['manual'];
}

const MODE_LABELS: Record<string, string> = {
  manual: 'Manual value',
  market: 'Market price (symbol × quantity)',
  property_index: 'Country property index (yearly average price change)',
  depreciation: 'Automatic depreciation (average value loss by age)',
};

const CADENCE_SHORT: Record<string, string> = {
  daily: 'day', weekly: 'wk', monthly: 'mo', quarterly: 'qtr', yearly: 'yr',
};

/**
 * Compact summary of a recurring schedule for the holding badge: a direction
 * arrow, the fixed amount or percent, and the cadence. The full schedule name
 * and signed detail go in the hover title.
 */
function recurringBadge(r: RecurringDto, currency: string): { text: string; title: string } {
  const cad = CADENCE_SHORT[r.cadence] ?? r.cadence;
  const signed = r.amountType === 'percent'
    ? `${(r.percent ?? 0) >= 0 ? '+' : '−'}${Math.abs(r.percent ?? 0)}%`
    : `${(r.amountMinor ?? 0) >= 0 ? '+' : '−'}${formatMinor(Math.abs(r.amountMinor ?? 0), currency)}`;
  return { text: `${signed}/${cad}`, title: `${r.name}: ${signed} ${r.cadence}` };
}

interface PageCopy {
  title: string;
  addLabel: string;
  emptyTitle: string;
  emptyHint: string;
  tone: 'gain' | 'loss';
}

const COPY: Record<HoldingKind, PageCopy> = {
  assets: {
    title: 'Assets',
    addLabel: 'Add asset',
    emptyTitle: 'No assets yet',
    emptyHint: 'Add your first asset — cash, investments, property, anything you own.',
    tone: 'gain',
  },
  liabilities: {
    title: 'Liabilities',
    addLabel: 'Add liability',
    emptyTitle: 'No liabilities',
    emptyHint: 'Track mortgages, loans and credit cards to see your true net worth.',
    tone: 'loss',
  },
};

/** Eye / eye-with-a-slash, matching the hand-rolled stroke-icon style used
 *  elsewhere in this app (see Layout.tsx's nav icons) — no icon library. */
function EyeIcon({ off = false }: { off?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M1.5 10S4.5 4 10 4s8.5 6 8.5 6-3 6-8.5 6-8.5-6-8.5-6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="10" cy="10" r="2.25" stroke="currentColor" strokeWidth="1.5" />
      {off && <path d="M3 3l14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />}
    </svg>
  );
}

// How far a row can be dragged, and how far counts as a committed swipe —
// release past the threshold and it toggles immediately, short of it snaps
// back. No gesture library in this codebase (icons/animation are all
// hand-rolled), so this is plain Pointer Events + a CSS transform.
const MAX_DRAG = 80;
const COMMIT_THRESHOLD = 56;
// Minimum movement before a touch/click is treated as a drag rather than a
// tap — below this, a vertical scroll or a normal row tap proceeds untouched.
const SWIPE_CLAIM_PX = 8;

interface HoldingRowProps {
  h: HoldingDto;
  side: HoldingSide;
  tone: 'gain' | 'loss';
  currency: string;
  historical: boolean;
  recurringByTarget: Map<number, RecurringDto[]>;
  changeById: Map<number, number | null>;
  onEdit: () => void;
  onToggleExclude: () => void;
  togglePending: boolean;
}

/**
 * One asset/liability row. Swipe left past COMMIT_THRESHOLD and release to
 * toggle excludeFromTotals immediately (no confirmation tap); short of that
 * it snaps back. The small eye-icon button is the non-touch/keyboard/screen-
 * reader equivalent — swiping has no analogue for mouse-and-keyboard use.
 */
function HoldingRow({
  h, side, tone, currency, historical, recurringByTarget, changeById, onEdit, onToggleExclude, togglePending,
}: HoldingRowProps) {
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const gesture = useRef<{ startX: number; startY: number; axis: 'x' | 'y' | null } | null>(null);
  const suppressClick = useRef(false);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (historical) return;
    gesture.current = { startX: e.clientX, startY: e.clientY, axis: null };
    // Reset here, not just on click: each new gesture starts clean, so a
    // tap right after an earlier cancelled swipe isn't wrongly suppressed.
    suppressClick.current = false;
    // Deliberately no setPointerCapture: it would retarget the eventual
    // click event to this container instead of whichever button the pointer
    // actually came up over, silently breaking both buttons' onClick.
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (g.axis === null) {
      if (Math.abs(dx) < SWIPE_CLAIM_PX && Math.abs(dy) < SWIPE_CLAIM_PX) return;
      // Whichever axis moved further wins — a mostly-vertical drag is a page
      // scroll, not a swipe, and is left alone from here on.
      g.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (g.axis === 'x') setIsDragging(true);
    }
    if (g.axis !== 'x') return;
    suppressClick.current = true;
    setDragX(Math.max(-MAX_DRAG, Math.min(0, dx)));
  };

  const endGesture = () => {
    const wasSwiping = gesture.current?.axis === 'x';
    gesture.current = null;
    if (wasSwiping && Math.abs(dragX) > COMMIT_THRESHOLD) onToggleExclude();
    setDragX(0);
    setIsDragging(false);
  };

  const revealOpacity = Math.min(1, Math.abs(dragX) / COMMIT_THRESHOLD);

  return (
    <li className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 flex items-center justify-end bg-ink-700 px-5"
        style={{ opacity: revealOpacity }}
      >
        <span className="text-xs font-medium uppercase tracking-wider text-ink-200">
          {h.excludeFromTotals ? 'Show' : 'Hide'}
        </span>
      </div>
      <div
        className="relative flex items-stretch bg-ink-900 [touch-action:pan-y]"
        style={{
          transform: `translateX(${dragX}px)`,
          transition: isDragging ? 'none' : 'transform 200ms ease-out',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
      >
        <button
          type="button"
          onClick={() => {
            if (suppressClick.current) {
              suppressClick.current = false;
              return;
            }
            if (!historical) onEdit();
          }}
          disabled={historical}
          title={historical ? 'Read-only while viewing a past date — exit “view as” to edit.' : undefined}
          className={`flex flex-1 min-w-0 items-center justify-between gap-3 px-4 py-3.5 text-left hover:bg-ink-800/50 disabled:hover:bg-transparent ${h.excludeFromTotals ? 'opacity-60' : ''}`}
        >
          <span className="min-w-0">
            <span className="block truncate text-sm text-ink-100">{h.name}</span>
            <span className="flex items-center gap-1.5">
              {h.excludeFromTotals && (
                <span
                  className="mt-0.5 inline-block rounded bg-ink-700/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-300"
                  title="Tracked, but left out of net worth and other totals."
                >
                  Excluded
                </span>
              )}
              {side === 'liability' && h.currentValueMinor === 0 && (
                <span className="mt-0.5 inline-block rounded bg-gain-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-gain-400">
                  ✓ Paid off
                </span>
              )}
              {h.metal && (
                <span className="mt-0.5 inline-block rounded bg-ink-700/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-300">
                  {METAL_LABELS[h.metal] ?? h.metal}
                </span>
              )}
              {h.valuationMode === 'market' ? (
                <span className="mt-0.5 inline-block rounded bg-gold-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-gold-400">
                  {h.marketSymbol} × {h.quantity}
                  {h.quantity
                    ? ` @ ${formatMinor(Math.round(h.currentValueMinor / h.quantity), currency)}`
                    : ''}
                </span>
              ) : h.valuationMode === 'property_index' ? (
                <span className="mt-0.5 inline-block rounded bg-gold-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-gold-400">
                  {h.country} property index
                </span>
              ) : h.valuationMode === 'depreciation' ? (
                <span className="mt-0.5 inline-block rounded bg-gold-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-gold-400">
                  Depreciating · built {h.manufactureDate?.slice(0, 4)}
                </span>
              ) : !h.metal && h.notes ? (
                <span className="block truncate text-xs text-ink-400">{h.notes}</span>
              ) : null}
              {h.historicalPriceMissing && (
                <span
                  className="mt-0.5 inline-block rounded bg-loss-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-loss-400"
                  title={`Accurate historical price information could not be found about this ${side}.`}
                >
                  ⚠ Incomplete history
                </span>
              )}
              {(recurringByTarget.get(h.id) ?? []).map((r) => {
                const b = recurringBadge(r, currency);
                return (
                  <span
                    key={r.id}
                    title={b.title}
                    className="mt-0.5 inline-block rounded bg-gold-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-gold-400"
                  >
                    ↻ {b.text}
                  </span>
                );
              })}
            </span>
          </span>
          <span className="flex shrink-0 flex-col items-end">
            <span className={`tabular text-sm font-semibold ${tone === 'gain' ? 'text-gain-400' : 'text-loss-400'}`}>
              {formatMinor(h.currentValueMinor, currency)}
            </span>
            {changeById.has(h.id) && <ChangeBadge pct={changeById.get(h.id)!} />}
          </span>
        </button>
        {!historical && (
          <button
            type="button"
            aria-label={h.excludeFromTotals ? `Show ${h.name} in totals` : `Hide ${h.name} from totals`}
            onClick={() => {
              if (suppressClick.current) {
                suppressClick.current = false;
                return;
              }
              onToggleExclude();
            }}
            disabled={togglePending}
            className="flex w-11 shrink-0 items-center justify-center text-ink-400 hover:text-gold-400 disabled:opacity-50"
          >
            <EyeIcon off={h.excludeFromTotals} />
          </button>
        )}
      </div>
    </li>
  );
}

export function HoldingsPage({ kind }: { kind: HoldingKind }) {
  const copy = COPY[kind];
  const side: HoldingSide = kind === 'assets' ? 'asset' : 'liability';
  const { data: me } = useMe();
  // Historical view: the list reads as of the pinned date and is read-only —
  // mutating the past from here would be misleading.
  const { asOf } = useHistoricalView();
  const historical = asOf !== null;
  const holdings = useHoldings(kind, asOf);
  const marketRefresh = useMarketRefresh();
  // Separate from the edit-modal form's own mutation instance (HoldingForm),
  // so this inline toggle's pending/error state never cross-talks with it.
  const toggleExclude = useUpdateHolding(kind);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<HoldingDto | null>(null);
  // Quick-select range driving the per-holding % change column.
  const [range, setRange] = useState<HistoryRange>('1Y');
  const changes = useHoldingChanges(kind, range, asOf);
  const changeById = useMemo(() => {
    const map = new Map<number, number | null>();
    for (const c of changes.data ?? []) map.set(c.id, c.changePct);
    return map;
  }, [changes.data]);
  const currency = me?.currency ?? 'USD';

  const groups = useMemo(() => {
    const map = new Map<string, HoldingDto[]>();
    for (const h of holdings.data ?? []) {
      map.set(h.category, [...(map.get(h.category) ?? []), h]);
    }
    return [...map.entries()];
  }, [holdings.data]);

  const total = useMemo(
    () => (holdings.data ?? [])
      .filter((h) => !h.excludeFromTotals)
      .reduce((sum, h) => sum + h.currentValueMinor, 0),
    [holdings.data],
  );

  const onToggleExclude = (h: HoldingDto) => {
    setToggleError(null);
    toggleExclude.mutate(
      { id: h.id, excludeFromTotals: !h.excludeFromTotals },
      { onError: (err) => setToggleError(err instanceof Error ? err.message : 'Could not update') },
    );
  };

  // Active recurring schedules grouped by the holding they target, so each
  // entry can show an indicator of the increase/decrease applied to it.
  const recurring = useRecurring();
  const recurringByTarget = useMemo(() => {
    const map = new Map<number, RecurringDto[]>();
    for (const r of recurring.data ?? []) {
      if (r.active && r.targetType === side) {
        map.set(r.targetId, [...(map.get(r.targetId) ?? []), r]);
      }
    }
    return map;
  }, [recurring.data, side]);

  const hasMarketEntries = kind === 'assets' && (holdings.data ?? []).some((h) => h.valuationMode === 'market');

  if (holdings.isLoading) return <Spinner label={`Loading ${copy.title.toLowerCase()}`} />;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-xl font-semibold">{copy.title}</h1>
          {groups.length > 0 && (
            <span
              aria-label={`Total ${copy.title.toLowerCase()}`}
              className={`tabular text-base font-semibold ${copy.tone === 'gain' ? 'text-gain-400' : 'text-loss-400'}`}
            >
              {formatMinor(total, currency)}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {hasMarketEntries && !historical && (
            <Button
              variant="ghost"
              onClick={() => marketRefresh.mutate()}
              disabled={marketRefresh.isPending}
            >
              {marketRefresh.isPending ? 'Refreshing…' : 'Refresh prices'}
            </Button>
          )}
          {!historical && <Button onClick={() => setAdding(true)}>{copy.addLabel}</Button>}
        </div>
      </header>

      {historical && (
        <p className="tabular text-xs font-medium uppercase tracking-wider text-loss-400">
          Viewing as of {asOf} — read-only
        </p>
      )}

      {toggleError && <ErrorNote message={toggleError} />}

      {groups.length > 0 && (
        <div className="flex items-center justify-between gap-2">
          <span className="shrink-0 text-xs font-medium uppercase tracking-wider text-ink-400">
            Change over
          </span>
          <RangePicker value={range} onChange={setRange} allLabel="Max" />
        </div>
      )}

      {groups.length === 0 ? (
        <EmptyState title={copy.emptyTitle} hint={copy.emptyHint} />
      ) : (
        groups.map(([category, items]) => (
          <section key={category} aria-label={categoryLabel(side, category)}>
            <div className="mb-2 flex items-baseline justify-between px-1">
              <h2 className="text-xs font-medium uppercase tracking-widest text-ink-400">
                {categoryDisplay(side, category)}
              </h2>
              <span className={`tabular text-xs font-medium ${copy.tone === 'gain' ? 'text-gain-400' : 'text-loss-400'}`}>
                {formatMinor(
                  items.filter((i) => !i.excludeFromTotals).reduce((s, i) => s + i.currentValueMinor, 0),
                  currency,
                )}
              </span>
            </div>
            <Card>
              <ul className="divide-y divide-ink-800">
                {items.map((h) => (
                  <HoldingRow
                    key={h.id}
                    h={h}
                    side={side}
                    tone={copy.tone}
                    currency={currency}
                    historical={historical}
                    recurringByTarget={recurringByTarget}
                    changeById={changeById}
                    onEdit={() => setEditing(h)}
                    onToggleExclude={() => onToggleExclude(h)}
                    togglePending={toggleExclude.isPending}
                  />
                ))}
              </ul>
            </Card>
          </section>
        ))
      )}

      {adding && <HoldingForm kind={kind} currency={currency} onClose={() => setAdding(false)} />}
      {editing && (
        <HoldingForm kind={kind} currency={currency} existing={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

// Prediction can't project an unbounded future, so MAX (ALL) is hidden — mirrors
// the dashboard's prediction range set.
const PREDICTION_RANGES = RANGES.filter((r) => r !== 'ALL');

function HoldingForm({
  kind, existing, currency, onClose,
}: { kind: HoldingKind; existing?: HoldingDto; currency: string; onClose: () => void }) {
  const categories = kind === 'assets' ? ASSET_CATEGORIES : LIABILITY_CATEGORIES;
  const create = useCreateHolding(kind);
  const update = useUpdateHolding(kind);
  const remove = useDeleteHolding(kind);
  const revalue = useRevalueHolding(kind);
  const lookup = useSymbolLookup();

  const [category, setCategory] = useState<string>(existing?.category ?? categories[0]);
  const [name, setName] = useState(existing?.name ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [metal, setMetal] = useState(existing?.metal ?? METALS[0]);
  const [mode, setMode] = useState<string>(existing?.valuationMode ?? 'manual');
  const [symbol, setSymbol] = useState(existing?.marketSymbol ?? '');
  const [quantity, setQuantity] = useState(existing?.quantity?.toString() ?? '');
  const [country, setCountry] = useState(existing?.country ?? '');
  const [manufactureDate, setManufactureDate] = useState(existing?.manufactureDate ?? '');
  const [value, setValue] = useState(existing ? minorToInput(existing.currentValueMinor) : '');
  const [asOf, setAsOf] = useState('');
  // Optional present-day value recorded alongside a backdated historic value.
  const [presentValue, setPresentValue] = useState('');
  // Liabilities only (on create): an interest rate that sets up a yearly
  // percent schedule growing the balance.
  const [interestRate, setInterestRate] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  // Symbol the user has confirmed via lookup. Editing an existing market
  // asset without touching the symbol needs no re-verification.
  const [verified, setVerified] = useState<SymbolLookupDto | null>(null);
  // The raw input value at the moment of a successful lookup — for an ISIN,
  // `verified.symbol` is the *resolved* provider code, not what was typed, so
  // verification can't be gated by comparing it back to the input directly.
  const [verifiedInput, setVerifiedInput] = useState<string | null>(null);

  // ---- detail charts (editing an existing holding only) ----
  // Self-contained modes, independent of the global "view as": the line graph
  // can project (prediction) and scrub to a past date (view-as), and the pie
  // re-computes to match.
  const [detailRange, setDetailRange] = useState<HistoryRange>('1Y');
  const [predicting, setPredicting] = useState(false);
  const [viewAs, setViewAs] = useState(false);
  const [detailAsOf, setDetailAsOf] = useState<string | null>(null);
  // MAX has no bounded future — fall back to 1Y when entering prediction on it.
  useEffect(() => {
    if (predicting && detailRange === 'ALL') setDetailRange('1Y');
  }, [predicting, detailRange]);
  const detailId = existing?.id ?? null;
  const detailHistory = useHoldingHistory(kind, detailId, detailRange, !predicting);
  // ALL has no bounded future — gate the query so entering prediction on Max
  // never fires a transient prediction?range=ALL request before the reset above.
  const detailPrediction = useHoldingPrediction(
    kind, detailId, detailRange, predicting && detailRange !== 'ALL',
  );
  const detailComposition = useHoldingComposition(kind, detailId, {
    asOf: viewAs ? detailAsOf : null,
    predict: predicting,
    range: detailRange,
  });
  const chartPoints = predicting
    ? detailPrediction.data?.points ?? []
    : detailHistory.data?.points ?? [];

  const busy = create.isPending || update.isPending || remove.isPending || revalue.isPending;
  const allowedModes = modesFor(kind, category);
  const isMarket = mode === 'market';
  const countries = usePropertyCountries(kind === 'assets');
  const instruments = useInstruments(kind === 'assets');
  const symbolUpper = symbol.trim().toUpperCase();
  const symbolUnchanged = existing?.marketSymbol === symbolUpper;
  const symbolVerified = verified !== null && verifiedInput === symbolUpper;
  const needsVerification = isMarket && !symbolUnchanged && !symbolVerified;
  // A present-day value can be added only when creating a backdated, non-market
  // holding (market values are provider-derived).
  const showPresentValue = !existing && asOf.trim() !== '' && !isMarket;

  const onVerifySymbol = () => {
    setFormError(null);
    lookup.mutate(symbolUpper, {
      onSuccess: (result) => {
        setVerified(result);
        setVerifiedInput(symbolUpper);
      },
      onError: () =>
        setFormError(`"${symbolUpper}" was not recognised — check the ticker or ISIN and try again.`),
    });
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const valueMinor = parseToMinor(value);
    const presentMinor = showPresentValue && presentValue.trim() ? parseToMinor(presentValue) : null;
    if (showPresentValue && presentValue.trim() && presentMinor === null) {
      setFormError('Enter a valid present-day amount, e.g. 1500.00');
      return;
    }
    // Vehicle depreciation can be anchored on the present-day value alone — the
    // backdated historic value is then optional.
    const depreciationFromPresent = mode === 'depreciation' && presentMinor !== null;
    if (isMarket) {
      if (!symbol.trim() || !quantity || Number(quantity) <= 0) {
        setFormError('Market entries need a symbol and a positive quantity.');
        return;
      }
      if (needsVerification) {
        setFormError('Verify the symbol first so we can confirm the instrument.');
        return;
      }
    } else if (valueMinor === null && !depreciationFromPresent) {
      setFormError('Enter a valid amount, e.g. 1250.00');
      return;
    }
    if (mode === 'property_index' && !country) {
      setFormError('Choose a country for the property index.');
      return;
    }
    if (mode === 'depreciation' && !manufactureDate) {
      setFormError('Enter the manufacture date so depreciation can be applied correctly.');
      return;
    }
    const interestRatePct = interestRate.trim() ? Number(interestRate) : undefined;
    if (interestRate.trim() && (!Number.isFinite(interestRatePct) || interestRatePct! <= 0)) {
      setFormError('Enter a positive interest rate, e.g. 5.5');
      return;
    }

    const onError = (err: unknown) =>
      setFormError(err instanceof Error ? err.message : 'Something went wrong');

    const metalField = category === 'precious_metals' ? { metal } : { metal: null };
    // For an ISIN, `verified.symbol` is the resolved provider code, not what
    // was typed — save that, not the raw input. Falls back to the typed value
    // when unchanged from an existing holding (already a resolved symbol).
    const resolvedMarketSymbol = symbolVerified ? verified!.symbol : symbolUpper;
    const modeFields = isMarket
      ? { valuationMode: 'market' as const, marketSymbol: resolvedMarketSymbol, quantity: Number(quantity) }
      : mode === 'property_index'
        ? { valuationMode: 'property_index' as const, country, valueMinor: valueMinor! }
        : mode === 'depreciation'
          ? { valuationMode: 'depreciation' as const, manufactureDate,
              ...(valueMinor !== null ? { valueMinor } : {}) }
          : { valuationMode: 'manual' as const, valueMinor: valueMinor! };
    const presentField = presentMinor !== null ? { presentValueMinor: presentMinor } : {};

    if (!existing) {
      create.mutate(
        {
          category, name, notes: notes || null,
          ...(kind === 'assets'
            ? { ...metalField, ...modeFields }
            : { valueMinor: valueMinor!, ...(interestRatePct ? { interestRatePct } : {}) }),
          ...(asOf ? { asOf } : {}),
          ...presentField,
        },
        { onSuccess: onClose, onError },
      );
      return;
    }

    update.mutate(
      {
        id: existing.id, category, name, notes: notes || null,
        ...(kind === 'assets'
          ? {
              ...metalField,
              ...(isMarket
                ? { valuationMode: 'market' as const, marketSymbol: resolvedMarketSymbol, quantity: Number(quantity) }
                : mode === 'property_index'
                  ? { valuationMode: 'property_index' as const, country }
                  : mode === 'depreciation'
                    ? { valuationMode: 'depreciation' as const, manufactureDate }
                    : { valuationMode: 'manual' as const }),
            }
          : {}),
      },
      {
        onSuccess: () => {
          // Value changed? Record a new valuation (history preserved). For
          // model methods this re-bases future automatic estimates on the new
          // figure (the server anchors them on the latest manual value).
          // Market-mode values are provider-derived, so never revalued here.
          if (mode !== 'market' && valueMinor !== null && valueMinor !== existing.currentValueMinor) {
            revalue.mutate({ id: existing.id, valueMinor }, { onSuccess: onClose, onError });
          } else {
            onClose();
          }
        },
        onError,
      },
    );
  };

  const onDelete = () => {
    if (!existing) return;
    if (!window.confirm(`Delete "${existing.name}" and its history?`)) return;
    remove.mutate(existing.id, {
      onSuccess: onClose,
      onError: (err) => setFormError(err instanceof Error ? err.message : 'Delete failed'),
    });
  };

  const formEl = (
    <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Category">
          {(id) => (
            <Select
              id={id}
              value={category}
              onChange={(e) => {
                const next = e.target.value;
                setCategory(next);
                // The new category may not support the selected method
                // (e.g. cash is manual-only) — fall back to manual input.
                if (!modesFor(kind, next).includes(mode)) setMode('manual');
              }}
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {categoryDisplay(kind === 'assets' ? 'asset' : 'liability', c)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Name">
          {(id) => (
            <Input id={id} value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
          )}
        </Field>

        {kind === 'assets' && category === 'precious_metals' && (
          <Field label="Metal">
            {(id) => (
              <Select id={id} value={metal ?? METALS[0]} onChange={(e) => setMetal(e.target.value as typeof metal)}>
                {METALS.map((m) => (
                  <option key={m} value={m}>{METAL_LABELS[m]}</option>
                ))}
              </Select>
            )}
          </Field>
        )}

        {kind === 'assets' && allowedModes.length > 1 && (
          <Field label="Valuation">
            {(id) => (
              <Select id={id} value={mode} onChange={(e) => setMode(e.target.value)}>
                {allowedModes.map((m) => (
                  <option key={m} value={m}>{MODE_LABELS[m] ?? m}</option>
                ))}
              </Select>
            )}
          </Field>
        )}

        {mode === 'depreciation' && (
          <Field
            label="Manufacture date"
            hint="Depreciation steepens for newer vehicles — the age determines the rate applied."
          >
            {(id) => (
              <Input
                id={id}
                type="date"
                value={manufactureDate}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setManufactureDate(e.target.value)}
                required
              />
            )}
          </Field>
        )}

        {mode === 'property_index' && (
          <Field
            label="Country"
            hint="The country's yearly average property price change is applied automatically."
          >
            {(id) => (
              <Select id={id} value={country} onChange={(e) => setCountry(e.target.value)} required>
                <option value="" disabled>Choose…</option>
                {(countries.data ?? []).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name} ({c.annualRatePct >= 0 ? '+' : ''}{c.annualRatePct}%/yr)
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}

        {isMarket ? (
          <>
            <div className="grid grid-cols-[1fr_auto] items-end gap-2">
              <Field
                label="Symbol"
                hint="Search across London, US and EU exchanges, crypto and metals — or paste a fund's ISIN if it has no ordinary ticker."
              >
                {(id) => (
                  <>
                    <Input id={id} value={symbol} list="market-instruments"
                      onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                      placeholder="VUAG" required />
                    <datalist id="market-instruments">
                      {(instruments.data ?? []).map((inst) => (
                        <option key={inst.symbol} value={inst.symbol}>
                          {inst.name} · {inst.exchange} ({inst.currency})
                        </option>
                      ))}
                    </datalist>
                  </>
                )}
              </Field>
              <Button
                variant="ghost"
                onClick={onVerifySymbol}
                disabled={!symbol.trim() || lookup.isPending || symbolVerified || symbolUnchanged}
              >
                {lookup.isPending ? 'Checking…' : 'Verify'}
              </Button>
            </div>
            {symbolVerified && (
              <div role="status" className="text-sm text-gain-400">
                <p className="flex items-center gap-1.5">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                    <path d="M2 7.5L5.5 11L12 3.5" stroke="currentColor" strokeWidth="1.8"
                      strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {verified!.symbol} — {verified!.name}
                </p>
                {verified!.exchange && (
                  <p className="ml-[20px] text-xs text-ink-400">
                    {verified!.exchange} · priced in {verified!.currency}
                  </p>
                )}
                {verified!.priceMinor != null && (
                  <p className="ml-[20px] text-xs text-gold-400">
                    Current price: {formatMinor(verified!.priceMinor, verified!.currency)} per unit
                  </p>
                )}
              </div>
            )}
            {!symbolVerified && symbolUnchanged && existing && (
              <p className="text-xs text-ink-400">Symbol unchanged — no re-verification needed.</p>
            )}
            <Field label="Quantity">
              {(id) => (
                <Input id={id} value={quantity} onChange={(e) => setQuantity(e.target.value)}
                  inputMode="decimal" placeholder="100" required />
              )}
            </Field>
          </>
        ) : (
          <Field
            label={existing ? 'Current value' : 'Value'}
            hint={
              existing
                ? mode === 'property_index' || mode === 'depreciation'
                  ? 'Updating this re-bases future automatic estimates on the new figure — past entries are kept.'
                  : 'Changing this records a new valuation.'
                : mode === 'property_index'
                  ? 'Value on the start date — the index applies the average change from there.'
                  : mode === 'depreciation'
                    ? showPresentValue
                      ? 'Value when acquired (optional) — a present-day value below takes over the depreciation if set.'
                      : 'Value on the start date — depreciation is applied from there by vehicle age.'
                    : undefined
            }
          >
            {(id) => (
              <Input id={id} value={value} onChange={(e) => setValue(e.target.value)}
                inputMode="decimal" placeholder="0.00"
                required={!(mode === 'depreciation' && showPresentValue)} />
            )}
          </Field>
        )}

        {kind === 'liabilities' && !existing && (
          <Field
            label="Interest rate % (optional)"
            hint="Sets up a yearly schedule that grows the balance by this rate — manage or pause it on the Recurring page."
          >
            {(id) => (
              <Input
                id={id}
                value={interestRate}
                onChange={(e) => setInterestRate(e.target.value)}
                inputMode="decimal"
                placeholder="5.5"
              />
            )}
          </Field>
        )}

        <Field label="Notes">
          {(id) => (
            <Input id={id} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
          )}
        </Field>

        {!existing && (
          <Field
            label="Backdate (optional)"
            hint={`Record this ${kind === 'assets' ? 'asset' : 'liability'} as starting on a past date; your history is recalculated from there.`}
          >
            {(id) => (
              <Input
                id={id}
                type="date"
                value={asOf}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setAsOf(e.target.value)}
              />
            )}
          </Field>
        )}

        {showPresentValue && (
          <Field
            label="Present-day value (optional)"
            hint={
              mode === 'depreciation'
                ? "Today's value. Depreciation is calculated from this — the backdated figure above is ignored when this is set."
                : 'What it is worth today, recorded in addition to the backdated value above.'
            }
          >
            {(id) => (
              <Input
                id={id}
                value={presentValue}
                onChange={(e) => setPresentValue(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
              />
            )}
          </Field>
        )}

        {formError ? <ErrorNote message={formError} /> : null}

        <div className="flex gap-2 pt-1">
          {existing && (
            <Button variant="danger" onClick={onDelete} disabled={busy}>Delete</Button>
          )}
          <Button type="submit" className="flex-1" disabled={busy}>
            {busy ? 'Saving…' : existing ? 'Save changes' : 'Add'}
          </Button>
        </div>
      </form>
  );

  if (!existing) {
    return (
      <Modal title={COPY[kind].addLabel} onClose={onClose}>{formEl}</Modal>
    );
  }

  // Editing: pie (left) · edit form + mode buttons (middle) · line graph (right).
  // On small screens the columns stack with the form first so it stays reachable.
  const modeButtons = (
    <div className="flex flex-wrap justify-center gap-2 border-t border-ink-800 pt-4">
      <button
        type="button"
        onClick={() => setPredicting((p) => !p)}
        aria-pressed={predicting}
        className={`rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors ${
          predicting
            ? 'bg-gold-500 text-ink-950 hover:bg-gold-400'
            : 'border border-gold-500/40 text-gold-400 hover:bg-gold-500/10'
        }`}
      >
        ✨ {predicting ? 'Exit prediction' : 'Prediction'}
      </button>
      <button
        type="button"
        onClick={() => {
          setViewAs((v) => {
            if (v) setDetailAsOf(null); // leaving view-as resets the scrubbed date
            return !v;
          });
        }}
        aria-pressed={viewAs}
        className={`rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors ${
          viewAs
            ? 'bg-loss-500 text-ink-950 hover:bg-loss-400'
            : 'border border-loss-500/40 text-loss-400 hover:bg-loss-500/10'
        }`}
      >
        {viewAs ? 'Exit view as' : 'View as'}
      </button>
    </div>
  );

  return (
    <Modal title={`Edit ${existing.name}`} onClose={onClose} size="xl">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1fr)]">
        <section aria-label="Share of net worth" className="order-2 lg:order-1">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-widest text-ink-400">
            Share of net worth
          </h3>
          {detailComposition.data ? (
            <CompositionPie
              composition={detailComposition.data}
              currency={currency}
              selectedName={existing.name}
            />
          ) : (
            <div className="flex h-48 items-center justify-center text-xs text-ink-500">
              Loading…
            </div>
          )}
        </section>

        <div className="order-1 space-y-4 lg:order-2">
          {formEl}
          {modeButtons}
        </div>

        <section aria-label="Value over time" className="order-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-medium uppercase tracking-widest text-ink-400">
              Value over time
            </h3>
          </div>
          <RangePicker
            value={detailRange}
            onChange={setDetailRange}
            ranges={predicting ? PREDICTION_RANGES : RANGES}
            allLabel="Max"
          />
          <NetWorthChart
            points={chartPoints}
            currency={currency}
            range={detailRange}
            valueLabel={existing.name}
            asOf={viewAs ? detailAsOf : null}
            scrubber={viewAs ? { asOf: detailAsOf, setAsOf: setDetailAsOf } : undefined}
            nowLine={predicting ? detailPrediction.data?.today ?? null : null}
            showTrend={!predicting}
          />
        </section>
      </div>
    </Modal>
  );
}
