import { NextRequest, NextResponse } from 'next/server';
import { fetchRoster, fetchSource, SOURCES } from '@/lib/googleSheets';
import { supabaseServer } from '@/lib/supabase/server';
import { METRIC_KEYS, SDR_KEYS, type DailyRow, type SdrRow, type SyncIssue } from '@/lib/types';

export const maxDuration = 60;

// Uma mesma pessoa/data pode aparecer em mais de uma planilha: cópias idênticas ou zeradas
// são descartadas; cópias divergentes viram "não informado" nos campos conflitantes.
function reconcile<R extends DailyRow | SdrRow>(rows: R[], keys: readonly string[]) {
  const get = (r: R, k: string) => (r as unknown as Record<string, number | null>)[k];
  const map = new Map<string, R>();
  const issues: SyncIssue[] = [];
  let copies = 0;
  const empty = (r: R) => keys.every((k) => get(r, k) === 0);

  for (const r of rows) {
    const id = `${r.sellerId}|${r.date}`;
    const previous = map.get(id);
    if (!previous) {
      map.set(id, r);
      continue;
    }
    copies++;
    if (empty(previous) && !empty(r)) {
      map.set(id, r);
      continue;
    }
    if (empty(r) || keys.every((k) => get(r, k) === get(previous, k))) continue;
    const conflict = { ...previous } as R;
    keys.forEach((k) => {
      if (get(previous, k) !== get(r, k)) (conflict as unknown as Record<string, number | null>)[k] = null;
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
    const settled = await Promise.allSettled(SOURCES.map((s) => fetchSource(s, roster)));
    const failures = settled.flatMap((s) => (s.status === 'rejected' ? [s.reason instanceof Error ? s.reason.message : String(s.reason)] : []));
    if (failures.length) throw new Error(failures.join(' | '));
    const results = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));

    const closers = reconcile(results.flatMap((r) => r.closerRows), METRIC_KEYS);
    const sdrs = reconcile(results.flatMap((r) => r.sdrRows), SDR_KEYS);
    const allIssues = [...results.flatMap((r) => r.issues), ...closers.issues, ...sdrs.issues];
    const now = new Date().toISOString();
    const db = supabaseServer();

    const { error: rosterError } = await db.from('roster').upsert(
      roster.map((p) => ({
        code: p.code,
        seller_name: p.seller,
        team: p.team,
        leader_code: p.leaderCode,
        leader_name: p.leader,
        role: p.role,
        product: p.product,
        active: true,
        updated_at: now,
      })),
      { onConflict: 'code' },
    );
    if (rosterError) throw rosterError;

    const base = (r: DailyRow | SdrRow) => ({
      date: r.date,
      seller_code: r.sellerId,
      seller_name: r.seller,
      team: r.team,
      leader: r.leader,
      source: r.source,
      week: r.week,
      status: r.status,
      product: r.product,
      synced_at: now,
    });

    if (closers.rows.length) {
      const { error } = await db.from('daily_metrics').upsert(
        closers.rows.map((r) => ({
          ...base(r),
          agendas: r.agendas,
          agendados: r.agendados,
          confirmados: r.confirmados,
          calls: r.calls,
          solicitadas: r.solicitadas,
          atendidas: r.atendidas,
          com_venda: r.comVenda,
          headcounts: r.headcounts,
        })),
        { onConflict: 'seller_code,date' },
      );
      if (error) throw error;
    }

    if (sdrs.rows.length) {
      const { error } = await db.from('sdr_daily_metrics').upsert(
        sdrs.rows.map((r) => ({
          ...base(r),
          ligacoes: r.ligacoes,
          atenderam: r.atenderam,
          agendas_criadas: r.agendasCriadas,
          agendados_hoje: r.agendadosHoje,
          compareceram: r.compareceram,
          headcounts: r.headcounts,
        })),
        { onConflict: 'seller_code,date' },
      );
      if (error) throw error;
    }

    const { error: clearError } = await db.from('sync_issues').delete().gte('id', 0);
    if (clearError) throw clearError;
    if (allIssues.length) {
      const { error } = await db
        .from('sync_issues')
        .insert(allIssues.map((i) => ({ source: i.source, seller: i.seller, ref_date: i.date, reason: i.reason, synced_at: now })));
      if (error) throw error;
    }

    return NextResponse.json({
      ok: true,
      closerRows: closers.rows.length,
      sdrRows: sdrs.rows.length,
      copiesReconciled: closers.copies + sdrs.copies,
      issues: allIssues.length,
      syncedAt: now,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String(e.message) : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
