'use client';

import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabaseBrowser } from './supabase/client';

export type AppRole = 'viewer' | 'rh' | 'admin';

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let sb;
    try {
      sb = supabaseBrowser();
    } catch {
      // Sem Supabase configurado: o dash ainda abre no modo demonstração.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- estado inicial sem backend
      setReady(true);
      return;
    }
    const resolve = async (s: Session | null) => {
      setSession(s);
      if (s) {
        const { data } = await sb.from('app_users').select('role').eq('user_id', s.user.id).maybeSingle();
        setRole((data?.role as AppRole) ?? null);
      } else setRole(null);
      setReady(true);
    };
    sb.auth.getSession().then(({ data }) => resolve(data.session));
    const { data: sub } = sb.auth.onAuthStateChange((_event, s) => {
      setTimeout(() => resolve(s), 0);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return { session, role, ready };
}
