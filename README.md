# Dash Comercial — SDRs e Closers

Dashboard comercial (funil SDR → closer), migrado do protótipo em Google Apps Script para
Next.js + Supabase + Vercel.

## Visões
- **Visão geral**: funil único Ligações → Atenderam → Agendas criadas → Agendados → Compareceram →
  Levantadas atendidas → Com venda, com taxa de passagem, comparação com o período anterior e destaque da maior perda.
- **SDR** e **Closers**: indicadores, taxas, evolução, ranking com pódio do top 3 e tabela por pessoa/líder.
- **Pessoas**: linha do tempo de cada integrante nos papéis SDR/closer e ausências no período.
- **Status (RH)**: RH/admin registram os dias em que a pessoa não atuou (day off, problema de internet etc.).

## Arquitetura
- **Frontend**: Next.js 16 (App Router), 100% cliente, lê o Supabase com a sessão do usuário. [src/app/page.tsx](src/app/page.tsx)
- **Acesso**: login por link mágico (Supabase Auth). Só entra quem está em `app_users` (`viewer`, `rh`, `admin`);
  a segurança é garantida por RLS no banco.
- **Banco** (Supabase): [supabase/schema.sql](supabase/schema.sql) + [supabase/migrations/002_sdr_status_auth.sql](supabase/migrations/002_sdr_status_auth.sql)
  - `roster` — cadastro ativo (produto, cargo atual, líder).
  - `daily_metrics` — base diária de closers; `sdr_daily_metrics` — base diária de SDRs.
  - `attendance_status` — ausências lançadas pelo RH.
  - `app_users` — quem acessa e com qual papel.
  - `commercial_calendar`, `sync_issues`.
- **Coleta**: `GET /api/sync` ([src/app/api/sync/route.ts](src/app/api/sync/route.ts)) lê o cadastro e as planilhas
  ([src/lib/googleSheets.ts](src/lib/googleSheets.ts)) via service account, detecta se cada bloco é de SDR ou de closer
  pelo cabeçalho (a pessoa pode trocar de papel) e grava no Supabase. Agendada via Vercel Cron ([vercel.json](vercel.json)).
  Produtos coletados: `ACTIVE_PRODUCTS` (hoje só `FL`).

## Configuração
1. `.env.local` a partir de `.env.example`.
2. No SQL Editor do Supabase, rodar `schema.sql` e depois `migrations/002_sdr_status_auth.sql`.
3. Supabase → Authentication → URL Configuration: incluir a URL local e a da Vercel em *Redirect URLs*.
4. Entrar uma vez no dash com o seu e-mail e depois se tornar admin:
   ```sql
   insert into app_users (user_id, email, role)
   select id, email, 'admin' from auth.users where email = 'SEU_EMAIL';
   ```
   Os demais usuários: mesmo comando, com `role` `rh` ou `viewer`.
5. Compartilhar o cadastro e as 8 planilhas (6 de líder + 2 de SDR) com a service account como Leitor.
6. Primeira sincronização: `GET /api/sync` com `Authorization: Bearer <CRON_SECRET>`.

## Modo demonstração
Na tela de login, "Ver demonstração" carrega dados fictícios em memória (inclusive a aba de RH) sem gravar nada.
