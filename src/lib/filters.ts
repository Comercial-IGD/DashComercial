import { periodFor } from './calendar';
import type { CommercialPeriod } from './types';

export interface Filters {
  product: string;
  team: string;
  leader: string;
  month: string;
  week: string;
  person: string;
  weekday: string;
  from: string;
  to: string;
}

export const EMPTY_FILTERS: Filters = { product: '', team: '', leader: '', month: '', week: '', person: '', weekday: '', from: '', to: '' };

type Filterable = { date: string; week: string; team: string; leader: string; sellerId: string; product: string };

// Intervalo de datas efetivo da seleção (usado para comparação com o período anterior).
export function selectedRange(f: Filters, calendar: CommercialPeriod[]) {
  const month = calendar.find((m) => m.id === f.month);
  const from = [f.from, month?.start].filter(Boolean).sort().at(-1);
  const to = [f.to, month?.end].filter(Boolean).sort()[0];
  return from && to ? { from, to } : null;
}

export type FacetKey = 'product' | 'team' | 'leader' | 'person' | 'month' | 'week';

export interface FacetOption {
  value: string;
  label: string;
  people: number;
}

type Facetable = Filterable & { seller: string };

// Cascata em sentido único: cada filtro só é restringido pelos que estão acima dele
// (Produto → Time → Líder → Pessoa; Mês → Semana) e pelo período escolhido.
const UPSTREAM: Record<FacetKey, (keyof Filters)[]> = {
  product: [],
  team: ['product'],
  leader: ['product', 'team'],
  person: ['product', 'team', 'leader'],
  month: [],
  week: ['month'],
};
const PERIOD: (keyof Filters)[] = ['month', 'week', 'from', 'to', 'weekday'];

export function facetOptions<R extends Facetable>(rows: R[], f: Filters, calendar: CommercialPeriod[], key: FacetKey): FacetOption[] {
  const isPeriod = key === 'month' || key === 'week';
  const keep = new Set<keyof Filters>([...UPSTREAM[key], ...(isPeriod ? ['product', 'team', 'leader', 'person'] as (keyof Filters)[] : PERIOD)]);
  keep.delete(key);
  const scope = Object.fromEntries(Object.keys(EMPTY_FILTERS).map((k) => [k, keep.has(k as keyof Filters) ? f[k as keyof Filters] : ''])) as unknown as Filters;
  const scoped = applyFilters(rows, scope, calendar);
  const groups = new Map<string, { label: string; people: Set<string> }>();
  for (const r of scoped) {
    const value = key === 'person' ? r.sellerId : key === 'month' ? (periodFor(r.date, calendar)?.id ?? '') : r[key];
    if (!value) continue;
    const label = key === 'person' ? r.seller : key === 'month' ? (calendar.find((m) => m.id === value)?.name ?? value) : value;
    if (!groups.has(value)) groups.set(value, { label, people: new Set() });
    groups.get(value)!.people.add(r.sellerId);
  }
  const opts = [...groups].map(([value, g]) => ({ value, label: g.label, people: g.people.size }));
  return key === 'month' || key === 'week' ? opts.sort((a, b) => a.value.localeCompare(b.value)) : opts.sort((a, b) => a.label.localeCompare(b.label));
}

// Remove escolhas que deixaram de existir depois de outra mudança (ex.: pessoa de outro time).
export function cascade<R extends Facetable>(rows: R[], next: Filters, calendar: CommercialPeriod[], changed: keyof Filters): Filters {
  const out = { ...next };
  const keys: FacetKey[] = ['product', 'team', 'leader', 'person', 'month', 'week'];
  const affected = new Set<keyof Filters>([changed]);
  for (let pass = 0; pass < 3; pass++) {
    let dirty = false;
    for (const k of keys) {
      if (k === changed || !out[k] || !UPSTREAM[k].some((u) => affected.has(u))) continue;
      if (!facetOptions(rows, out, calendar, k).some((o) => o.value === out[k])) {
        out[k] = '';
        affected.add(k);
        dirty = true;
      }
    }
    if (!dirty) break;
  }
  return out;
}

export function applyFilters<R extends Filterable>(rows: R[], f: Filters, calendar: CommercialPeriod[], range?: { from: string; to: string }) {
  return rows.filter(
    (r) =>
      (!f.product || r.product === f.product) &&
      (!f.team || r.team === f.team) &&
      (!f.leader || r.leader === f.leader) &&
      (!f.person || r.sellerId === f.person) &&
      (!f.weekday || String(new Date(r.date).getUTCDay()) === f.weekday) &&
      (range
        ? r.date >= range.from && r.date <= range.to
        : (!f.month || periodFor(r.date, calendar)?.id === f.month) &&
          (!f.week || r.week === f.week) &&
          (!f.from || r.date >= f.from) &&
          (!f.to || r.date <= f.to)),
  );
}
