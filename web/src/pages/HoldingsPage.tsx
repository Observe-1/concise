import { useMemo, useState, type FormEvent } from 'react';
import type { HoldingDto } from '@api';
import { ASSET_CATEGORIES, LIABILITY_CATEGORIES, METALS } from '@api';
import {
  useCreateHolding, useDeleteHolding, useHoldings, useMarketRefresh, useMe,
  useRevalueHolding, useSymbolLookup, useUpdateHolding, type HoldingKind,
} from '../api/queries.js';
import { Button, Card, EmptyState, ErrorNote, Field, Input, Modal, Select, Spinner } from '../components/ui.js';
import { categoryDisplay, categoryLabel, type HoldingSide } from '../lib/categories.js';
import { formatMinor, minorToInput, parseToMinor } from '../lib/money.js';

const METAL_LABELS: Record<string, string> = {
  gold: 'Gold', silver: 'Silver', platinum: 'Platinum', palladium: 'Palladium',
};

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

export function HoldingsPage({ kind }: { kind: HoldingKind }) {
  const copy = COPY[kind];
  const side: HoldingSide = kind === 'assets' ? 'asset' : 'liability';
  const { data: me } = useMe();
  const holdings = useHoldings(kind);
  const marketRefresh = useMarketRefresh();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<HoldingDto | null>(null);
  const currency = me?.currency ?? 'USD';

  const groups = useMemo(() => {
    const map = new Map<string, HoldingDto[]>();
    for (const h of holdings.data ?? []) {
      map.set(h.category, [...(map.get(h.category) ?? []), h]);
    }
    return [...map.entries()];
  }, [holdings.data]);

  const hasMarketEntries = kind === 'assets' && (holdings.data ?? []).some((h) => h.valuationMode === 'market');

  if (holdings.isLoading) return <Spinner label={`Loading ${copy.title.toLowerCase()}`} />;

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{copy.title}</h1>
        <div className="flex gap-2">
          {hasMarketEntries && (
            <Button
              variant="ghost"
              onClick={() => marketRefresh.mutate()}
              disabled={marketRefresh.isPending}
            >
              {marketRefresh.isPending ? 'Refreshing…' : 'Refresh prices'}
            </Button>
          )}
          <Button onClick={() => setAdding(true)}>{copy.addLabel}</Button>
        </div>
      </header>

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
                {formatMinor(items.reduce((s, i) => s + i.currentValueMinor, 0), currency)}
              </span>
            </div>
            <Card>
              <ul className="divide-y divide-ink-800">
                {items.map((h) => (
                  <li key={h.id}>
                    <button
                      type="button"
                      onClick={() => setEditing(h)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left hover:bg-ink-800/50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-ink-100">{h.name}</span>
                        <span className="flex items-center gap-1.5">
                          {h.metal && (
                            <span className="mt-0.5 inline-block rounded bg-ink-700/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-300">
                              {METAL_LABELS[h.metal] ?? h.metal}
                            </span>
                          )}
                          {h.valuationMode === 'market' ? (
                            <span className="mt-0.5 inline-block rounded bg-gold-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-gold-400">
                              {h.marketSymbol} × {h.quantity}
                            </span>
                          ) : !h.metal && h.notes ? (
                            <span className="block truncate text-xs text-ink-400">{h.notes}</span>
                          ) : null}
                        </span>
                      </span>
                      <span className={`tabular shrink-0 text-sm font-semibold ${copy.tone === 'gain' ? 'text-gain-400' : 'text-loss-400'}`}>
                        {formatMinor(h.currentValueMinor, currency)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        ))
      )}

      {adding && <HoldingForm kind={kind} onClose={() => setAdding(false)} />}
      {editing && <HoldingForm kind={kind} existing={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function HoldingForm({
  kind, existing, onClose,
}: { kind: HoldingKind; existing?: HoldingDto; onClose: () => void }) {
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
  const [isMarket, setIsMarket] = useState(existing?.valuationMode === 'market');
  const [symbol, setSymbol] = useState(existing?.marketSymbol ?? '');
  const [quantity, setQuantity] = useState(existing?.quantity?.toString() ?? '');
  const [value, setValue] = useState(existing ? minorToInput(existing.currentValueMinor) : '');
  const [formError, setFormError] = useState<string | null>(null);
  // Symbol the user has confirmed via lookup. Editing an existing market
  // asset without touching the symbol needs no re-verification.
  const [verified, setVerified] = useState<{ symbol: string; name: string } | null>(null);

  const busy = create.isPending || update.isPending || remove.isPending || revalue.isPending;
  const symbolUpper = symbol.trim().toUpperCase();
  const symbolUnchanged = existing?.marketSymbol === symbolUpper;
  const symbolVerified = verified?.symbol === symbolUpper;
  const needsVerification = isMarket && !symbolUnchanged && !symbolVerified;

  const onVerifySymbol = () => {
    setFormError(null);
    lookup.mutate(symbolUpper, {
      onSuccess: (result) => setVerified(result),
      onError: () =>
        setFormError(`Symbol "${symbolUpper}" was not recognised — check the ticker and try again.`),
    });
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const valueMinor = parseToMinor(value);
    if (isMarket) {
      if (!symbol.trim() || !quantity || Number(quantity) <= 0) {
        setFormError('Market entries need a symbol and a positive quantity.');
        return;
      }
      if (needsVerification) {
        setFormError('Verify the symbol first so we can confirm the instrument.');
        return;
      }
    } else if (valueMinor === null) {
      setFormError('Enter a valid amount, e.g. 1250.00');
      return;
    }

    const onError = (err: unknown) =>
      setFormError(err instanceof Error ? err.message : 'Something went wrong');

    const metalField = category === 'precious_metals' ? { metal } : { metal: null };

    if (!existing) {
      create.mutate(
        {
          category, name, notes: notes || null,
          ...(kind === 'assets' ? metalField : {}),
          ...(isMarket
            ? { valuationMode: 'market' as const, marketSymbol: symbolUpper, quantity: Number(quantity) }
            : { valueMinor: valueMinor! }),
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
                ? { valuationMode: 'market' as const, marketSymbol: symbolUpper, quantity: Number(quantity) }
                : { valuationMode: 'manual' as const }),
            }
          : {}),
      },
      {
        onSuccess: () => {
          // Manual value changed? Record a new valuation (history preserved).
          if (!isMarket && valueMinor !== null && valueMinor !== existing.currentValueMinor) {
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

  return (
    <Modal title={existing ? `Edit ${existing.name}` : COPY[kind].addLabel} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Category">
          {(id) => (
            <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>
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

        {kind === 'assets' && (
          <Field label="Valuation">
            {(id) => (
              <Select
                id={id}
                value={isMarket ? 'market' : 'manual'}
                onChange={(e) => setIsMarket(e.target.value === 'market')}
              >
                <option value="manual">Manual value</option>
                <option value="market">Market price (symbol × quantity)</option>
              </Select>
            )}
          </Field>
        )}

        {isMarket ? (
          <>
            <div className="grid grid-cols-[1fr_auto] items-end gap-2">
              <Field label="Symbol">
                {(id) => (
                  <Input id={id} value={symbol}
                    onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                    placeholder="VWRL" required />
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
              <p role="status" className="flex items-center gap-1.5 text-sm text-gain-400">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="M2 7.5L5.5 11L12 3.5" stroke="currentColor" strokeWidth="1.8"
                    strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {verified!.symbol} — {verified!.name}
              </p>
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
          <Field label={existing ? 'Current value' : 'Value'} hint={existing ? 'Changing this records a new valuation.' : undefined}>
            {(id) => (
              <Input id={id} value={value} onChange={(e) => setValue(e.target.value)}
                inputMode="decimal" placeholder="0.00" required />
            )}
          </Field>
        )}

        <Field label="Notes">
          {(id) => (
            <Input id={id} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
          )}
        </Field>

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
    </Modal>
  );
}
