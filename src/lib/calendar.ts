import type { CommercialPeriod } from './types';

// Calendário comercial 2026 (mesma regra de fechamento do coletor original).
export const DEFAULT_CALENDAR: CommercialPeriod[] = [
  { id: '2026-01', name: 'Janeiro 2026', start: '2025-12-31', end: '2026-01-27' },
  { id: '2026-02', name: 'Fevereiro 2026', start: '2026-01-28', end: '2026-02-24' },
  { id: '2026-03', name: 'Março 2026', start: '2026-02-25', end: '2026-03-31' },
  { id: '2026-04', name: 'Abril 2026', start: '2026-04-01', end: '2026-04-28' },
  { id: '2026-05', name: 'Maio 2026', start: '2026-04-29', end: '2026-05-26' },
  { id: '2026-06', name: 'Junho 2026', start: '2026-05-27', end: '2026-06-30' },
  { id: '2026-07', name: 'Julho 2026', start: '2026-07-01', end: '2026-07-28' },
  { id: '2026-08', name: 'Agosto 2026', start: '2026-07-29', end: '2026-08-25' },
  { id: '2026-09', name: 'Setembro 2026', start: '2026-08-26', end: '2026-09-29' },
  { id: '2026-10', name: 'Outubro 2026', start: '2026-09-30', end: '2026-10-27' },
  { id: '2026-11', name: 'Novembro 2026', start: '2026-10-28', end: '2026-11-24' },
  { id: '2026-12', name: 'Dezembro 2026', start: '2026-11-25', end: '2026-12-29' },
];

export function periodFor(date: string, calendar: CommercialPeriod[] = DEFAULT_CALENDAR) {
  return calendar.find((p) => date >= p.start && date <= p.end);
}

export function labelPeriod(id: string, calendar: CommercialPeriod[] = DEFAULT_CALENDAR) {
  const found = calendar.find((m) => m.id === id);
  if (found) return found.name;
  if (/^\d{4}-\d{2}-\d{2}$/.test(id)) return id.split('-').reverse().join('/');
  return id;
}
