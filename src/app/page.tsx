'use client';

import { useMemo, useState } from 'react';
import './dashboard.css';
import { labelPeriod, periodFor } from '@/lib/calendar';
import { buildDemoRows } from '@/lib/demoData';
import { bucket, conversion, groupBy, metricValue, sum, type GroupMode } from '@/lib/metrics';
import { METRIC_KEYS, METRIC_LABELS, type DailyRow, type MetricKey } from '@/lib/types';
import { useDashboardData } from '@/lib/useDashboardData';

const WEEKDAYS = [
  { value: '1', label: 'Segunda' },
  { value: '2', label: 'Terça' },
  { value: '3', label: 'Quarta' },
  { value: '4', label: 'Quinta' },
  { value: '5', label: 'Sexta' },
  { value: '6', label: 'Sábado' },
  { value: '0', label: 'Domingo' },
];

const fmt = (n: number) => n.toLocaleString('pt-BR');

interface Filters {
  source: string;
  month: string;
  week: string;
  seller: string;
  status: string;
  weekday: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: Filters = { source: '', month: '', week: '', seller: '', status: '', weekday: '', from: '', to: '' };

export default function DashboardPage() {
  const { data, loading, error, reload } = useDashboardData();
  const [demoRows, setDemoRows] = useState<DailyRow[] | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [mode, setMode] = useState<GroupMode>('monthly');
  const [tableMode, setTableMode] = useState<'seller' | 'leader'>('seller');
  const [metric, setMetric] = useState<MetricKey>('calls');
  const [rankPeriod, setRankPeriod] = useState('');

  const isDemo = demoRows !== null;
  const rows = isDemo ? demoRows! : data.rows;
  const calendar = data.calendar;

  const setFilter = (k: keyof Filters, v: string) => setFilters((f) => ({ ...f, [k]: v }));
  const clearFilters = () => setFilters(EMPTY_FILTERS);

  const options = (key: 'team' | 'week' | 'seller' | 'status') => [...new Set(rows.map((r) => (key === 'team' ? r.team : r[key])))].sort();

  const filtered = useMemo(() => {
    return rows.filter(
      (r) =>
        (!filters.source || r.team === filters.source) &&
        (!filters.month || periodFor(r.date, calendar)?.id === filters.month) &&
        (!filters.week || r.week === filters.week) &&
        (!filters.seller || r.seller === filters.seller) &&
        (!filters.status || r.status === filters.status) &&
        (!filters.weekday || String(new Date(r.date).getUTCDay()) === filters.weekday) &&
        (!filters.from || r.date >= filters.from) &&
        (!filters.to || r.date <= filters.to),
    );
  }, [rows, filters, calendar]);

  const totals = useMemo(() => sum(filtered), [filtered]);
  const has = filtered.length > 0;
  const c = conversion(totals);
  const cPartial = totals.missing?.atendidas || totals.missing?.comVenda;

  const rangeLabel = useMemo(() => {
    if (filters.from && filters.to && filters.from > filters.to) return 'A data inicial deve ser anterior à data final.';
    if (!has) return 'Nenhum registro para esta seleção';
    const dates = filtered.map((r) => r.date).sort();
    const sellers = new Set(filtered.map((r) => r.sellerId)).size;
    return `${labelPeriod(dates[0], calendar)} — ${labelPeriod(dates[dates.length - 1], calendar)} · ${sellers} closers`;
  }, [filtered, has, filters.from, filters.to, calendar]);

  const periods = useMemo(() => [...new Set(filtered.map((r) => bucket(r, mode, calendar)))].sort(), [filtered, mode, calendar]);
  const effectiveRankPeriod = periods.includes(rankPeriod) ? rankPeriod : '';

  const chartGroups = useMemo(() => groupBy(filtered, (r) => bucket(r, mode, calendar)).sort((a, b) => a.name.localeCompare(b.name)), [filtered, mode, calendar]);
  const chartMax = Math.max(1, ...chartGroups.map((g) => g[metric] ?? 0));

  const rankRows = useMemo(
    () => (effectiveRankPeriod ? filtered.filter((r) => bucket(r, mode, calendar) === effectiveRankPeriod) : filtered),
    [filtered, effectiveRankPeriod, mode, calendar],
  );
  const rankCalls = useMemo(
    () =>
      groupBy(rankRows, (r) => r.sellerId)
        .sort((a, b) => (b.calls ?? -1) - (a.calls ?? -1) || a.name.localeCompare(b.name))
        .slice(0, 5),
    [rankRows],
  );
  const rankHead = useMemo(
    () =>
      groupBy(rankRows, (r) => r.sellerId)
        .sort((a, b) => (b.headcounts ?? -1) - (a.headcounts ?? -1) || a.name.localeCompare(b.name))
        .slice(0, 5),
    [rankRows],
  );
  const maxCalls = Math.max(1, ...rankCalls.map((r) => r.calls ?? 0));
  const maxHead = Math.max(1, ...rankHead.map((r) => r.headcounts ?? 0));

  const tableGroups = useMemo(
    () =>
      groupBy(filtered, (r) => (tableMode === 'seller' ? r.sellerId : r.leader)).sort((a, b) => (b.calls ?? -1) - (a.calls ?? -1)),
    [filtered, tableMode],
  );

  const notice = isDemo
    ? 'DEMONSTRAÇÃO • Dados fictícios para explorar o dashboard. Nenhuma planilha conectada.'
    : error
      ? `Não foi possível atualizar: ${error} ${rows.length ? 'Última base válida mantida.' : 'Nenhum conjunto foi exibido.'}`
      : loading
        ? 'Consultando a base de dados…'
        : rows.length
          ? `BASE SUPABASE • ${fmt(rows.length)} registros carregados · Somente leitura · Verificação a cada 5 minutos.`
          : 'SEM DADOS • Ainda não há registros no Supabase, ou explore a demonstração.';

  return (
    <div className="dash">
      <header>
        <a className="brand" href="#">
          <span className="mark">C</span> COMERCIAL <span className="divider">/</span> <b>Closers</b>
        </a>
        <span className="scope">OPERAÇÃO DE CLOSERS</span>
        <button onClick={() => reload()} disabled={loading}>
          {loading ? 'Atualizando…' : 'Atualizar agora'}
        </button>
      </header>
      <main>
        <div className="title">
          <div>
            <p className="eyebrow">VISÃO DA OPERAÇÃO</p>
            <h1>Performance comercial</h1>
          </div>
          <div className="actions">
            <button
              onClick={() => {
                setDemoRows(isDemo ? null : buildDemoRows());
                clearFilters();
              }}
            >
              {isDemo ? 'Sair da demonstração' : 'Explorar demonstração'}
            </button>
            <button onClick={clearFilters}>Limpar filtros</button>
          </div>
        </div>

        <div className="notice" role="status">
          {notice}
        </div>

        <section className="filters" aria-label="Filtros">
          <label>
            Time
            <select value={filters.source} onChange={(e) => setFilter('source', e.target.value)}>
              <option value="">Todos</option>
              {options('team').map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            Mês comercial
            <select value={filters.month} onChange={(e) => setFilter('month', e.target.value)}>
              <option value="">Todos os meses</option>
              {calendar.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Semana
            <select value={filters.week} onChange={(e) => setFilter('week', e.target.value)}>
              <option value="">Todos</option>
              {options('week').map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            Vendedor
            <select value={filters.seller} onChange={(e) => setFilter('seller', e.target.value)}>
              <option value="">Todos</option>
              {options('seller').map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
              <option value="">Todos</option>
              {options('status').map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            Dia da semana
            <select value={filters.weekday} onChange={(e) => setFilter('weekday', e.target.value)}>
              <option value="">Todos os dias</option>
              {WEEKDAYS.map((w) => (
                <option key={w.value} value={w.value}>
                  {w.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            De
            <input type="date" value={filters.from} onChange={(e) => setFilter('from', e.target.value)} />
          </label>
          <label>
            Até
            <input type="date" value={filters.to} onChange={(e) => setFilter('to', e.target.value)} />
          </label>
        </section>

        <div className="sectionbar">
          <p>{rangeLabel}</p>
          <div className="segmented" aria-label="Agrupamento">
            {(['daily', 'weekly', 'monthly'] as GroupMode[]).map((m) => (
              <button
                key={m}
                className={mode === m ? 'active' : ''}
                aria-pressed={mode === m}
                onClick={() => {
                  setMode(m);
                  setRankPeriod('');
                }}
              >
                {m === 'daily' ? 'Diário' : m === 'weekly' ? 'Semanal' : 'Mensal'}
              </button>
            ))}
          </div>
        </div>

        <section className="cards" aria-label="Indicadores">
          {METRIC_KEYS.map((k) => (
            <article className="card" key={k}>
              <small>{METRIC_LABELS[k]}</small>
              <strong>{has ? metricValue(totals, k) : '—'}</strong>
              <div className="line" />
            </article>
          ))}
        </section>

        <section className="middle">
          <article className="panel evolution">
            <div className="panelhead">
              <div>
                <p className="eyebrow">RITMO COMERCIAL</p>
                <h2>Evolução dos resultados</h2>
              </div>
              <label className="sr-only" htmlFor="metric">
                Indicador do gráfico
              </label>
              <select id="metric" value={metric} onChange={(e) => setMetric(e.target.value as MetricKey)}>
                {METRIC_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {METRIC_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>
            <div id="chart">
              {chartGroups.length ? (
                <div className="bars">
                  {chartGroups.map((g) => (
                    <div className="barcol" key={g.name}>
                      <b>{metricValue(g, metric)}</b>
                      <i style={{ height: Math.max(2, ((g[metric] ?? 0) / chartMax) * 150) }} title={`${labelPeriod(g.name, calendar)}: ${g[metric]}`} />
                      <span>{labelPeriod(g.name, calendar)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="empty">
                  Seus resultados aparecerão aqui.
                  <br />A consulta automática está sendo preparada.
                </p>
              )}
            </div>
            <p className="muted">
              {METRIC_LABELS[metric]} • Agrupamento {mode === 'daily' ? 'diário' : mode === 'weekly' ? 'semanal' : 'por mês comercial'}
            </p>
          </article>
          <article className="panel conversion">
            <p className="eyebrow">APOIO QUE CONVERTE</p>
            <h2>Levantadas com venda</h2>
            <strong>{c === null ? 'Sem base' : `${(c * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%${cPartial ? ' *' : ''}`}</strong>
            <div className="meter">
              <i style={{ width: `${c === null ? 0 : c * 100}%` }} />
            </div>
            <p>
              {metricValue(totals, 'comVenda')} com venda / {metricValue(totals, 'atendidas')} atendidas
            </p>
            <p className="muted">Atendimentos com participação de apoio que influenciou a venda, independentemente da data de fechamento.</p>
            <p className="footnote">Headcounts é um indicador independente.</p>
          </article>
        </section>

        <section className="panel">
          <div className="panelhead">
            <div>
              <p className="eyebrow">DESTAQUES DO PERÍODO</p>
              <h2>Ranking de closers</h2>
            </div>
            <label>
              Período do ranking
              <select value={effectiveRankPeriod} onChange={(e) => setRankPeriod(e.target.value)}>
                <option value="">Acumulado da seleção</option>
                {periods.map((p) => (
                  <option key={p} value={p}>
                    {labelPeriod(p, calendar)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="rankings">
            <div>
              <h3>Calls realizadas</h3>
              {rankCalls.length ? (
                rankCalls.map((r, i) => (
                  <div className="rankrow" key={r.name}>
                    <em>{String(i + 1).padStart(2, '0')}</em>
                    <span>{r.items[0].seller}</span>
                    <strong>{metricValue(r, 'calls')}</strong>
                    <i className="bar" style={{ width: `${((r.calls ?? 0) / maxCalls) * 75}%` }} />
                  </div>
                ))
              ) : (
                <p className="muted">Sem dados para este período.</p>
              )}
            </div>
            <div>
              <h3>Headcounts</h3>
              {rankHead.length ? (
                rankHead.map((r, i) => (
                  <div className="rankrow" key={r.name}>
                    <em>{String(i + 1).padStart(2, '0')}</em>
                    <span>{r.items[0].seller}</span>
                    <strong>{metricValue(r, 'headcounts')}</strong>
                    <i className="bar" style={{ width: `${((r.headcounts ?? 0) / maxHead) * 75}%` }} />
                  </div>
                ))
              ) : (
                <p className="muted">Sem dados para este período.</p>
              )}
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panelhead">
            <h2>Resultados detalhados</h2>
            <div className="segmented">
              <button className={tableMode === 'seller' ? 'active' : ''} onClick={() => setTableMode('seller')}>
                Vendedores
              </button>
              <button className={tableMode === 'leader' ? 'active' : ''} onClick={() => setTableMode('leader')}>
                Líderes
              </button>
            </div>
          </div>
          <div className="tablewrap">
            {tableGroups.length ? (
              <table>
                <thead>
                  <tr>
                    <th>{tableMode === 'seller' ? 'Vendedor' : 'Líder'} / período</th>
                    {METRIC_KEYS.map((k) => (
                      <th key={k}>{METRIC_LABELS[k]}</th>
                    ))}
                    <th>Conversão de levantadas</th>
                  </tr>
                </thead>
                <tbody>
                  {tableGroups.map((g) => {
                    const r = g.items[0];
                    const conv = conversion(g);
                    const dates = g.items.map((x) => x.date).sort();
                    const teams = [...new Set(g.items.map((x) => x.team))].join(', ');
                    const statuses = [...new Set(g.items.map((x) => x.status))].join(', ');
                    return (
                      <tr key={g.name}>
                        <td>
                          {tableMode === 'seller' ? r.seller : r.leader}
                          <small>
                            {labelPeriod(dates[0], calendar)} — {labelPeriod(dates[dates.length - 1], calendar)} · {teams}
                            {tableMode === 'seller' ? ` · Líder: ${r.leader} · ${statuses} · Período acumulado` : ' · Período acumulado'}
                          </small>
                        </td>
                        {METRIC_KEYS.map((k) => (
                          <td key={k}>{metricValue(g, k)}</td>
                        ))}
                        <td>{conv === null ? 'Sem base' : `${(conv * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="empty">Nenhum registro encontrado.</p>
            )}
          </div>
        </section>

        {data.issues.length > 0 && (
          <details className="panel">
            <summary>Qualidade dos dados • {data.issues.length} inconsistências nas origens</summary>
            {data.issues.map((x, i) => (
              <p className="muted" key={i}>
                <b>
                  {x.seller} · {x.date}
                </b>
                <br />
                {x.reason}
                <br />
                {x.source}
              </p>
            ))}
          </details>
        )}
      </main>
      <footer>
        <span>Calendário comercial • Base diária única</span>
        <span>
          {fmt(filtered.length)} registros diários · {isDemo ? 'Demonstração' : 'Base Supabase'}
        </span>
      </footer>
    </div>
  );
}
