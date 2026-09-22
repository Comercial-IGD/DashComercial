import { DEFAULT_CALENDAR } from './calendar';
import type { AttendanceStatus, DailyRow, DashboardData, RosterEntry, SdrRow, SyncIssue } from './types';

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

  const src = 'FL - EXEMPLO - TIME - 2026';
  const issues: SyncIssue[] = [
    { kind: 'regra', source: src, seller: 'Heitor Souza', sellerCode: 'DEMOS1', leader: leader(1), date: '03/09/2026', sheetDate: '2026-09-03', field: 'Compareceram', sheetValue: '5', expected: '≤ 3 (Agendados para hoje)', url: 'https://docs.google.com/spreadsheets', reason: 'Compareceram = 5, mas Agendados para hoje = 3.' },
    { kind: 'regra', source: src, seller: 'Heitor Souza', sellerCode: 'DEMOS1', leader: leader(1), date: '08/09/2026', sheetDate: '2026-09-08', field: 'Atenderam', sheetValue: '70', expected: '≤ 64 (Ligações realizadas)', reason: 'Atenderam = 70, mas Ligações realizadas = 64.' },
    { kind: 'valor_invalido', source: src, seller: 'Gabriela Nunes', sellerCode: 'DEMOS0', leader: leader(0), date: '10/09/2026', sheetDate: '2026-09-10', field: 'Atenderam', sheetValue: '´8', expected: 'Número inteiro ≥ 0', reason: 'Atenderam = "´8" não é um número válido.' },
    { kind: 'ausencia_planilha', source: src, seller: 'Camila Rocha', sellerCode: 'DEMO2', leader: leader(2), date: '04/09/2026', sheetDate: '2026-09-04', sheetValue: 'feriado', reason: 'A planilha indica "feriado"; registrar no RH.' },
    { kind: 'divergencia', source: `${src} × FL - OUTRO - SDR`, seller: 'Isabela Prado', sellerCode: 'DEMOS2', leader: leader(2), date: '05/09/2026', sheetDate: '2026-09-05', field: 'Agendados para o dia', sheetValue: 'Agendados para o dia: 1 (OUTRO) × 4 (EXEMPLO)', expected: 'Valor da planilha de EXEMPLO (líder atual)', reason: 'Lançamento diferente entre planilhas.' },
    { kind: 'renomear_aba', source: src, seller: 'João Ribeiro', sellerCode: 'DEMOS3', leader: leader(3), date: 'Aba', field: 'Nome da aba', sheetValue: 'João Ribeiro - SDR', expected: 'João Ribeiro - V1300', reason: 'Aba sem código de vendedor.' },
  ];

  return { rows, sdrRows, roster, statuses, calendar: DEFAULT_CALENDAR, issues };
}
