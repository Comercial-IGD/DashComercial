import { NextRequest, NextResponse } from 'next/server';
import { fetchRoster, fetchSource, SOURCES, type RosterPerson } from '@/lib/googleSheets';
import { supabaseServer } from '@/lib/supabase/server';
import { METRIC_KEYS, METRIC_LABELS, SDR_KEYS, SDR_LABELS, SOCIAL_KEYS, SOCIAL_LABELS, type DailyRow, type SdrRow, type SocialRow, type SyncIssue } from '@/lib/types';

export const maxDuration = 60;

type AnyRow = DailyRow | SdrRow | SocialRow;
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
    const id = `${r.sellerId}|${r.date}|${r.product}`;
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
    if (empty(r) || keys.every((k) => get(r, k) === get(previous, k))) {
      // Cópias iguais: fica registrada a da planilha da própria pessoa, se houver.
      if (!empty(r) && r.origin?.ownerCode === r.sellerId) map.set(id, r);
      continue;
    }

    const person = roster.get(r.sellerId);
    const diff = keys.filter((k) => get(previous, k) !== get(r, k));
    // Prioridade: planilha da própria pessoa (líder/supervisor com time próprio), depois a do líder atual,
    // depois a mais recente (planilhas lidas na ordem de SOURCES).
    const own = (x: R) => x.origin?.ownerCode === x.sellerId;
    const winner = own(r) ? r : own(previous) ? previous : isCurrentLeaderSheet(r, person) ? r : isCurrentLeaderSheet(previous, person) ? previous : r;
    map.set(id, winner);
    issues.push({
      kind: 'legado',
      source: `${previous.source} × ${r.source}`,
      seller: r.seller,
      sellerCode: r.sellerId,
      leader: r.leader,
      date: br(r.date),
      sheetDate: r.date,
      field: diff.map((k) => labels[k]).join(', '),
      sheetValue: diff.map((k) => `${labels[k]}: ${get(previous, k) ?? '—'} (${previous.origin?.owner}) × ${get(r, k) ?? '—'} (${r.origin?.owner})`).join('; '),
      expected: `Valor da planilha de ${winner.origin?.owner}`,
      url: (winner === previous ? r : previous).origin?.url,
      reason: `Cópia antiga diverge da planilha atual. Considerado o valor da planilha de ${winner.origin?.owner}; corrigir depois.`,
    });
  }
  return { rows: [...map.values()], copies, issues };
}

// Aba antiga zerada não deve fazer a pessoa aparecer como SDR e closer no mesmo dia.
function resolveRoleOverlap(closers: DailyRow[], sdrs: SdrRow[], roster: Map<string, RosterPerson>) {
  const produced = (r: AnyRow, keys: readonly string[]) => keys.some((k) => (get(r, k) ?? 0) > 0);
  const sdrByDay = new Map(sdrs.map((r) => [`${r.sellerId}|${r.date}|${r.product}`, r]));
  const dropCloser = new Set<DailyRow>();
  const dropSdr = new Set<SdrRow>();
  const issues: SyncIssue[] = [];
  for (const c of closers) {
    const s = sdrByDay.get(`${c.sellerId}|${c.date}|${c.product}`);
    if (!s) continue;
    const cp = produced(c, METRIC_KEYS);
    const sp = produced(s, SDR_KEYS);
    if (cp && !sp) dropSdr.add(s);
    else if (sp && !cp) dropCloser.add(c);
    else if (!cp && !sp) dropSdr.add(s);
    else {
      // Produção nos dois papéis: vale o cargo atual na planilha de times.
      const isSdr = roster.get(c.sellerId)?.role === 'SDR';
      if (isSdr) dropCloser.add(c);
      else dropSdr.add(s);
      issues.push({
        kind: 'legado',
        source: `${s.source} × ${c.source}`,
        seller: c.seller,
        sellerCode: c.sellerId,
        leader: c.leader,
        date: br(c.date),
        sheetDate: c.date,
        url: s.origin?.url,
        reason: `Produção lançada como SDR e como closer no mesmo dia. Considerado como ${isSdr ? 'SDR' : 'closer'} (cargo na planilha de times); corrigir depois.`,
      });
    }
  }
  return { closers: closers.filter((r) => !dropCloser.has(r)), sdrs: sdrs.filter((r) => !dropSdr.has(r)), issues };
}

