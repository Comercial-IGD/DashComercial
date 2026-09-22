'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabaseBrowser } from './supabase/client';
import { DEFAULT_CALENDAR } from './calendar';
import type { DailyRow, DashboardData, SyncIssue } from './types';

export function useDashboardData() {
  const [data, setData] = useState<DashboardData>({ rows: [], calendar: DEFAULT_CALENDAR, issues: [], collectedAt: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sb = supabaseBrowser();
      const [metricsRes, calendarRes, issuesRes] = await Promise.all([
        sb.from('daily_metrics').select('*').order('date', { ascending: true }),
        sb.from('commercial_calendar').select('*').order('start_date', { ascending: true }),
        sb.from('sync_issues').select('*').order('synced_at', { ascending: false }),
      ]);
      if (metricsRes.error) throw metricsRes.error;

      const rows: DailyRow[] = (metricsRes.data || []).map((r) => ({
        type: 'daily',
        date: r.date,
        seller: r.seller_name,
        code: r.seller_code,
        sellerId: r.seller_code,
        source: r.source,
        leader: r.leader,
        team: r.team,
        week: r.week,
        status: r.status,
        agendas: r.agendas,
        agendados: r.agendados,
        confirmados: r.confirmados,
        calls: r.calls,
        solicitadas: r.solicitadas,
        atendidas: r.atendidas,
        comVenda: r.com_venda,
        headcounts: r.headcounts,
      }));

      const calendar = calendarRes.data?.length
        ? calendarRes.data.map((p) => ({ id: p.id, name: p.name, start: p.start_date, end: p.end_date }))
        : DEFAULT_CALENDAR;

      const issues: SyncIssue[] = (issuesRes.data || []).map((i) => ({
        source: i.source,
        seller: i.seller,
        date: i.ref_date,
        reason: i.reason,
      }));

      setData({
        rows,
        calendar,
        issues,
        collectedAt: rows.length ? new Date().toISOString() : null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial dos dados do Supabase
    load();
    const interval = setInterval(() => {
      if (!document.hidden) load();
    }, 300000);
    const onVisible = () => {
      if (!document.hidden) load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  return { data, loading, error, reload: load };
}
