export const METRIC_KEYS = [
  'agendas',
  'agendados',
  'confirmados',
  'calls',
  'solicitadas',
  'atendidas',
  'comVenda',
  'headcounts',
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];

export const METRIC_LABELS: Record<MetricKey, string> = {
  agendas: 'Agendas disponíveis',
  agendados: 'Agendados',
  confirmados: 'Confirmados',
  calls: 'Calls realizadas',
  solicitadas: 'Levantadas solicitadas',
  atendidas: 'Levantadas atendidas',
  comVenda: 'Levantadas com venda',
  headcounts: 'Headcounts',
};

export interface DailyRow {
  type: 'daily';
  date: string; // yyyy-mm-dd
  seller: string;
  code: string;
  sellerId: string;
  source: string;
  leader: string;
  team: string;
  week: string;
  status: string;
  agendas: number | null;
  agendados: number | null;
  confirmados: number | null;
  calls: number | null;
  solicitadas: number | null;
  atendidas: number | null;
  comVenda: number | null;
  headcounts: number | null;
}

export interface CommercialPeriod {
  id: string;
  name: string;
  start: string;
  end: string;
}

export interface SyncIssue {
  source: string;
  seller: string;
  date: string;
  reason: string;
}

export interface DashboardData {
  rows: DailyRow[];
  calendar: CommercialPeriod[];
  issues: SyncIssue[];
  collectedAt: string | null;
}
