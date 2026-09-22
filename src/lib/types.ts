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

export const SDR_KEYS = ['ligacoes', 'atenderam', 'agendasCriadas', 'agendadosHoje', 'compareceram', 'headcounts'] as const;

export type SdrKey = (typeof SDR_KEYS)[number];

export const SDR_LABELS: Record<SdrKey, string> = {
  ligacoes: 'Ligações realizadas',
  atenderam: 'Atenderam',
  agendasCriadas: 'Agendas criadas',
  agendadosHoje: 'Agendados para o dia',
  compareceram: 'Compareceram',
  headcounts: 'Headcounts',
};

interface BaseRow {
  date: string; // yyyy-mm-dd
  seller: string;
  code: string;
  sellerId: string;
  source: string;
  leader: string;
  team: string;
  week: string;
  status: string;
  product: string;
}

export interface DailyRow extends BaseRow, Record<MetricKey, number | null> {
  type: 'daily';
}

export interface SdrRow extends BaseRow, Record<SdrKey, number | null> {
  type: 'sdr';
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

export const ABSENCE_REASONS = {
  day_off: 'Day off',
  problema_internet: 'Problema de internet',
  problema_energia: 'Problema de energia',
  atestado: 'Atestado',
  ferias: 'Férias',
  falta: 'Falta',
  treinamento: 'Treinamento',
  outro: 'Outro',
} as const;

export type AbsenceReason = keyof typeof ABSENCE_REASONS;

export interface AttendanceStatus {
  id: number;
  sellerCode: string;
  start: string;
  end: string;
  reason: AbsenceReason;
  note: string | null;
}

export interface RosterEntry {
  code: string;
  seller: string;
  team: string;
  leader: string;
  role: string | null;
  product: string;
}

export interface DashboardData {
  rows: DailyRow[];
  sdrRows: SdrRow[];
  roster: RosterEntry[];
  statuses: AttendanceStatus[];
  calendar: CommercialPeriod[];
  issues: SyncIssue[];
}
