'use client';

import { useMemo, useState } from 'react';
import './dashboard.css';
import { absenceIndex } from '@/lib/attendance';
import { buildDemoData } from '@/lib/demoData';
import { applyFilters, EMPTY_FILTERS, selectedRange, type Filters } from '@/lib/filters';
import { previousRange } from '@/lib/metrics';
import { supabaseBrowser } from '@/lib/supabase/client';
import { METRIC_KEYS, METRIC_LABELS, SDR_KEYS, SDR_LABELS, type DashboardData, type MetricKey, type SdrKey } from '@/lib/types';
import { useAuth } from '@/lib/useAuth';
import { useDashboardData } from '@/lib/useDashboardData';
import { Funnel } from '@/components/Funnel';
import { Login } from '@/components/Login';
import { MetricsView, type RateDef } from '@/components/MetricsView';
import { PeopleView } from '@/components/PeopleView';
import { PendingView } from '@/components/PendingView';
import { StatusAdmin } from '@/components/StatusAdmin';

type Tab = 'overview' | 'sdr' | 'closers' | 'people' | 'pending' | 'status';

const WEEKDAYS = [
  ['1', 'Segunda'],
  ['2', 'Terça'],
  ['3', 'Quarta'],
  ['4', 'Quinta'],
  ['5', 'Sexta'],
  ['6', 'Sábado'],
  ['0', 'Domingo'],
];

const SDR_RATES: RateDef<SdrKey>[] = [
  { id: 'contato', label: 'Taxa de contato', num: 'atenderam', den: 'ligacoes', minBase: 50, hint: 'Atenderam ÷ ligações realizadas' },
  { id: 'agendamento', label: 'Taxa de agendamento', num: 'agendasCriadas', den: 'atenderam', minBase: 20, hint: 'Agendas criadas ÷ atenderam' },
  { id: 'show', label: 'Comparecimento', num: 'compareceram', den: 'agendadosHoje', minBase: 10, hint: 'Compareceram ÷ agendados para o dia' },
];

const CLOSER_RATES: RateDef<MetricKey>[] = [
  { id: 'show', label: 'Comparecimento', num: 'calls', den: 'agendados', minBase: 10, hint: 'Compareceram ÷ agendados' },
  { id: 'conversao', label: 'Conversão de levantadas', num: 'comVenda', den: 'atendidas', minBase: 10, hint: 'Levantadas com venda ÷ levantadas atendidas' },
];

