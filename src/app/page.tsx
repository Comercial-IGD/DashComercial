'use client';

import { useMemo, useState } from 'react';
import './dashboard.css';
import { absenceIndex } from '@/lib/attendance';
import { buildDemoData } from '@/lib/demoData';
import { applyFilters, cascade, EMPTY_FILTERS, facetOptions, selectedRange, type FacetKey, type Filters } from '@/lib/filters';
import { previousRange } from '@/lib/metrics';
import { supabaseBrowser } from '@/lib/supabase/client';
import { ACTION_KINDS, METRIC_KEYS, METRIC_LABELS, PRODUCT_LABELS, SDR_KEYS, SDR_LABELS, SOCIAL_KEYS, SOCIAL_LABELS, type DashboardData, type SyncIssue, type MetricKey, type SdrKey, type SocialKey } from '@/lib/types';
import { useAuth } from '@/lib/useAuth';
import { useDashboardData } from '@/lib/useDashboardData';
import { Funnel } from '@/components/Funnel';
import { Login } from '@/components/Login';
import { MetricsView, type RateDef } from '@/components/MetricsView';
import { PeopleView } from '@/components/PeopleView';
import { PendingView } from '@/components/PendingView';
import { StatusAdmin } from '@/components/StatusAdmin';

type Tab = 'overview' | 'sdr' | 'closers' | 'social' | 'people' | 'pending' | 'status';

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

