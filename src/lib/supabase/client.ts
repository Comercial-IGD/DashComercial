import { createClient } from '@supabase/supabase-js';

// Cliente para uso no browser — somente leitura (RLS restringe escrita ao service role).
export function supabaseBrowser() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('Variáveis NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY ausentes.');
  }
  return createClient(url, anonKey, { auth: { persistSession: false } });
}
