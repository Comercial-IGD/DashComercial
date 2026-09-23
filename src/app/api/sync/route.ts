import { NextRequest, NextResponse } from 'next/server';
import { fetchRoster, fetchSource, SOURCES, type RosterPerson } from '@/lib/googleSheets';
import { supabaseServer } from '@/lib/supabase/server';
import { METRIC_KEYS, METRIC_LABELS, SDR_KEYS, SDR_LABELS, type DailyRow, type SdrRow, type SyncIssue } from '@/lib/types';

export const maxDuration = 60;

type AnyRow = DailyRow | SdrRow;
const get = (r: AnyRow, k: string) => (r as unknown as Record<string, number | null>)[k];
const br = (d: string) => d.split('-').reverse().join('/');

// A planilha pertence ao líder atual quando o código do dono da planilha é o código do líder da pessoa no cadastro.
function isCurrentLeaderSheet(r: AnyRow, person: RosterPerson | undefined) {
  return !!person?.leaderCode && r.origin?.ownerCode === person.leaderCode;
}

// Troca de time duplica a aba de propósito: cópias idênticas (ou zeradas) contam uma vez.
// Cópias divergentes: prevalece a planilha do líder atual; sem ela, os campos conflitantes ficam não informados.
function reconcile<R extends AnyRow>(rows: R[], keys: readonly string[], labels: Record<string, string>, roster: Map<string, RosterPerson>) {
  const map = new Map<string, R>();
  const issues: SyncIssue[] = [];
  let copies = 0;
  const empty = (r: R) => keys.every((k) => !get(r, k));

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

    const person = roster.get(r.sellerId);
    const diff = keys.filter((k) => get(previous, k) !== get(r, k));
    const winner = isCurrentLeaderSheet(r, person) ? r : isCurrentLeaderSheet(previous, person) ? previous : null;
    let chosen: R;
    if (winner) chosen = winner;
    else {
      chosen = { ...previous };
      diff.forEach((k) => ((chosen as unknown as Record<string, number | null>)[k] = null));
    }
    map.set(id, chosen);
    issues.push({
      kind: 'divergencia',
      source: `${previous.source} × ${r.source}`,
      seller: r.seller,
      sellerCode: r.sellerId,
      leader: r.leader,
      date: br(r.date),
      sheetDate: r.date,
      field: diff.map((k) => labels[k]).join(', '),
      sheetValue: diff.map((k) => `${labels[k]}: ${get(previous, k) ?? '—'} (${previous.origin?.owner}) × ${get(r, k) ?? '—'} (${r.origin?.owner})`).join('; '),
      expected: winner ? `Valor da planilha de ${winner.origin?.owner} (líder atual)` : 'Mesmo valor nas duas planilhas',
      url: (winner === previous ? r : previous).origin?.url,
      reason: winner
        ? `Lançamento diferente entre planilhas. Considerado o valor da planilha do líder atual (${winner.origin?.owner}); corrigir a outra cópia.`
        : 'Lançamento diferente entre planilhas e nenhuma é do líder atual. Campos conflitantes não informados até a correção.',
    });
  }
  return { rows: [...map.values()], copies, issues };
}

// Aba antiga zerada não deve fazer a pessoa aparecer como SDR e closer no mesmo dia.
function resolveRoleOverlap(closers: DailyRow[], sdrs: SdrRow[]) {
  const produced = (r: AnyRow, keys: readonly string[]) => keys.some((k) => (get(r, k) ?? 0) > 0);
  const sdrByDay = new Map(sdrs.map((r) => [`${r.sellerId}|${r.date}`, r]));
  const dropCloser = new Set<DailyRow>();
  const dropSdr = new Set<SdrRow>();
  const issues: SyncIssue[] = [];
  for (const c of closers) {
    const s = sdrByDay.get(`${c.sellerId}|${c.date}`);
    if (!s) continue;
    const cp = produced(c, METRIC_KEYS);
    const sp = produced(s, SDR_KEYS);
    if (cp && !sp) dropSdr.add(s);
    else if (sp && !cp) dropCloser.add(c);
    else if (!cp && !sp) dropSdr.add(s);
    else
      issues.push({
        kind: 'papel_duplicado',
        source: `${s.source} × ${c.source}`,
        seller: c.seller,
        sellerCode: c.sellerId,
        leader: c.leader,
        date: br(c.date),
        sheetDate: c.date,
        url: s.origin?.url,
        reason: 'Há produção lançada como SDR e como closer no mesmo dia. Os dois foram considerados; validar se está correto.',
      });
  }
  return { closers: closers.filter((r) => !dropCloser.has(r)), sdrs: sdrs.filter((r) => !dropSdr.has(r)), issues };
}

