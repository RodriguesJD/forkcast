import { useState, type FormEvent } from 'react';
import { api, ApiError, type User } from '../api/client';

interface Props {
  onSignedIn: (user: User) => void;
  /** Shown above the form, e.g. when a session expired mid-use. */
  notice?: string;
}

export function AuthView({ onSignedIn, notice }: Props) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (mode === 'signup' && password !== confirm) {
      setErrors(['The two passwords do not match.']);
      return;
    }
    setBusy(true);
    setErrors([]);
    try {
      const user = mode === 'login' ? await api.login(username, password) : await api.signup(username, password);
      onSignedIn(user);
    } catch (err) {
      setErrors(err instanceof ApiError ? err.errors : ['Something went wrong. Try again.']);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <form className="card" onSubmit={submit}>
        <h1>Forkcast</h1>
        <p className="muted">
          {mode === 'login' ? 'Sign in to your meal plan.' : 'Create your account. Your recipes and plan are saved here, on every device.'}
        </p>
        {notice && <div className="notice">{notice}</div>}
        <label>
          Username
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            autoFocus
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            minLength={mode === 'signup' ? 8 : undefined}
            required
          />
        </label>
        {mode === 'signup' && (
          <label>
            Password again
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
            />
          </label>
        )}
        {errors.length > 0 && (
          <ul className="errors">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'One moment…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
        <p className="muted switch">
          {mode === 'login' ? (
            <>
              First time here?{' '}
              <button type="button" className="link" onClick={() => { setMode('signup'); setErrors([]); }}>
                Create an account
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button type="button" className="link" onClick={() => { setMode('login'); setErrors([]); }}>
                Sign in
              </button>
            </>
          )}
        </p>
      </form>
    </div>
  );
}
