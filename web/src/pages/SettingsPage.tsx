import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  useDeleteAllData, useDeleteLegacyWealth, useLegacyWealth, useLogout, useMe, useSetLegacyWealth,
  useSettings, useUpdateSettings,
} from '../api/queries.js';
import { HistoryEntries } from '../components/HistoryEntries.js';
import { Button, Card, ErrorNote, Field, Input, Select, Spinner } from '../components/ui.js';
import { formatMinor, parseSignedToMinor } from '../lib/money.js';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'NZD', 'SEK', 'NOK', 'DKK', 'SGD', 'HKD', 'INR'];

const SECTIONS = [
  { key: 'account', label: 'User account' },
  { key: 'history', label: 'History' },
  { key: 'calculation', label: 'Calculation' },
] as const;
type SectionKey = (typeof SECTIONS)[number]['key'];

export function SettingsPage() {
  const { section } = useParams();
  const navigate = useNavigate();
  const active: SectionKey = SECTIONS.some((s) => s.key === section)
    ? (section as SectionKey)
    : 'account';

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Settings</h1>

      <div role="group" aria-label="Settings sections" className="flex gap-1 overflow-x-auto">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => navigate(`/settings/${s.key}`, { replace: true })}
            aria-pressed={active === s.key}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              active === s.key ? 'bg-gold-500 text-ink-950' : 'text-ink-400 hover:text-ink-100'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {active === 'account' && <AccountSection />}
      {active === 'history' && <HistorySection />}
      {active === 'calculation' && <CalculationSection />}

      <p className="px-1 text-center text-xs text-ink-600">Concise — private, self-hosted personal finance.</p>
    </div>
  );
}

// ---------- user account ----------

function AccountSection() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const logout = useLogout();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings.data) setDisplayName(settings.data.displayName);
  }, [settings.data]);

  if (settings.isLoading) return <Spinner label="Loading settings" />;
  if (!settings.data) return <p role="alert" className="py-10 text-center text-sm text-loss-400">Could not load settings.</p>;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    update.mutate({ displayName }, { onSuccess: () => setSaved(true) });
  };

  return (
    <>
      <Card className="p-5">
        <h2 className="mb-4 text-xs font-medium uppercase tracking-widest text-ink-400">Profile</h2>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Username">
            {(id) => <Input id={id} value={settings.data!.username} disabled className="opacity-60" />}
          </Field>
          <Field label="Display name">
            {(id) => (
              <Input id={id} value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={80} />
            )}
          </Field>
          {update.isError ? <ErrorNote message="Could not save settings." /> : null}
          {saved && !update.isPending ? (
            <p role="status" className="text-sm text-gain-400">Saved.</p>
          ) : null}
          <Button type="submit" disabled={update.isPending}>
            {update.isPending ? 'Saving…' : 'Save'}
          </Button>
        </form>
      </Card>

      <Card className="p-5">
        <h2 className="mb-2 text-xs font-medium uppercase tracking-widest text-ink-400">Session</h2>
        <p className="mb-4 text-sm text-ink-400">Signed in as {settings.data.username}.</p>
        <Button
          variant="danger"
          onClick={() => logout.mutate(undefined, { onSuccess: () => navigate('/login') })}
          disabled={logout.isPending}
        >
          Sign out
        </Button>
      </Card>

      <DangerZone />
    </>
  );
}

const DELETE_PHRASE = 'delete all';

