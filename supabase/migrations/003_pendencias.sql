-- 003 — Detalhes das pendências de lançamento (para cobrar a correção).
alter table sync_issues add column if not exists kind text not null default 'outro';
alter table sync_issues add column if not exists seller_code text;
alter table sync_issues add column if not exists leader text;
alter table sync_issues add column if not exists field text;
alter table sync_issues add column if not exists sheet_value text;
alter table sync_issues add column if not exists expected text;
alter table sync_issues add column if not exists url text;
alter table sync_issues add column if not exists sheet_date date;
create index if not exists sync_issues_leader_idx on sync_issues (leader, seller_code);
