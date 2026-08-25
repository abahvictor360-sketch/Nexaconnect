'use client';

import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Mode = 'signin' | 'signup' | 'magic';

const LABELS: Record<Mode, { title: string; action: string }> = {
  signin: { title: 'Sign in', action: 'Sign in' },
  signup: { title: 'Create an account', action: 'Create account' },
  magic: { title: 'Email me a link', action: 'Send the link' },
};

export default function LoginForm({
  url,
  anonKey,
  next,
}: {
  url: string;
  anonKey: string;
  next: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const supabase = createBrowserClient(url, anonKey);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      if (mode === 'magic') {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
          },
        });
        if (error) throw error;
        setNotice(`Check ${email} for a sign-in link.`);
        return;
      }

      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
          },
        });
        if (error) throw error;
        // With email confirmation on, there is no session yet.
        if (!data.session) {
          setNotice(`Account created. Check ${email} to confirm it, then sign in.`);
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }

      // A full navigation, so the server re-reads the session cookie.
      router.push(next);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not sign you in.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex gap-1 rounded-full border border-rule bg-paper p-1 text-xs">
        {(['signin', 'signup', 'magic'] as Mode[]).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => {
              setMode(value);
              setError(null);
              setNotice(null);
            }}
            className={`min-h-9 flex-1 rounded-full px-3 ${
              mode === value ? 'bg-brand-900 font-medium text-white' : 'text-muted hover:bg-accent-soft'
            }`}
          >
            {LABELS[value].title}
          </button>
        ))}
      </div>

      <label className="block text-xs text-muted">
        Email address
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          className="mt-1 h-11 w-full rounded-xl border border-rule bg-card px-3 text-sm text-ink"
        />
      </label>

      {mode !== 'magic' ? (
        <label className="block text-xs text-muted">
          Password
          <input
            type="password"
            required
            minLength={8}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="At least 8 characters"
            className="mt-1 h-11 w-full rounded-xl border border-rule bg-card px-3 text-sm text-ink"
          />
        </label>
      ) : (
        <p className="text-xs text-muted">
          No password needed. We will email you a link that signs you in.
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="min-h-11 w-full rounded-full bg-brand-900 px-4 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
      >
        {busy ? 'Working…' : LABELS[mode].action}
      </button>

      {error ? (
        <p role="alert" className="rounded-xl bg-urgency-critical/10 px-3 py-2 text-xs text-urgency-ink-critical">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-xl bg-accent-soft px-3 py-2 text-xs text-accent-deep">{notice}</p>
      ) : null}
    </form>
  );
}
