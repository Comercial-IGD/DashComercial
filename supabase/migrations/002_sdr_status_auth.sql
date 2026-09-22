-- 002 — SDR, produto, status de atuação (RH) e login obrigatório.
-- Executar no SQL Editor depois do schema.sql.

-- Produto e cargo atual
alter table roster add column if not exists role text;
alter table roster add column if not exists product text not null default 'FL';
alter table daily_metrics add column if not exists product text not null default 'FL';

-- Métricas diárias de SDR
create table if not exists sdr_daily_metrics (
  id bigint generated always as identity primary key,
  date date not null,
  seller_code text not null references roster(code),
  seller_name text not null,
  team text not null,
  leader text not null,
  source text not null,
  week text not null,
  status text not null default 'Ativo',
  product text not null default 'FL',
  ligacoes integer,
  atenderam integer,
  agendas_criadas integer,
  agendados_hoje integer,
  compareceram integer,
  headcounts integer,
  synced_at timestamptz not null default now(),
  unique (seller_code, date)
);
create index if not exists sdr_daily_metrics_date_idx on sdr_daily_metrics (date);
alter table sdr_daily_metrics enable row level security;

-- Usuários do dash e papéis
create table if not exists app_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  role text not null default 'viewer' check (role in ('viewer', 'rh', 'admin'))
);
alter table app_users enable row level security;

create or replace function app_role() returns text
language sql stable security definer set search_path = public as $$
  select role from app_users where user_id = auth.uid()
$$;

-- Status de atuação lançado pelo RH
create table if not exists attendance_status (
  id bigint generated always as identity primary key,
  seller_code text not null references roster(code),
  start_date date not null,
  end_date date not null,
  reason text not null check (reason in ('day_off','problema_internet','problema_energia','atestado','ferias','falta','treinamento','outro')),
  note text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_range check (end_date >= start_date)
);
create index if not exists attendance_status_seller_idx on attendance_status (seller_code, start_date);
alter table attendance_status enable row level security;

-- Leitura só para usuários cadastrados no dash (substitui a leitura pública)
drop policy if exists "Leitura publica calendario" on commercial_calendar;
drop policy if exists "Leitura publica roster" on roster;
drop policy if exists "Leitura publica metrics" on daily_metrics;
drop policy if exists "Leitura publica issues" on sync_issues;

create policy "Leitura usuarios calendario" on commercial_calendar for select using (app_role() is not null);
create policy "Leitura usuarios roster" on roster for select using (app_role() is not null);
create policy "Leitura usuarios metrics" on daily_metrics for select using (app_role() is not null);
create policy "Leitura usuarios sdr" on sdr_daily_metrics for select using (app_role() is not null);
create policy "Leitura usuarios issues" on sync_issues for select using (app_role() is not null);
create policy "Leitura usuarios status" on attendance_status for select using (app_role() is not null);
create policy "Leitura propria app_users" on app_users for select using (user_id = auth.uid() or app_role() = 'admin');

create policy "Escrita service role sdr" on sdr_daily_metrics for all using (auth.role() = 'service_role');

create policy "RH insere status" on attendance_status for insert with check (app_role() in ('rh','admin'));
create policy "RH altera status" on attendance_status for update using (app_role() in ('rh','admin'));
create policy "RH exclui status" on attendance_status for delete using (app_role() in ('rh','admin'));

create policy "Admin gerencia usuarios" on app_users for all using (app_role() = 'admin') with check (app_role() = 'admin');

-- Primeiro admin: depois que a pessoa entrar uma vez pelo link mágico, rodar:
-- insert into app_users (user_id, email, role)
--   select id, email, 'admin' from auth.users where email = 'SEU_EMAIL';
