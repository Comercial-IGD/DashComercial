'use client';

import { useMemo, useState } from 'react';
import { labelPeriod } from '@/lib/calendar';
import { bucket, groupBy, metricValue, pct, ratio, sum, type Aggregate, type GroupMode } from '@/lib/metrics';
import { absencesInRange, workedDays, type AbsenceIndex } from '@/lib/attendance';
import { ABSENCE_REASONS, type CommercialPeriod } from '@/lib/types';
import { BarChart } from './BarChart';
import { Ranking, type RankItem } from './Ranking';

type Row = { date: string; week: string; seller: string; sellerId: string; team: string; leader: string };

export interface RateDef<K extends string> {
  id: string;
  label: string;
  num: K;
  den: K;
  minBase: number;
  hint: string;
}

interface Props<R extends Row, K extends string> {
  eyebrow: string;
  rows: R[];
  keys: readonly K[];
  labels: Record<K, string>;
  rates: RateDef<K>[];
  rankMetrics: K[];
  perDay: K;
  calendar: CommercialPeriod[];
  absences: AbsenceIndex;
  range: { from?: string; to?: string };
  singlePerson: boolean;
}

const fmtDec = (v: number | null) => (v === null ? '—' : v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }));

export function MetricsView<R extends Row, K extends string>(p: Props<R, K>) {
  const [mode, setMode] = useState<GroupMode>('monthly');
  const [metric, setMetric] = useState<K>(p.rankMetrics[0]);
  const [tableMode, setTableMode] = useState<'seller' | 'leader'>('seller');
  const [rankPeriod, setRankPeriod] = useState('');

  const totals = useMemo(() => sum(p.rows, p.keys), [p.rows, p.keys]);
  const worked = useMemo(() => workedDays(p.rows, p.absences), [p.rows, p.absences]);

  const periods = useMemo(() => [...new Set(p.rows.map((r) => bucket(r, mode, p.calendar)))].sort(), [p.rows, mode, p.calendar]);
  const activeRankPeriod = periods.includes(rankPeriod) ? rankPeriod : '';

  const bars = useMemo(() => {
    const person = p.singlePerson ? p.rows[0]?.sellerId : undefined;
    return groupBy(p.rows, p.keys, (r) => bucket(r, mode, p.calendar))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((g) => {
        const absent = person && mode === 'daily' ? p.absences.get(person)?.get(g.name) : undefined;
        return {
          key: g.name,
          label: labelPeriod(g.name, p.calendar),
          value: g[metric],
          display: metricValue(g, metric),
          flagged: absent ? ABSENCE_REASONS[absent.reason] : undefined,
        };
      });
  }, [p.rows, p.keys, p.calendar, p.absences, p.singlePerson, mode, metric]);

  const rankRows = activeRankPeriod ? p.rows.filter((r) => bucket(r, mode, p.calendar) === activeRankPeriod) : p.rows;
  const people = groupBy(rankRows, p.keys, (r) => r.sellerId);
  const absCount = (code: string, items: Row[]) => {
    const dates = items.map((r) => r.date).sort();
    return absencesInRange(p.absences, code, p.range.from ?? dates[0], p.range.to ?? dates.at(-1)).length;
  };
  const toItem = (g: (typeof people)[number], value: number, display: string): RankItem => ({
    id: g.name,
    name: g.items[0].seller,
    subtitle: g.items[0].team,
    value,
    display,
    absences: absCount(g.name, g.items),
  });

  const tableGroups = groupBy(p.rows, p.keys, (r) => (tableMode === 'seller' ? r.sellerId : r.leader)).sort(
    (a, b) => (b[p.perDay] ?? -1) - (a[p.perDay] ?? -1),
  );

  const rateValue = (agg: Aggregate<K>, r: RateDef<K>) => ratio(agg[r.num], agg[r.den]);

  return (
    <>
      <div className="sectionbar">
        <p>
          {worked.toLocaleString('pt-BR')} dias atuados · média de {fmtDec(ratio(totals[p.perDay], worked))} {p.labels[p.perDay].toLowerCase()} por dia atuado
        </p>
        <div className="segmented" aria-label="Agrupamento">
          {(['daily', 'weekly', 'monthly'] as GroupMode[]).map((m) => (
            <button key={m} className={mode === m ? 'active' : ''} aria-pressed={mode === m} onClick={() => setMode(m)}>
              {m === 'daily' ? 'Diário' : m === 'weekly' ? 'Semanal' : 'Mensal'}
            </button>
          ))}
        </div>
      </div>

      <section className="cards" aria-label="Indicadores">
        {p.keys.map((k) => (
          <article className="card" key={k}>
            <small>{p.labels[k]}</small>
            <strong>{p.rows.length ? metricValue(totals, k) : '—'}</strong>
            <div className="line" />
          </article>
        ))}
        {p.rates.map((r) => (
          <article className="card rate" key={r.id} title={r.hint}>
            <small>{r.label}</small>
            <strong>{pct(rateValue(totals, r))}</strong>
            <div className="line" />
          </article>
        ))}
      </section>

      <article className="panel">
        <div className="panelhead">
          <div>
            <p className="eyebrow">{p.eyebrow}</p>
            <h2>Evolução dos resultados</h2>
          </div>
          <select aria-label="Indicador do gráfico" value={metric} onChange={(e) => setMetric(e.target.value as K)}>
            {p.keys.map((k) => (
              <option key={k} value={k}>
                {p.labels[k]}
              </option>
            ))}
          </select>
        </div>
        <BarChart bars={bars} />
        {p.singlePerson && mode === 'daily' && <p className="muted">Dias destacados em laranja foram marcados pelo RH como ausência.</p>}
      </article>

      <section className="panel">
        <div className="panelhead">
          <div>
            <p className="eyebrow">DESTAQUES DO PERÍODO</p>
            <h2>Ranking</h2>
          </div>
          <label>
            Período do ranking
            <select value={activeRankPeriod} onChange={(e) => setRankPeriod(e.target.value)}>
              <option value="">Acumulado da seleção</option>
              {periods.map((x) => (
                <option key={x} value={x}>
                  {labelPeriod(x, p.calendar)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="rankings">
          {p.rankMetrics.map((k) => (
            <Ranking
              key={k}
              title={p.labels[k]}
              items={people.filter((g) => g[k] !== null).map((g) => toItem(g, g[k] as number, metricValue(g, k)))}
            />
          ))}
          {p.rates.map((r) => (
            <Ranking
              key={r.id}
              title={r.label}
              note={`Mínimo de ${r.minBase} ${p.labels[r.den].toLowerCase()} para entrar no ranking.`}
              items={people
                .filter((g) => (g[r.den] ?? 0) >= r.minBase && rateValue(g, r) !== null)
                .map((g) => toItem(g, rateValue(g, r)!, pct(rateValue(g, r))))}
            />
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panelhead">
          <h2>Resultados detalhados</h2>
          <div className="segmented">
            <button className={tableMode === 'seller' ? 'active' : ''} onClick={() => setTableMode('seller')}>
              Pessoas
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
                  <th>{tableMode === 'seller' ? 'Pessoa' : 'Líder'}</th>
                  <th>Dias atuados</th>
                  {tableMode === 'seller' && <th>Ausências</th>}
                  {p.keys.map((k) => (
                    <th key={k}>{p.labels[k]}</th>
                  ))}
                  {p.rates.map((r) => (
                    <th key={r.id}>{r.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableGroups.map((g) => {
                  const r = g.items[0];
                  const dates = g.items.map((x) => x.date).sort();
                  const abs = tableMode === 'seller' ? absencesInRange(p.absences, g.name, p.range.from ?? dates[0], p.range.to ?? dates.at(-1)) : [];
                  const reasons = [...new Set(abs.map((a) => ABSENCE_REASONS[a.status.reason]))];
                  return (
                    <tr key={g.name}>
                      <td>
                        {tableMode === 'seller' ? r.seller : r.leader}
                        <small>
                          {labelPeriod(dates[0], p.calendar)} — {labelPeriod(dates.at(-1)!, p.calendar)} · {[...new Set(g.items.map((x) => x.team))].join(', ')}
                          {tableMode === 'seller' && ` · Líder: ${r.leader}`}
                        </small>
                      </td>
                      <td>{workedDays(g.items, p.absences)}</td>
                      {tableMode === 'seller' && (
                        <td>
                          {abs.length ? (
                            <span className="badge" title={abs.map((a) => `${a.date.split('-').reverse().join('/')}: ${ABSENCE_REASONS[a.status.reason]}`).join('\n')}>
                              {abs.length}d · {reasons.join(', ')}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                      )}
                      {p.keys.map((k) => (
                        <td key={k}>{metricValue(g, k)}</td>
                      ))}
                      {p.rates.map((rt) => (
                        <td key={rt.id}>{pct(rateValue(g, rt))}</td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="empty">Nenhum registro encontrado.</p>
          )}
        </div>
        <p className="footnote">* soma parcial: algum dia do grupo não informou o indicador. — indica que nenhum valor foi informado.</p>
      </section>
    </>
  );
}
