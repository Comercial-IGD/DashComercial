-- 004: produto Insider (mesma pessoa/dia pode existir em mais de um produto) e Social Selling.

alter table daily_metrics drop constraint if exists daily_metrics_seller_code_date_key;
alter table daily_metrics add constraint daily_metrics_seller_date_product_key unique (seller_code, date, product);

alter table sdr_daily_metrics drop constraint if exists sdr_daily_metrics_seller_code_date_key;
alter table sdr_daily_metrics add constraint sdr_daily_metrics_seller_date_product_key unique (seller_code, date, product);

create table if not exists social_daily_metrics (
  id bigint generated always as identity primary key,
  date date not null,
  seller_code text not null,
  seller_name text not null,
  team text,
  leader text,
  source text,
  week text,
  status text,
  product text not null default 'INSIDER',
  abordados integer,
  responderam integer,
  agendamentos_criados integer,
  agendados_hoje integer,
  calls integer,
  headcounts integer,
  synced_at timestamptz not null default now(),
  unique (seller_code, date, product)
);

alter table social_daily_metrics enable row level security;
create policy "Leitura usuarios social" on social_daily_metrics for select using (app_role() is not null);
create policy "Escrita service role social" on social_daily_metrics for all using (auth.role() = 'service_role');
