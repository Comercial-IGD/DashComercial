-- Dash Comercial — schema Supabase
-- Executar no SQL Editor do projeto Supabase (ou via `supabase db push`).

create table if not exists commercial_calendar (
  id text primary key,              -- ex: '2026-01'
  name text not null,                -- ex: 'Janeiro 2026'
  start_date date not null,
  end_date date not null,
  constraint calendar_range check (end_date >= start_date)
);

create table if not exists roster (
  code text primary key,             -- ex: 'V096'
  seller_name text not null,
  team text not null,
  leader_code text not null,
  leader_name text not null,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists daily_metrics (
  id bigint generated always as identity primary key,
  date date not null,
  seller_code text not null references roster(code),
  seller_name text not null,
  team text not null,
  leader text not null,
  source text not null,              -- planilha de origem (nome da aba/spreadsheet)
  week text not null,                -- ex: 'SEMANA 05'
  status text not null default 'Ativo',
  agendas integer,
  agendados integer,
  confirmados integer,
  calls integer,
  solicitadas integer,
  atendidas integer,
  com_venda integer,
  headcounts integer,
  synced_at timestamptz not null default now(),
  unique (seller_code, date)
);

create table if not exists sync_issues (
  id bigint generated always as identity primary key,
  synced_at timestamptz not null default now(),
  source text not null,
  seller text not null,
  ref_date text not null,            -- data ou 'Cadastro' / 'Linha N'
  reason text not null
);

create index if not exists daily_metrics_date_idx on daily_metrics (date);
create index if not exists daily_metrics_seller_idx on daily_metrics (seller_code);

alter table commercial_calendar enable row level security;
alter table roster enable row level security;
alter table daily_metrics enable row level security;
alter table sync_issues enable row level security;

-- Leitura pública (dashboard usa a chave anon, somente SELECT).
create policy "Leitura publica calendario" on commercial_calendar for select using (true);
create policy "Leitura publica roster" on roster for select using (true);
create policy "Leitura publica metrics" on daily_metrics for select using (true);
create policy "Leitura publica issues" on sync_issues for select using (true);

-- Escrita somente via service role (usada pela rota de sync no servidor).
create policy "Escrita service role calendario" on commercial_calendar for all using (auth.role() = 'service_role');
create policy "Escrita service role roster" on roster for all using (auth.role() = 'service_role');
create policy "Escrita service role metrics" on daily_metrics for all using (auth.role() = 'service_role');
create policy "Escrita service role issues" on sync_issues for all using (auth.role() = 'service_role');
