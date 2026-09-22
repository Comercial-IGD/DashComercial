# Dash Comercial — Closers

Dashboard comercial de closers, migrado do protótipo em Google Apps Script para
Next.js + Supabase + Vercel.

## Arquitetura

- **Frontend**: Next.js 16 (App Router) + React, hospedado na Vercel. Lê os dados
  diretamente do Supabase (chave `anon`, somente leitura via RLS). [src/app/page.tsx](src/app/page.tsx)
- **Banco**: Supabase (Postgres). Schema em [supabase/schema.sql](supabase/schema.sql):
  - `roster` — cadastro de closers ativos (equivalente à aba de cadastro).
  - `daily_metrics` — base diária única por vendedor/data (equivalente às abas B:J dos closers).
  - `commercial_calendar` — meses comerciais (mesma regra de fechamento do coletor original).
  - `sync_issues` — inconsistências detectadas na última sincronização.
- **Coleta**: rota `GET /api/sync` ([src/app/api/sync/route.ts](src/app/api/sync/route.ts))
  lê as seis planilhas de closers e o cadastro via Google Sheets API (service account),
  reconcilia duplicidades e grava no Supabase. Protegida por `CRON_SECRET` e agendada
  via Vercel Cron ([vercel.json](vercel.json)).

A lógica de validação/reconciliação (calendário comercial, checagem de cadastro,
conciliação de cópias divergentes) foi portada linha a linha do Apps Script original
para [src/lib/googleSheets.ts](src/lib/googleSheets.ts) e [src/app/api/sync/route.ts](src/app/api/sync/route.ts).

## Configuração

1. Copie `.env.example` para `.env.local` e preencha:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` (conta de serviço com acesso
     leitor às 6 planilhas de closers e à planilha de cadastro)
   - `CRON_SECRET` (qualquer string aleatória)
2. Rode `supabase/schema.sql` no SQL Editor do projeto Supabase.
3. `npm install && npm run dev` para desenvolvimento local.
4. Deploy na Vercel com as mesmas variáveis de ambiente configuradas no projeto.
5. Dispare a primeira sincronização manualmente: `GET /api/sync` com header
   `Authorization: Bearer <CRON_SECRET>`.

## Modo demonstração

O botão "Explorar demonstração" no dashboard carrega dados fictícios em memória,
sem depender do Supabase — útil para revisar a interface antes de ligar a coleta real.
