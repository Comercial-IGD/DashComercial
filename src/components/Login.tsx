'use client';

import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';

export function Login({ onDemo }: { onDemo: () => void }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState('sending');
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin, shouldCreateUser: true },
    });
    if (error) {
      setError(error.message);
      setState('error');
    } else setState('sent');
  };

  return (
    <main className="login">
      <div className="panel login-card">
        <span className="mark">C</span>
        <h1>Dashboard comercial</h1>
        {state === 'sent' ? (
          <p className="notice">Enviamos um link de acesso para {email}. Abra o e-mail neste dispositivo para entrar.</p>
        ) : (
          <form onSubmit={submit}>
            <label>
              E-mail corporativo
              <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <button type="submit" className="primary" disabled={state === 'sending'}>
              {state === 'sending' ? 'Enviando…' : 'Receber link de acesso'}
            </button>
            {state === 'error' && <p className="notice">Não foi possível enviar o link: {error}</p>}
          </form>
        )}
        <p className="muted">O acesso é liberado pelo administrador do dash.</p>
        <button className="linkish" onClick={onDemo}>
          Ver demonstração com dados fictícios
        </button>
      </div>
    </main>
  );
}
