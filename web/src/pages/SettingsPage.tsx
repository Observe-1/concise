import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useDeleteLegacyWealth, useLegacyWealth, useLogout, useMe, useSetLegacyWealth,
  useSettings, useUpdateSettings,
} from '../api/queries.js';
import { Button, Card, ErrorNote, Field, Input, Select, Spinner } from '../components/ui.js';
import { formatMinor, parseSignedToMinor } from '../lib/money.js';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'NZD', 'SEK', 'NOK', 'DKK', 'SGD', 'HKD', 'INR'];

export function SettingsPage() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const logout = useLogout();
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [birthYear, setBirthYear] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings.data) {
      setDisplayName(settings.data.displayName);
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
      { displayName, currency, birthYear: birthYear ? Number(birthYear) : null },
      { onSuccess: () => setSaved(true) },
    );
  };

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Settings</h1>

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

      <LegacyWealthCard />

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

      <p className="px-1 text-center text-xs text-ink-600">Concise — private, self-hosted personal finance.</p>
    </div>
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
