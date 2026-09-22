import { periodFor } from './calendar';
import type { CommercialPeriod } from './types';

type Row = { date: string; week: string };

const field = (r: Row, k: string) => (r as unknown as Record<string, unknown>)[k];

export type Aggregate<K extends string> = Record<K, number | null> & {
  missing: Record<K, number>;
};

export function sum<K extends string>(rows: Row[], keys: readonly K[]): Aggregate<K> {
  const result = {} as Aggregate<K>;
  const missing = {} as Record<K, number>;
  for (const k of keys) {
    const known = rows.filter((r) => Number.isSafeInteger(field(r, k)));
    result[k] = (known.length ? known.reduce<number>((n, r) => n + (field(r, k) as number), 0) : null) as Aggregate<K>[K];
    missing[k] = rows.length - known.length;
  }
  result.missing = missing;
  return result;
}

export function ratio(num: number | null, den: number | null) {
  return num !== null && den ? num / den : null;
}

export function pct(v: number | null) {
  return v === null ? 'Sem base' : `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

export type GroupMode = 'daily' | 'weekly' | 'monthly';

export function bucket(r: Row, mode: GroupMode, calendar: CommercialPeriod[]) {
  if (mode === 'daily') return r.date;
  const p = periodFor(r.date, calendar);
  if (mode === 'weekly') return `${p ? p.id.slice(0, 4) : ''} · ${r.week}`;
  return p ? p.id : r.date;
}

export type Group<R, K extends string> = Aggregate<K> & { name: string; items: R[] };

export function groupBy<R extends Row, K extends string>(rows: R[], keys: readonly K[], key: (r: R) => string): Group<R, K>[] {
  const m = new Map<string, R[]>();
  for (const r of rows) {
    const k = key(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  }
  return [...m].map(([name, items]) => ({ name, items, ...sum(items, keys) }));
}

export function metricValue<K extends string>(agg: Aggregate<K>, k: K) {
  const v = agg[k];
  if (v === null) return '—';
  const formatted = v.toLocaleString('pt-BR');
  return agg.missing?.[k] ? `${formatted} *` : formatted;
}

// Período imediatamente anterior com a mesma quantidade de dias.
export function previousRange(from: string, to: string) {
  const day = 86400000;
  const start = Date.parse(from);
  const end = Date.parse(to);
  const len = end - start + day;
  return {
    from: new Date(start - len).toISOString().slice(0, 10),
    to: new Date(start - day).toISOString().slice(0, 10),
  };
}
