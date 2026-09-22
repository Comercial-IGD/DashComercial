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