function DangerZone() {
  const deleteAll = useDeleteAllData();
  const [sure, setSure] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const onDelete = () => {
    setError(null);
    setDone(false);
    if (!sure) {
      setError('Tick the box to confirm you are 100% sure.');
      return;
    }
    if (confirmText !== DELETE_PHRASE) {
      setError(`Type "${DELETE_PHRASE}" exactly to confirm.`);
      return;
    }
    deleteAll.mutate(confirmText, {
      onSuccess: () => {
        setDone(true);
        setSure(false);
        setConfirmText('');
      },
      onError: (err) => setError(err instanceof Error ? err.message : 'Could not delete your data.'),
    });
  };

  return (
    <Card className="border-loss-500/40 p-5">
      <h2 className="mb-2 text-xs font-medium uppercase tracking-widest text-loss-400">Danger zone</h2>
      <p className="mb-4 text-sm text-ink-400">
        Permanently delete all your assets, liabilities, recurring schedules and
        net-worth history. Your account and preferences are kept. This cannot be
        undone.
      </p>

      <label className="mb-3 flex cursor-pointer items-start gap-2 text-sm text-ink-300">
        <input
          type="checkbox"
          checked={sure}
          onChange={(e) => setSure(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-loss-500"
        />
        <span>I am 100% sure I want to delete all of my data.</span>
      </label>

      <Field label={`Type "${DELETE_PHRASE}" to confirm`}>
        {(id) => (
          <Input
            id={id}
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={DELETE_PHRASE}
            autoComplete="off"
          />
        )}
      </Field>

      {error ? <div className="mt-3"><ErrorNote message={error} /></div> : null}
      {done && !deleteAll.isPending ? (
        <p role="status" className="mt-3 text-sm text-gain-400">All data deleted.</p>
      ) : null}

      <Button
        variant="danger"
        className="mt-4"
        onClick={onDelete}
        disabled={deleteAll.isPending}
      >
        {deleteAll.isPending ? 'Deleting…' : 'Delete all data'}
      </Button>
    </Card>
  );
}

// ---------- history ----------

function HistorySection() {
  return (
    <>
      <LegacyWealthCard />
      <HistoryEntries />
    </>
  );
}

// ---------- calculation ----------

function CalculationSection() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const [currency, setCurrency] = useState('USD');
  const [birthYear, setBirthYear] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings.data) {
      setCurrency(settings.data.currency);
      setBirthYear(settings.data.birthYear?.toString() ?? '');
    }
  }, [settings.data]);

  if (settings.isLoading) return <Spinner label="Loading settings" />;
  if (!settings.data) return <p role="alert" className="py-10 text-center text-sm text-loss-400">Could not load settings.</p>;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    update.mutate(
      { currency, birthYear: birthYear ? Number(birthYear) : null },
      { onSuccess: () => setSaved(true) },
    );
  };

  return (
    <Card className="p-5">
      <h2 className="mb-4 text-xs font-medium uppercase tracking-widest text-ink-400">Calculation</h2>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Currency" hint="Used for formatting all amounts.">
          {(id) => (
            <Select id={id} value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="Birth year"
          hint="Optional. Charts spanning 5+ years show a subtle marker with your age. Leave blank to disable."
        >
          {(id) => (
            <Input
              id={id}
              type="number"
              min={1900}
              max={2100}
              value={birthYear}
              onChange={(e) => setBirthYear(e.target.value)}
              placeholder="e.g. 1990"
            />
          )}
        </Field>
        {update.isError ? <ErrorNote message="Could not save settings." /> : null}
        {saved && !update.isPending ? (
          <p role="status" className="text-sm text-gain-400">Saved.</p>
        ) : null}
        <Button type="submit" disabled={update.isPending}>
          {update.isPending ? 'Saving…' : 'Save'}
        </Button>
      </form>
    </Card>
  );
}

function LegacyWealthCard() {
  const { data: me } = useMe();
  const legacy = useLegacyWealth();
  const setLegacy = useSetLegacyWealth();
  const deleteLegacy = useDeleteLegacyWealth();
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const currency = me?.currency ?? 'USD';

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const netWorthMinor = parseSignedToMinor(amount);
    if (netWorthMinor === null) {
      setError('Enter a valid amount, e.g. 25000 or -4000.');
      return;
    }
    setLegacy.mutate(
      { date, netWorthMinor },
      {
        onSuccess: () => {
          setDate('');
          setAmount('');
        },
        onError: (err) => setError(err instanceof Error ? err.message : 'Could not save'),
      },
    );
  };

  return (
    <Card className="p-5">
      <h2 className="mb-2 text-xs font-medium uppercase tracking-widest text-ink-400">Legacy wealth</h2>
      <p className="mb-4 text-sm text-ink-400">
        Know what you were worth before you started tracking? Add past net-worth
        points and they appear on your graph.
      </p>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            {(id) => (
              <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            )}
          </Field>
          <Field label="Net worth">
            {(id) => (
              <Input id={id} value={amount} onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal" placeholder="25000.00" required />
            )}
          </Field>
        </div>
        {error ? <ErrorNote message={error} /> : null}
        <Button type="submit" variant="ghost" disabled={setLegacy.isPending}>
          {setLegacy.isPending ? 'Adding…' : 'Add point'}
        </Button>
      </form>

      {(legacy.data?.length ?? 0) > 0 && (
        <ul className="mt-4 divide-y divide-ink-800 border-t border-ink-800">
          {legacy.data!.map((entry) => (
            <li key={entry.date} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <span className="text-ink-300">{entry.date}</span>
              <span className={`tabular font-medium ${entry.netWorthMinor >= 0 ? 'text-gold-400' : 'text-loss-400'}`}>
                {formatMinor(entry.netWorthMinor, currency)}
              </span>
              <Button
                variant="subtle"
                aria-label={`Delete legacy entry ${entry.date}`}
                onClick={() => deleteLegacy.mutate(entry.date)}
                disabled={deleteLegacy.isPending}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
