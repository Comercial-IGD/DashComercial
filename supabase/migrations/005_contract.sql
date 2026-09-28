-- 005: tipo de contrato (senioridade, regime, supervisor) e data de início (21 dias de avaliação) no cadastro.

alter table roster add column if not exists seniority text;
alter table roster add column if not exists regime text;
alter table roster add column if not exists supervisor boolean not null default false;
alter table roster add column if not exists start_date date;
