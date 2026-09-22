import type { DailyRow } from './types';

export function buildDemoRows(): DailyRow[] {
  const rows: DailyRow[] = [];
  const sellers = ['Ana Martins', 'Bruno Lima', 'Camila Rocha', 'Diego Alves', 'Elisa Costa', 'Felipe Dias'];
  for (let d = 0; d < 70; d++) {
    const date = new Date(Date.UTC(2026, 6, 29 + d));
    if (date.getUTCDay() === 0) continue;
    const iso = date.toISOString().slice(0, 10);
    sellers.forEach((seller, i) => {
      const calls = 3 + ((d * 3 + i * 7) % 9);
      const atendidas = (d + i) % 5;
      rows.push({
        type: 'daily',
        date: iso,
        seller,
        code: `DEMO${i}`,
        sellerId: `DEMO${i}`,
        source: i < 3 ? 'Equipe Horizonte' : 'Equipe Aurora',
        leader: i < 3 ? 'Marina • exemplo' : 'Rafael • exemplo',
        team: i < 3 ? 'Equipe Horizonte' : 'Equipe Aurora',
        week: `SEMANA ${String(31 + Math.floor(d / 7)).padStart(2, '0')}`,
        status: i === 5 ? 'Sem status' : i === 4 ? 'Inativo' : 'Ativo',
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
  }
  return rows;
}
