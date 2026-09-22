import { NextRequest, NextResponse } from 'next/server';
import { fetchRoster, fetchSource, LEADER_CODES, SOURCE_SPREADSHEETS } from '@/lib/googleSheets';
import { supabaseServer } from '@/lib/supabase/server';
import type { DailyRow, SyncIssue } from '@/lib/types';

export const maxDuration = 60;

function reconcile(rows: DailyRow[]) {
  const map = new Map<string, DailyRow>();
  const issues: SyncIssue[] = [];
  let copies = 0;
  const empty = (r: DailyRow) => ['agendas', 'agendados', 'confirmados', 'calls', 'solicitadas', 'atendidas', 'comVenda', 'headcounts'].every((k) => (r as unknown as Record<string, number>)[k] === 0);

  for (const r of rows) {
    const id = `${r.sellerId}|${r.date}`;
    const previous = map.get(id);
    if (!previous) {
      map.set(id, r);
      continue;
    }
    if (empty(previous) && !empty(r)) {
      map.set(id, r);
      copies++;
      continue;
    }
    if (empty(r)) {
      copies++;
      continue;
    }
    const keys = ['agendas', 'agendados', 'confirmados', 'calls', 'solicitadas', 'atendidas', 'comVenda', 'headcounts'] as const;
    if (keys.every((k) => r[k] === previous[k])) {
      copies++;
      continue;
    }
    const conflict: DailyRow = { ...previous };
    keys.forEach((k) => {
      if (previous[k] !== r[k]) (conflict as unknown as Record<string, number | null>)[k] = null;
    });
    map.set(id, conflict);
    issues.push({
      source: conflict.source,
      seller: r.seller,
      date: r.date,
      reason: 'Cópias divergentes entre origens. Valores conflitantes não informados; registro contado uma única vez.',
    });
  }
  return { rows: [...map.values()], copies, issues };
}

export async function GET(request: NextRequest) {
  const secret = request.headers.get('authorization')?.replace('Bearer ', '') ?? request.nextUrl.searchParams.get('secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  }

  try {
    const roster = await fetchRoster();
    const results = [];
    const failures: string[] = [];
    for (let i = 0; i < SOURCE_SPREADSHEETS.length; i++) {
      try {
        results.push(await fetchSource(i, roster));
      } catch (e) {
        failures.push(e instanceof Error ? e.message : String(e));
      }
    }
    if (failures.length) throw new Error(failures.join(' | '));

    const merged = reconcile(results.flatMap((r) => r.rows));
    const allIssues = [...results.flatMap((r) => r.issues), ...merged.issues];

    const db = supabaseServer();

    const rosterRows = roster.map((p) => ({
      code: p.code,
      seller_name: p.seller,
      team: p.team,
      leader_code: p.leaderCode,
      leader_name: p.leader,
      active: true,
      updated_at: new Date().toISOString(),
    }));
    if (rosterRows.length) {
      const { error } = await db.from('roster').upsert(rosterRows, { onConflict: 'code' });
      if (error) throw error;
    }

    const metricRows = merged.rows.map((r) => ({
      date: r.date,
      seller_code: r.sellerId,
      seller_name: r.seller,
      team: r.team,
      leader: r.leader,
      source: r.source,
      week: r.week,
      status: r.status,
      agendas: r.agendas,
      agendados: r.agendados,
      confirmados: r.confirmados,
      calls: r.calls,
      solicitadas: r.solicitadas,
      atendidas: r.atendidas,
      com_venda: r.comVenda,
      headcounts: r.headcounts,
      synced_at: new Date().toISOString(),
    }));
    if (metricRows.length) {
      const { error } = await db.from('daily_metrics').upsert(metricRows, { onConflict: 'seller_code,date' });
      if (error) throw error;
    }

    await db.from('sync_issues').delete().neq('id', 0);
    if (allIssues.length) {
      const { error } = await db.from('sync_issues').insert(
        allIssues.map((issue) => ({
          source: issue.source,
          seller: issue.seller,
          ref_date: issue.date,
          reason: issue.reason,
        })),
      );
      if (error) throw error;
    }

    return NextResponse.json({
      ok: true,
      rows: metricRows.length,
      leaders: LEADER_CODES.length,
      copiesReconciled: merged.copies,
      issues: allIssues.length,
      syncedAt: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