export async function GET(request: NextRequest) {
  const secret = request.headers.get('authorization')?.replace('Bearer ', '') ?? request.nextUrl.searchParams.get('secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  }

  try {
    const roster = await fetchRoster();
    const byCode = new Map(roster.filter((p) => p.code).map((p) => [p.code, p]));
    const settled = await Promise.allSettled(SOURCES.map((s) => fetchSource(s, roster)));
    const failures = settled.flatMap((s) => (s.status === 'rejected' ? [s.reason instanceof Error ? s.reason.message : String(s.reason)] : []));
    if (failures.length) throw new Error(failures.join(' | '));
    const results = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));

    const closerRec = reconcile(results.flatMap((r) => r.closerRows), METRIC_KEYS, METRIC_LABELS, byCode);
    const sdrRec = reconcile(results.flatMap((r) => r.sdrRows), SDR_KEYS, SDR_LABELS, byCode);
    const overlap = resolveRoleOverlap(closerRec.rows, sdrRec.rows);
    // Erros de linha numa cópia que perdeu a conciliação (ex.: planilha do líder anterior) não afetam os totais.
    const keptUrls = new Set([...overlap.closers, ...overlap.sdrs].map((r) => r.origin?.url));
    const keptDays = new Set([...overlap.closers, ...overlap.sdrs].map((r) => `${r.sellerId}|${r.date}`));
    const rowKinds = new Set(['regra', 'valor_invalido']);
    const sourceIssues = results
      .flatMap((r) => r.issues)
      .filter((i) => !(rowKinds.has(i.kind) && i.sheetDate && keptDays.has(`${i.sellerCode}|${i.sheetDate}`) && !keptUrls.has(i.url)));
    const allIssues = [...sourceIssues, ...closerRec.issues, ...sdrRec.issues, ...overlap.issues];
    const now = new Date().toISOString();
    const db = supabaseServer();

    const { error: rosterError } = await db.from('roster').upsert(
      roster
        .filter((p) => p.code)
        .map((p) => ({
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

    const base = (r: AnyRow) => ({
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

    const insertChunks = async (table: string, rows: object[], onConflict?: string) => {
      for (let i = 0; i < rows.length; i += 1000) {
        const chunk = rows.slice(i, i + 1000);
        const { error } = onConflict ? await db.from(table).upsert(chunk, { onConflict }) : await db.from(table).insert(chunk);
        if (error) throw error;
      }
    };

    await insertChunks(
      'daily_metrics',
      overlap.closers.map((r) => ({
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
      'seller_code,date',
    );
    await insertChunks(
      'sdr_daily_metrics',
      overlap.sdrs.map((r) => ({
        ...base(r),
        ligacoes: r.ligacoes,
        atenderam: r.atenderam,
        agendas_criadas: r.agendasCriadas,
        agendados_hoje: r.agendadosHoje,
        compareceram: r.compareceram,
        headcounts: r.headcounts,
      })),
      'seller_code,date',
    );

    // Dias que deixaram de valer na planilha (ex.: viraram ausência ou aba zerada) saem do banco.
    for (const table of ['daily_metrics', 'sdr_daily_metrics']) {
      const { error } = await db.from(table).delete().lt('synced_at', now);
      if (error) throw error;
    }

    const { error: clearError } = await db.from('sync_issues').delete().gte('id', 0);
    if (clearError) throw clearError;
    await insertChunks(
      'sync_issues',
      allIssues.map((i) => ({
        kind: i.kind,
        source: i.source,
        seller: i.seller,
        seller_code: i.sellerCode ?? null,
        leader: i.leader ?? null,
        ref_date: i.date,
        sheet_date: i.sheetDate ?? null,
        field: i.field ?? null,
        sheet_value: i.sheetValue ?? null,
        expected: i.expected ?? null,
        url: i.url ?? null,
        reason: i.reason,
        synced_at: now,
      })),
    );

    const byKind: Record<string, number> = {};
    allIssues.forEach((i) => (byKind[i.kind] = (byKind[i.kind] || 0) + 1));
    return NextResponse.json({
      ok: true,
      closerRows: overlap.closers.length,
      sdrRows: overlap.sdrs.length,
      copiesReconciled: closerRec.copies + sdrRec.copies,
      issues: allIssues.length,
      byKind,
      syncedAt: now,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String(e.message) : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
