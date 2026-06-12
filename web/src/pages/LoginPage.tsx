import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useLogin, useMe } from '../api/queries.js';
import { ApiError } from '../api/client.js';
import { Button, ErrorNote, Field, Input } from '../components/ui.js';

export function LoginPage() {
  const { data: me, isLoading } = useMe();
  const login = useLogin();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  if (!isLoading && me) return <Navigate to="/" replace />;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate(
      { username, password },
      { onSuccess: () => navigate('/', { replace: true }) },
    );
  };

  const errorMessage =
    login.error instanceof ApiError
      ? login.error.status === 429
        ? 'Too many attempts — wait a few minutes and try again.'
        : login.error.message
      : login.error
        ? 'Something went wrong. Try again.'
        : null;

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <header className="mb-8 text-center">
          <h1 className="text-3xl font-semibold tracking-wide text-gold-500">Concise</h1>
          <p className="mt-2 text-sm text-ink-400">Your wealth, at a glance.</p>
        </header>

        <form onSubmit={onSubmit} className="space-y-4 rounded-3xl border border-ink-800 bg-ink-900 p-6">
          <Field label="Username">
            {(id) => (
              <Input
                id={id}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                required
              />
            )}
          </Field>
          <Field label="Password">
            {(id) => (
              <Input
                id={id}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            )}
          </Field>
          {errorMessage ? <ErrorNote message={errorMessage} /> : null}
          <Button type="submit" className="w-full" disabled={login.isPending}>
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </Button>
          <p className="text-center text-xs text-ink-400">
            Demo account: <span className="text-ink-300">demo / demo</span>
          </p>
          <Link
            to="/register"
            className="block w-full rounded-xl border border-ink-700 px-4 py-2.5 text-center text-sm text-ink-100 transition-colors hover:border-gold-500 hover:text-gold-400"
          >
            Create account
          </Link>
        </form>
      </div>
    </div>
  );
}
