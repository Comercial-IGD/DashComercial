'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabaseBrowser } from './supabase/client';
import { DEFAULT_CALENDAR } from './calendar';
import type { AttendanceStatus, DailyRow, DashboardData, RosterEntry, SdrRow } from './types';

const PAGE = 1000;

type DbRow = Record<string, unknown>;

async function fetchAll(table: string, order: string): Promise<DbRow[]> {
  const sb = supabaseBrowser();
  const out: DbRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from(table).select('*').order(order).order('id').range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < PAGE) return out;
  }
}

const baseRow = (r: DbRow) => ({
  date: r.date as string,
  seller: r.seller_name as string,
  code: r.seller_code as string,
  sellerId: r.seller_code as string,
  source: r.source as string,
  leader: r.leader as string,
  team: r.team as string,
  week: r.week as string,
  status: r.status as string,
  product: (r.product as string) || 'FL',
});

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

const EMPTY: DashboardData = { rows: [], sdrRows: [], roster: [], statuses: [], calendar: DEFAULT_CALENDAR, issues: [] };

export function useDashboardData(enabled: boolean) {
  const [data, setData] = useState<DashboardData>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sb = supabaseBrowser();
      const [metrics, sdr, statuses, calendarRes, issuesRes, rosterRes] = await Promise.all([
        fetchAll('daily_metrics', 'date'),
        fetchAll('sdr_daily_metrics', 'date'),
        fetchAll('attendance_status', 'start_date'),
        sb.from('commercial_calendar').select('*').order('start_date'),
        sb.from('sync_issues').select('*').order('id').limit(2000),
        sb.from('roster').select('*').order('seller_name'),
      ]);

      const rows: DailyRow[] = metrics.map((r) => ({
        type: 'daily',
        ...baseRow(r),
        agendas: num(r.agendas),
        agendados: num(r.agendados),
        confirmados: num(r.confirmados),
        calls: num(r.calls),
        solicitadas: num(r.solicitadas),
        atendidas: num(r.atendidas),
        comVenda: num(r.com_venda),
        headcounts: num(r.headcounts),
      }));

      const sdrRows: SdrRow[] = sdr.map((r) => ({
        type: 'sdr',
        ...baseRow(r),
        ligacoes: num(r.ligacoes),
        atenderam: num(r.atenderam),
        agendasCriadas: num(r.agendas_criadas),
        agendadosHoje: num(r.agendados_hoje),
        compareceram: num(r.compareceram),
        headcounts: num(r.headcounts),
      }));

      const roster: RosterEntry[] = (rosterRes.data || []).map((p) => ({
        code: p.code,
        seller: p.seller_name,
        team: p.team,
        leader: p.leader_name,
        role: p.role,
        product: p.product || 'FL',
      }));

      setData({
        rows,
        sdrRows,
        roster,
        statuses: statuses.map(
          (s): AttendanceStatus => ({
            id: s.id as number,
            sellerCode: s.seller_code as string,
            start: s.start_date as string,
            end: s.end_date as string,
            reason: s.reason as AttendanceStatus['reason'],
            note: (s.note as string) ?? null,
          }),
        ),
        calendar: calendarRes.data?.length
          ? calendarRes.data.map((p) => ({ id: p.id, name: p.name, start: p.start_date, end: p.end_date }))
          : DEFAULT_CALENDAR,
        issues: (issuesRes.data || []).map((i) => ({ source: i.source, seller: i.seller, date: i.ref_date, reason: i.reason })),
      });
      setLoadedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String(e.message) : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial ao entrar
    load();
    const interval = setInterval(() => {
      if (!document.hidden) load();
    }, 300000);
    return () => clearInterval(interval);
  }, [enabled, load]);

  return { data, setData, loading, error, loadedAt, reload: load };
}