// Cron (GET) usa o CRON_SECRET.
export async function GET(request: NextRequest) {
  const secret = request.headers.get('authorization')?.replace('Bearer ', '') ?? request.nextUrl.searchParams.get('secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  }
  // ?dry=1 lê e concilia as planilhas sem gravar nada (diagnóstico).
  return runSync(request.nextUrl.searchParams.get('dry') === '1');
}

// Botão "Atualizar agora" (POST) usa a sessão de um usuário liberado no dash.
export async function POST(request: NextRequest) {
  const token = request.headers.get('authorization')?.replace('Bearer ', '');
  const db = supabaseServer();
  const { data } = token ? await db.auth.getUser(token) : { data: { user: null } };
  const { data: allowed } = data.user ? await db.from('app_users').select('role').eq('user_id', data.user.id).maybeSingle() : { data: null };
  if (!allowed) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  // A cota do Google Sheets é de 60 leituras/min e cada sync faz ~40: cliques seguidos reaproveitam a última leitura.
  const { data: last } = await db.from('sync_issues').select('synced_at').order('synced_at', { ascending: false }).limit(1).maybeSingle();
  if (last?.synced_at && Date.now() - Date.parse(last.synced_at) < 120000) {
    return NextResponse.json({ ok: true, skipped: true, syncedAt: last.synced_at });
  }
  return runSync();
}

async function runSync(dry = false) {
  try {
    const roster = await fetchRoster();
    const byCode = new Map(roster.filter((p) => p.code).map((p) => [p.code, p]));
    const settled = await Promise.allSettled(SOURCES.map((s) => fetchSource(s, roster)));
    const failures = settled.flatMap((s) => (s.status === 'rejected' ? [s.reason instanceof Error ? s.reason.message : String(s.reason)] : []));
    if (failures.length) throw new Error(failures.join(' | '));
    const results = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));

    const closerRec = reconcile(results.flatMap((r) => r.closerRows), METRIC_KEYS, METRIC_LABELS, byCode);
    const sdrRec = reconcile(results.flatMap((r) => r.sdrRows), SDR_KEYS, SDR_LABELS, byCode);
    const socialRec = reconcile(results.flatMap((r) => r.socialRows), SOCIAL_KEYS, SOCIAL_LABELS, byCode);
    const overlap = resolveRoleOverlap(closerRec.rows, sdrRec.rows, byCode);
    // Erros de linha numa cópia que perdeu a conciliação (ex.: planilha do líder anterior) não afetam os totais.
    const keptUrls = new Set([...overlap.closers, ...overlap.sdrs, ...socialRec.rows].map((r) => r.origin?.url));
    const keptDays = new Set([...overlap.closers, ...overlap.sdrs, ...socialRec.rows].map((r) => `${r.sellerId}|${r.date}`));
    const rowKinds = new Set(['regra', 'valor_invalido', 'ajuste']);
    const sourceIssues = results
      .flatMap((r) => r.issues)
      .filter((i) => !(rowKinds.has(i.kind) && i.sheetDate && keptDays.has(`${i.sellerCode}|${i.sheetDate}`) && !keptUrls.has(i.url)));
    const allIssues = [...sourceIssues, ...closerRec.issues, ...sdrRec.issues, ...socialRec.issues, ...overlap.issues];
    const summary = () => {
      const byKind: Record<string, number> = {};
      allIssues.forEach((i) => (byKind[i.kind] = (byKind[i.kind] || 0) + 1));
      return {
        closerRows: overlap.closers.length,
        sdrRows: overlap.sdrs.length,
        socialRows: socialRec.rows.length,
        // closers/SDR/social por produto
        byProduct: Object.fromEntries(
          ['FL', 'INSIDER'].map((p) => [p, [overlap.closers, overlap.sdrs, socialRec.rows].map((rows) => rows.filter((r) => r.product === p).length).join('/')]),
        ),
        copiesReconciled: closerRec.copies + sdrRec.copies + socialRec.copies,
        issues: allIssues.length,
        byKind,
      };
    };
    const now = new Date().toISOString();
    if (dry) {
      const bySource = results.map((r) => ({
        source: r.source,
        closer: r.closerRows.length,
        sdr: r.sdrRows.length,
        social: r.socialRows.length,
        products: [...new Set([...r.closerRows, ...r.sdrRows, ...r.socialRows].map((x) => x.product))].join(','),
      }));
      const count = (keys: string[]) => keys.reduce<Record<string, number>>((m, k) => ((m[k] = (m[k] || 0) + 1), m), {});
      const samples = {
        invalid: count(allIssues.filter((i) => i.kind === 'valor_invalido').map((i) => `${i.sheetValue} · ${i.seller} · ${i.source}`)),
        flSdrNonFl: count(overlap.sdrs.filter((r) => r.product === 'FL' && byCode.get(r.sellerId)?.product !== 'FL').map((r) => `${r.seller} (${byCode.get(r.sellerId)?.product}) · ${r.source}`)),
        flCloserNonFl: count(overlap.closers.filter((r) => r.product === 'FL' && byCode.get(r.sellerId)?.product !== 'FL').map((r) => `${r.seller} (${byCode.get(r.sellerId)?.product}) · ${r.source}`)),
        insiderNonInsider: count([...overlap.closers, ...overlap.sdrs].filter((r) => r.product === 'INSIDER' && byCode.get(r.sellerId)?.product !== 'INSIDER').map((r) => `${r.seller} (${byCode.get(r.sellerId)?.product}) · ${r.source}`)),
      };
      return NextResponse.json({ ok: true, dry: true, ...summary(), bySource, samples });
    }
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
      'seller_code,date,product',
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
      'seller_code,date,product',
    );
    await insertChunks(
      'social_daily_metrics',
      socialRec.rows.map((r) => ({
        ...base(r),
        abordados: r.abordados,
        responderam: r.responderam,
        agendamentos_criados: r.agendamentosCriados,
        agendados_hoje: r.agendadosHoje,
        calls: r.calls,
        headcounts: r.headcounts,
      })),
      'seller_code,date,product',
    );

    // Dias que deixaram de valer na planilha (ex.: viraram ausência ou aba zerada) saem do banco.
    for (const table of ['daily_metrics', 'sdr_daily_metrics', 'social_daily_metrics']) {
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

    return NextResponse.json({ ok: true, ...summary(), syncedAt: now });
  } catch (e) {
    const message = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String(e.message) : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