export default function DashboardPage() {
  const { session, role, ready } = useAuth();
  const [demo, setDemo] = useState<DashboardData | null>(null);
  const live = useDashboardData(!!session && !!role && !demo);
  const [tab, setTab] = useState<Tab>('overview');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  const data = demo ?? live.data;
  const canEditStatus = !!demo || role === 'rh' || role === 'admin';
  const setFilter = (k: keyof Filters, v: string) => setFilters((f) => ({ ...f, [k]: v }));

  const allRows = useMemo(() => [...data.rows, ...data.sdrRows], [data]);
  const options = (pick: (r: (typeof allRows)[number]) => string) => [...new Set(allRows.map(pick))].filter(Boolean).sort();
  const people = useMemo(
    () => [...new Map(allRows.map((r) => [r.sellerId, r.seller])).entries()].sort((a, b) => a[1].localeCompare(b[1])),
    [allRows],
  );

  const absences = useMemo(() => absenceIndex(data.statuses), [data.statuses]);
  const range = selectedRange(filters, data.calendar);
  const closers = useMemo(() => applyFilters(data.rows, filters, data.calendar), [data.rows, filters, data.calendar]);
  const sdrs = useMemo(() => applyFilters(data.sdrRows, filters, data.calendar), [data.sdrRows, filters, data.calendar]);
  const prev = useMemo(() => {
    if (!range || filters.week) return null;
    const r = previousRange(range.from, range.to);
    return { closers: applyFilters(data.rows, filters, data.calendar, r), sdrs: applyFilters(data.sdrRows, filters, data.calendar, r) };
  }, [range?.from, range?.to, filters, data]); // eslint-disable-line react-hooks/exhaustive-deps

  const issues = useMemo(() => {
    const from = range?.from ?? filters.from;
    const to = range?.to ?? filters.to;
    return data.issues.filter(
      (i) =>
        (!filters.leader || i.leader === filters.leader) &&
        (!filters.person || i.sellerCode === filters.person) &&
        (!i.sheetDate || ((!from || i.sheetDate >= from) && (!to || i.sheetDate <= to))),
    );
  }, [data.issues, filters, range?.from, range?.to]);
  const pendingCodes = useMemo(() => new Set(issues.map((i) => i.sellerCode).filter(Boolean) as string[]), [issues]);

  if (!ready) return <div className="dash"><p className="empty">Carregando…</p></div>;
  if (!demo && !session) return <div className="dash"><Login onDemo={() => setDemo(buildDemoData())} /></div>;
  if (!demo && !role)
    return (
      <div className="dash">
        <main className="login">
          <div className="panel login-card">
            <h1>Acesso pendente</h1>
            <p className="muted">Sua conta ({session?.user.email}) ainda não foi liberada. Peça ao administrador do dash para cadastrar seu e-mail.</p>
            <button onClick={() => supabaseBrowser().auth.signOut()}>Sair</button>
          </div>
        </main>
      </div>
    );

  const notice = demo
    ? 'DEMONSTRAÇÃO • Dados fictícios. Nada é gravado no banco.'
    : live.error
      ? `Não foi possível atualizar: ${live.error}`
      : live.loading && !live.loadedAt
        ? 'Consultando a base de dados…'
        : `Atualizado às ${live.loadedAt?.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) ?? '—'} · ${data.rows.length.toLocaleString('pt-BR')} registros de closers · ${data.sdrRows.length.toLocaleString('pt-BR')} de SDR · atualização automática a cada 5 minutos`;

  const tabs: [Tab, string][] = [
    ['overview', 'Visão geral'],
    ['sdr', 'SDR'],
    ['closers', 'Closers'],
    ['people', 'Pessoas'],
    ['pending', 'Pendências'],
    ...(canEditStatus ? ([['status', 'Status (RH)']] as [Tab, string][]) : []),
  ];

  const rangeView = { from: range?.from ?? filters.from ?? undefined, to: range?.to ?? filters.to ?? undefined };
  const singlePerson = !!filters.person;

  return (
    <div className="dash">
      <header>
        <a className="brand" href="#">
          <span className="mark">C</span> COMERCIAL <span className="divider">/</span> <b>Performance</b>
        </a>
        <span className="scope">{demo ? 'DEMONSTRAÇÃO' : `${session?.user.email} · ${role === 'admin' ? 'Admin' : role === 'rh' ? 'RH' : 'Leitura'}`}</span>
        {demo ? (
          <button onClick={() => setDemo(null)}>Sair da demonstração</button>
        ) : (
          <>
            <button onClick={() => live.reload()} disabled={live.loading}>
              {live.loading ? 'Atualizando…' : 'Atualizar agora'}
            </button>
            <button onClick={() => supabaseBrowser().auth.signOut()}>Sair</button>
          </>
        )}
      </header>

      <main>
        <nav className="tabs" aria-label="Visões">
          {tabs.map(([id, label]) => (
            <button key={id} className={tab === id ? 'active' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
              {label}
              {id === 'pending' && issues.length > 0 && <span className="badge tab-badge">{issues.length}</span>}
            </button>
          ))}
        </nav>

        <div className="notice" role="status">
          {notice}
        </div>

        {tab !== 'status' && (
          <section className="filters" aria-label="Filtros">
            <label>
              Produto
              <select value={filters.product} onChange={(e) => setFilter('product', e.target.value)}>
                <option value="">Todos</option>
                {options((r) => r.product).map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              Time
              <select value={filters.team} onChange={(e) => setFilter('team', e.target.value)}>
                <option value="">Todos</option>
                {options((r) => r.team).map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              Líder
              <select value={filters.leader} onChange={(e) => setFilter('leader', e.target.value)}>
                <option value="">Todos</option>
                {options((r) => r.leader).map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              Pessoa
              <select value={filters.person} onChange={(e) => setFilter('person', e.target.value)}>
                <option value="">Todas</option>
                {people.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Mês comercial
              <select value={filters.month} onChange={(e) => setFilter('month', e.target.value)}>
                <option value="">Todos os meses</option>
                {data.calendar.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Semana
              <select value={filters.week} onChange={(e) => setFilter('week', e.target.value)}>
                <option value="">Todas</option>
                {options((r) => r.week).map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              Dia da semana
              <select value={filters.weekday} onChange={(e) => setFilter('weekday', e.target.value)}>
                <option value="">Todos os dias</option>
                {WEEKDAYS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <div className="date-pair">
              <label>
                De
                <input type="date" value={filters.from} onChange={(e) => setFilter('from', e.target.value)} />
              </label>
              <label>
                Até
                <input type="date" value={filters.to} onChange={(e) => setFilter('to', e.target.value)} />
              </label>
            </div>
            <button className="clear" onClick={() => setFilters(EMPTY_FILTERS)}>
              Limpar filtros
            </button>
          </section>
        )}

        {tab === 'overview' && (
          <>
            <Funnel closers={closers} sdrs={sdrs} prev={prev} />
            <section className="middle">
              <MiniRole title="SDR" rows={sdrs.length} people={new Set(sdrs.map((r) => r.sellerId)).size} onOpen={() => setTab('sdr')} />
              <MiniRole title="Closers" rows={closers.length} people={new Set(closers.map((r) => r.sellerId)).size} onOpen={() => setTab('closers')} />
            </section>
          </>
        )}

        {tab === 'sdr' && (
          <MetricsView
            eyebrow="PROSPECÇÃO"
            rows={sdrs}
            keys={SDR_KEYS}
            labels={SDR_LABELS}
            rates={SDR_RATES}
            rankMetrics={['ligacoes', 'agendasCriadas']}
            perDay="ligacoes"
            calendar={data.calendar}
            absences={absences}
            range={rangeView}
            singlePerson={singlePerson}
            pendingCodes={pendingCodes}
            onPending={(code) => {
              setFilters({ ...EMPTY_FILTERS, person: code });
              setTab('pending');
            }}
          />
        )}

        {tab === 'closers' && (
          <MetricsView
            eyebrow="FECHAMENTO"
            rows={closers}
            keys={METRIC_KEYS}
            labels={METRIC_LABELS}
            rates={CLOSER_RATES}
            rankMetrics={['calls', 'headcounts']}
            perDay="calls"
            calendar={data.calendar}
            absences={absences}
            range={rangeView}
            singlePerson={singlePerson}
            pendingCodes={pendingCodes}
            onPending={(code) => {
              setFilters({ ...EMPTY_FILTERS, person: code });
              setTab('pending');
            }}
          />
        )}

        {tab === 'people' && <PeopleView closers={closers} sdrs={sdrs} absences={absences} range={rangeView} />}

        {tab === 'status' && canEditStatus && (
          <StatusAdmin
            roster={data.roster}
            statuses={data.statuses}
            demo={!!demo}
            onSaved={(statuses) => (demo ? setDemo({ ...demo, statuses }) : live.setData((d) => ({ ...d, statuses })))}
          />
        )}

        {tab === 'pending' && <PendingView issues={issues} />}
      </main>
    </div>
  );
}

function MiniRole({ title, rows, people, onOpen }: { title: string; rows: number; people: number; onOpen: () => void }) {
  return (
    <article className="panel">
      <p className="eyebrow">{title.toUpperCase()}</p>
      <h2>
        {people} {people === 1 ? 'pessoa' : 'pessoas'} · {rows.toLocaleString('pt-BR')} registros diários
      </h2>
      <button onClick={onOpen}>Abrir visão de {title}</button>
    </article>
  );
}
