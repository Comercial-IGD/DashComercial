import { periodFor } from './calendar';
import { METRIC_KEYS, type CommercialPeriod, type DailyRow, type MetricKey } from './types';

export type Aggregate = Record<MetricKey, number | null> & {
  missing: Record<MetricKey, number>;
};

export function sum(rows: DailyRow[]): Aggregate {
  const result = {} as Aggregate;
  const missing = {} as Record<MetricKey, number>;
  for (const k of METRIC_KEYS) {
    const known = rows.filter((r) => Number.isSafeInteger(r[k]));
    result[k] = known.length ? known.reduce((n, r) => n + (r[k] as number), 0) : null;
    missing[k] = rows.length - known.length;
  }
  result.missing = missing;
  return result;
}

export function conversion(s: Aggregate) {
  return s.atendidas && s.comVenda !== null ? s.comVenda / s.atendidas : null;
}

export type GroupMode = 'daily' | 'weekly' | 'monthly';

export function bucket(r: DailyRow, mode: GroupMode, calendar: CommercialPeriod[]) {
  if (mode === 'daily') return r.date;
  const p = periodFor(r.date, calendar);
  if (mode === 'weekly') return `${p ? p.id.slice(0, 4) : ''} · ${r.week}`;
  return p ? p.id : r.date;
}

export interface Group extends Aggregate {
  name: string;
  items: DailyRow[];
}

export function groupBy(rows: DailyRow[], key: (r: DailyRow) => string): Group[] {
  const m = new Map<string, DailyRow[]>();
  for (const r of rows) {
    const k = key(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  }
  return [...m].map(([name, items]) => ({ name, items, ...sum(items) }));
}

export function metricValue(agg: Aggregate, k: MetricKey) {
  const v = agg[k];
  if (v === null) return '—';
  const formatted = v.toLocaleString('pt-BR');
  return agg.missing?.[k] ? `${formatted} *` : formatted;
}
