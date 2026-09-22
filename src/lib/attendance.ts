import type { AttendanceStatus } from './types';

// Índice sellerCode → (data → status) com cada dia dos períodos marcados pelo RH.
export function absenceIndex(statuses: AttendanceStatus[]) {
  const index = new Map<string, Map<string, AttendanceStatus>>();
  for (const s of statuses) {
    if (!index.has(s.sellerCode)) index.set(s.sellerCode, new Map());
    const days = index.get(s.sellerCode)!;
    for (let t = Date.parse(s.start); t <= Date.parse(s.end); t += 86400000) {
      days.set(new Date(t).toISOString().slice(0, 10), s);
    }
  }
  return index;
}

export type AbsenceIndex = ReturnType<typeof absenceIndex>;

export function absencesInRange(index: AbsenceIndex, code: string, from?: string, to?: string) {
  const days = index.get(code);
  if (!days) return [];
  return [...days].filter(([d]) => (!from || d >= from) && (!to || d <= to)).map(([date, status]) => ({ date, status }));
}

// Dias com registro na planilha que não estão marcados como ausência.
export function workedDays(rows: { date: string; sellerId: string }[], index: AbsenceIndex) {
  return new Set(rows.filter((r) => !index.get(r.sellerId)?.has(r.date)).map((r) => `${r.sellerId}|${r.date}`)).size;
}
