import { DEFAULT_CALENDAR } from './calendar';
import type { AttendanceStatus, DailyRow, DashboardData, RosterEntry, SdrRow } from './types';

const CLOSERS = ['Ana Martins', 'Bruno Lima', 'Camila Rocha', 'Diego Alves', 'Elisa Costa', 'Felipe Dias'];
const SDRS = ['Gabriela Nunes', 'Heitor Souza', 'Isabela Prado', 'João Ribeiro'];
const team = (i: number) => (i % 2 === 0 ? 'Equipe Horizonte' : 'Equipe Aurora');
const leader = (i: number) => (i % 2 === 0 ? 'Marina • exemplo' : 'Rafael • exemplo');

export function buildDemoData(): DashboardData {
  const rows: DailyRow[] = [];
  const sdrRows: SdrRow[] = [];
  const base = (seller: string, code: string, i: number, date: string, d: number) => ({
    date,
    seller,
    code,
    sellerId: code,
    source: 'Demonstração',
    leader: leader(i),
    team: team(i),
    week: `SEMANA ${String(31 + Math.floor(d / 7)).padStart(2, '0')}`,
    status: 'Ativo',
    product: 'FL',
  });

  for (let d = 0; d < 70; d++) {
    const dt = new Date(Date.UTC(2026, 6, 29 + d));
    if (dt.getUTCDay() === 0) continue;
    const date = dt.toISOString().slice(0, 10);
    CLOSERS.forEach((seller, i) => {
      if (i === 3 && d % 11 === 0) return;
      const calls = 3 + ((d * 3 + i * 7) % 9);
      const atendidas = (d + i) % 5;
      rows.push({
        type: 'daily',
        ...base(seller, `DEMO${i}`, i, date, d),
        agendas: 14,
        agendados: calls + 2,
        confirmados: calls + 1,
        calls,
        solicitadas: atendidas + 1,
        atendidas,
        comVenda: Math.floor(atendidas / 2),
        headcounts: (d + i * 2) % 7,
      });
    });
    SDRS.forEach((seller, i) => {
      // João foi SDR até metade do período e depois passou a closer.
      if (i === 3 && d >= 35) {
        const calls = 2 + (d % 6);
        rows.push({
          type: 'daily',
          ...base(seller, 'DEMOS3', i, date, d),
          agendas: 12,
          agendados: calls + 2,
          confirmados: calls + 1,
          calls,
          solicitadas: 2,
          atendidas: d % 3,
          comVenda: d % 2 ? 1 : 0,
          headcounts: d % 4,
        });
        return;
      }
      const ligacoes = 60 + ((d * 7 + i * 13) % 40);
      const atenderam = Math.round(ligacoes * (0.35 + (i % 3) * 0.05));
      const agendasCriadas = Math.round(atenderam * 0.6);
      const agendadosHoje = 4 + ((d + i) % 6);
      sdrRows.push({
        type: 'sdr',
        ...base(seller, `DEMOS${i}`, i, date, d),
        ligacoes,
        atenderam,
        agendasCriadas,
        agendadosHoje,
        compareceram: Math.max(0, agendadosHoje - 1 - ((d + i) % 3)),
        headcounts: (d + i) % 3,
      });
    });
  }

  const roster: RosterEntry[] = [
    ...CLOSERS.map((seller, i) => ({ code: `DEMO${i}`, seller, team: team(i), leader: leader(i), role: 'CLOSER', product: 'FL' })),
    ...SDRS.map((seller, i) => ({ code: `DEMOS${i}`, seller, team: team(i), leader: leader(i), role: i === 3 ? 'CLOSER' : 'SDR', product: 'FL' })),
  ];

  const statuses: AttendanceStatus[] = [
    { id: 1, sellerCode: 'DEMO3', start: '2026-08-10', end: '2026-08-12', reason: 'ferias', note: 'Exemplo' },
    { id: 2, sellerCode: 'DEMO1', start: '2026-09-02', end: '2026-09-02', reason: 'problema_internet', note: null },
    { id: 3, sellerCode: 'DEMOS1', start: '2026-09-15', end: '2026-09-15', reason: 'day_off', note: null },
  ];

  return { rows, sdrRows, roster, statuses, calendar: DEFAULT_CALENDAR, issues: [] };
}
