import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useMe, useRegister } from '../api/queries.js';
import { ApiError } from '../api/client.js';
import { Button, ErrorNote, Field, Input } from '../components/ui.js';

export function RegisterPage() {
  const { data: me, isLoading } = useMe();
  const registerMutation = useRegister();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  if (!isLoading && me) return <Navigate to="/" replace />;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (password !== confirm) {
      setFormError('Passwords do not match.');
      return;
    }
    registerMutation.mutate(
      { username, password, ...(displayName.trim() ? { displayName } : {}) },
      {
        onSuccess: () => navigate('/', { replace: true }),
        onError: (err) =>
          setFormError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.'),
      },
    );
  };

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <header className="mb-8 text-center">
          <h1 className="text-3xl font-semibold tracking-wide text-gold-500">Concise</h1>
          <p className="mt-2 text-sm text-ink-400">Create your account.</p>
        </header>

        <form onSubmit={onSubmit} className="space-y-4 rounded-3xl border border-ink-800 bg-ink-900 p-6">
          <Field label="Username" hint="3–32 characters: letters, numbers, dots, dashes, underscores.">
            {(id) => (
              <Input
                id={id}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                required
                minLength={3}
                maxLength={32}
              />
            )}
          </Field>
          <Field label="Display name" hint="Optional — defaults to your username.">
            {(id) => (
              <Input id={id} value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={80} />
            )}
          </Field>
          <Field label="Password" hint="At least 8 characters.">
            {(id) => (
              <Input
                id={id}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
                minLength={8}
              />
            )}
          </Field>
          <Field label="Confirm password">
            {(id) => (
              <Input
                id={id}
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
              />
            )}
          </Field>
          {formError ? <ErrorNote message={formError} /> : null}
          <Button type="submit" className="w-full" disabled={registerMutation.isPending}>
            {registerMutation.isPending ? 'Creating account…' : 'Create account'}
          </Button>
          <p className="text-center text-xs text-ink-400">
            Already have an account?{' '}
            <Link to="/login" className="text-gold-400 hover:text-gold-300">Sign in</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
