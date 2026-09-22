import 'server-only';
import { createClient } from '@supabase/supabase-js';

// Cliente para uso apenas em rotas de servidor (API routes) — chave service role,
// nunca deve ser exposta ao browser.
export function supabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('Variáveis NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes.');
  }
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}