const SOCIAL_RATES: RateDef<SocialKey>[] = [
  { id: 'resposta', label: 'Taxa de resposta', num: 'responderam', den: 'abordados', minBase: 50, hint: 'Responderam ÷ leads abordados' },
  { id: 'agendamento', label: 'Taxa de agendamento', num: 'agendamentosCriados', den: 'responderam', minBase: 20, hint: 'Agendamentos criados ÷ responderam' },
  { id: 'show', label: 'Comparecimento', num: 'calls', den: 'agendadosHoje', minBase: 10, hint: 'Calls realizadas ÷ agendados para o dia' },
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
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');

  const data = demo ?? live.data;
  const canEditStatus = !!demo || role === 'rh' || role === 'admin';

  const allRows = useMemo(() => [...data.rows, ...data.sdrRows, ...data.socialRows], [data]);
  const setFilter = (k: keyof Filters, v: string) => setFilters((f) => cascade(allRows, { ...f, [k]: v }, data.calendar, k));
  const facet = (k: FacetKey) =>
    facetOptions(allRows, filters, data.calendar, k).map((o) => (k === 'product' ? { ...o, label: PRODUCT_LABELS[o.value] ?? o.value } : o));
  const monthRange = data.calendar.find((m) => m.id === filters.month);

  const absences = useMemo(() => absenceIndex(data.statuses), [data.statuses]);
  const range = selectedRange(filters, data.calendar);
  const closers = useMemo(() => applyFilters(data.rows, filters, data.calendar), [data.rows, filters, data.calendar]);
  const sdrs = useMemo(() => applyFilters(data.sdrRows, filters, data.calendar), [data.sdrRows, filters, data.calendar]);
  const socials = useMemo(() => applyFilters(data.socialRows, filters, data.calendar), [data.socialRows, filters, data.calendar]);
  const prev = useMemo(() => {
    if (!range || filters.week) return null;
    const r = previousRange(range.from, range.to);
    return { closers: applyFilters(data.rows, filters, data.calendar, r), sdrs: applyFilters(data.sdrRows, filters, data.calendar, r) };
  }, [range?.from, range?.to, filters, data]); // eslint-disable-line react-hooks/exhaustive-deps

  const issues = useMemo(() => {
    const from = range?.from ?? filters.from;
    const to = range?.to ?? filters.to;
    // Ausência escrita na planilha some quando o RH registra um status cobrindo o dia.
    const registered = (i: SyncIssue) =>
      i.kind === 'ausencia_planilha' &&
      !!i.sheetDate &&
      data.statuses.some((s) => s.sellerCode === i.sellerCode && s.start <= i.sheetDate! && s.end >= i.sheetDate!);
    return data.issues.filter(
      (i) =>
        !registered(i) &&
        (!filters.leader || i.leader === filters.leader) &&
        (!filters.person || i.sellerCode === filters.person) &&
        (!i.sheetDate || ((!from || i.sheetDate >= from) && (!to || i.sheetDate <= to))),
    );
  }, [data.issues, data.statuses, filters, range?.from, range?.to]);
  const actionIssues = useMemo(() => issues.filter((i) => ACTION_KINDS.includes(i.kind)), [issues]);
  const pendingCodes = useMemo(() => new Set(actionIssues.map((i) => i.sellerCode).filter(Boolean) as string[]), [actionIssues]);

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

  // Lê as planilhas agora (não só o banco) e depois recarrega o dash.
  const syncNow = async () => {
    setSyncing(true);
    setSyncError('');
    try {
      const res = await fetch('/api/sync', { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token}` } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) throw new Error(body.error || `HTTP ${res.status}`);
      await live.reload();
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  };

  const notice = demo
    ? 'DEMONSTRAÇÃO • Dados fictícios. Nada é gravado no banco.'
    : syncing
      ? 'Buscando os dados nas planilhas… isso leva cerca de 1 minuto.'
    : syncError
      ? `Não foi possível ler as planilhas: ${syncError}`
    : live.error
      ? `Não foi possível atualizar: ${live.error}`
      : live.loading && !live.loadedAt
        ? 'Consultando a base de dados…'
        : `Planilhas lidas em ${live.syncedAt?.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) ?? '—'} ·${data.rows.length.toLocaleString('pt-BR')} registros de closers · ${data.sdrRows.length.toLocaleString('pt-BR')} de SDR · clique em "Atualizar agora" para buscar os lançamentos mais recentes`;

  const tabs: [Tab, string][] = [
    ['overview', 'Visão geral'],
    ['sdr', 'SDR'],
    ['closers', 'Closers'],
    ['social', 'Social Selling'],
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
            <button onClick={syncNow} disabled={live.loading || syncing}>
              {syncing ? 'Buscando nas planilhas…' : live.loading ? 'Atualizando…' : 'Atualizar agora'}
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
              {id === 'pending' && actionIssues.length > 0 && <span className="badge tab-badge">{actionIssues.length}</span>}
            </button>
          ))}
        </nav>

        <div className="notice" role="status">
          {notice}
        </div>

        {tab !== 'status' && (
          <section className="filters" aria-label="Filtros">
            <FacetSelect label="Produto" all="Todos" value={filters.product} options={facet('product')} showPeople={true} onChange={(v) => setFilter('product', v)} />
            <FacetSelect label="Time" all="Todos" value={filters.team} options={facet('team')} showPeople={true} onChange={(v) => setFilter('team', v)} />
            <FacetSelect label="Líder" all="Todos" value={filters.leader} options={facet('leader')} showPeople={true} onChange={(v) => setFilter('leader', v)} />
            <FacetSelect label="Pessoa" all="Todas" value={filters.person} options={facet('person')} showPeople={false} onChange={(v) => setFilter('person', v)} />
            <FacetSelect label="Mês comercial" all="Todos os meses" value={filters.month} options={facet('month')} showPeople={true} onChange={(v) => setFilter('month', v)} />
            <FacetSelect label="Semana" all="Todas" value={filters.week} options={facet('week')} showPeople={true} onChange={(v) => setFilter('week', v)} />
            <label>
              Dia da semana
              <select className={filters.weekday ? 'active' : ''} value={filters.weekday} onChange={(e) => setFilter('weekday', e.target.value)}>
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
                <input type="date" value={filters.from} min={monthRange?.start} max={filters.to || monthRange?.end} onChange={(e) => setFilter('from', e.target.value)} />
              </label>
              <label>
                Até
                <input type="date" value={filters.to} min={filters.from || monthRange?.start} max={monthRange?.end} onChange={(e) => setFilter('to', e.target.value)} />
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
              <MiniRole title="Social Selling" rows={socials.length} people={new Set(socials.map((r) => r.sellerId)).size} onOpen={() => setTab('social')} />
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

        {tab === 'social' && (
          <MetricsView
            eyebrow="SOCIAL SELLING"
            rows={socials}
            keys={SOCIAL_KEYS}
            labels={SOCIAL_LABELS}
            rates={SOCIAL_RATES}
            rankMetrics={['abordados', 'agendamentosCriados']}
            perDay="abordados"
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

function FacetSelect(props: {
  label: string;
  all: string;
  value: string;
  options: { value: string; label: string; people: number }[];
  showPeople: boolean;
  onChange: (v: string) => void;
}) {
  const single = props.options.length === 1 && !props.value;
  return (
    <label>
      {props.label}
      <select className={props.value ? 'active' : ''} value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        <option value="">
          {props.all}
          {single ? ` (só ${props.options[0].label})` : props.options.length > 1 ? ` (${props.options.length})` : ''}
        </option>
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
            {props.showPeople ? ` · ${o.people} ${o.people === 1 ? 'pessoa' : 'pessoas'}` : ''}
          </option>
        ))}
      </select>
    </label>
  );
}
