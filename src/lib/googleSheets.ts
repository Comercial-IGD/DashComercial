import 'server-only';
import { google, type sheets_v4 } from 'googleapis';
import { periodFor, DEFAULT_CALENDAR } from './calendar';
import { METRIC_KEYS, SDR_KEYS, type DailyRow, type SdrRow, type SyncIssue } from './types';

export interface SourceConfig {
  id: string;
  kind: 'leader' | 'sdr';
  leaderCode?: string;
}

// Planilhas de líder (closers + SDRs do líder) e planilhas exclusivas de SDR; leaderCode = dono da planilha.
export const SOURCES: SourceConfig[] = [
  { id: '15ZvGFI4XCrzr09Mg37XUboO9r8GpBAYSV6X6MFF5MaM', kind: 'leader', leaderCode: 'V96' },
  { id: '1fsOm6MMS-HyYnfVxZj7yAdGBxpBCWTKavKU0cOQjW7Q', kind: 'leader', leaderCode: 'V555' },
  { id: '1V9ED6pCzQrwZOEoqYh-iIb1U-HzZx6SmYfBtyIMRtt8', kind: 'leader', leaderCode: 'V820' },
  { id: '1sl6Jyd3PCUTpZnn8dN0Il6IpK1gXX2jZwCNe2fcHYlY', kind: 'leader', leaderCode: 'V1065' },
  { id: '1YLagcrWrEE7WEG56Ldgmsyfmvkdz2i8miWx3wMVyqPI', kind: 'leader', leaderCode: 'V1047' },
  { id: '18RqQooixW531m-u1Ti-2etzDkNkXInRcm3BJ6_0jK44', kind: 'leader', leaderCode: 'V990' },
  { id: '1rwf53Z2raKCl9lz4qQlZjiERQ-JkkHOEFV8NYs3GcBA', kind: 'sdr', leaderCode: 'V730' },
  { id: '13S3NA-dWgSrHi6LW-cLN2Wgqp2GrCqMZDoj3u6CDnWg', kind: 'sdr', leaderCode: 'V960' },
];

export const ACTIVE_PRODUCTS = ['FL'];
const ACTIVE_ROLES = ['CLOSER', 'SDR'];

export const ROSTER_SPREADSHEET_ID = '1uK_C5pR1p8TTMlniSKOWAISfSSVvzPuEaCb828gdTNY';
export const ROSTER_SHEET_ID = 187997157;

const CLOSER_HEADERS = ['AGENDAS DISP', 'AGENDADOS', 'CONFIRMADOS', 'COMPARECERAM', 'LEVANTADAS DE MAO SOLICITADAS', 'LEVANTADAS ATENDIDAS', 'LEVANTADA C VENDA', 'HEADCOUNTS'];
const CLOSER_FIELDS = ['Agendas disp.', 'Agendados', 'Confirmados', 'Compareceram', 'Levantadas solicitadas', 'Levantadas atendidas', 'Levantada c/ venda', 'Headcounts'];
const SDR_HEADERS = ['LIGACOES REALIZADAS', 'ATENDERAM', 'AGENDAS CRIADAS HOJE', 'AGENDADOS PARA HOJE', 'COMPARECERAM', 'HEADCOUNTS'];
const SDR_FIELDS = ['Ligações realizadas', 'Atenderam', 'Agendas criadas hoje', 'Agendados para hoje', 'Compareceram', 'Headcounts'];
const ABSENCE_WORDS = /^(FERIADO|LUTO|FOLGA|DAY ?OFF|ATESTADO|FERIAS|FALTA|AUSENTE|AFASTAD[OA]|LICENCA|DOENTE|TREINAMENTO)\b/;
const COMMERCIAL_YEAR_START = Date.UTC(2025, 11, 31);

export function norm(v: unknown) {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function nameTokens(v: string) {
  return norm(v).replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter((t) => t.length > 1);
}

function code(v: unknown) {
  const m = String(v || '').trim().match(/^V0*(\d+)$/i);
  return m ? 'V' + Number(m[1]) : '';
}

export interface RosterPerson {
  code: string;
  seller: string;
  team: string;
  leaderCode: string;
  leader: string;
  role: string;
  product: string;
}

let client: sheets_v4.Sheets | null = null;

async function sheetsClient() {
  if (client) return client;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  // Aceita a chave colada com ou sem aspas, com "\n" literal ou quebras reais.
  const key = process.env.GOOGLE_PRIVATE_KEY?.trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\\n/g, '\n')
    .replace(/\r/g, '');
  if (!email || !key) throw new Error('Credenciais da service account do Google ausentes.');
  const auth = new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  await auth.authorize();
  client = google.sheets({ version: 'v4', auth });
  return client;
}

export async function fetchRoster(): Promise<RosterPerson[]> {
  const sheets = await sheetsClient();
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: ROSTER_SPREADSHEET_ID,
    fields: 'sheets(properties(sheetId,title,gridProperties(rowCount)))',
  });
  const sheet = meta.data.sheets?.find((s) => s.properties?.sheetId === ROSTER_SHEET_ID);
  if (!sheet) throw new Error('Aba de cadastro não encontrada.');
  const title = sheet.properties!.title!.replace(/'/g, "''");
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: ROSTER_SPREADSHEET_ID,
    range: `'${title}'!A1:N${sheet.properties!.gridProperties!.rowCount}`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const values = res.data.values || [];
  const expected = ['CODIGO DO INTEGRANTE', 'NOME DO INTEGRANTE', 'PRODUTO', 'FRENTE', 'NOME DO TIME', 'CARGO', 'SENIORIDADE', 'REGIME', 'APTO PARA LEVANTADA', 'ATIVO', 'CODIGO DO LIDER', 'NOME DO LIDER', 'LIDER EM TREINAMENTO', 'SUPERVISOR'];
  if (!expected.every((h, i) => norm((values[0] || [])[i]) === h)) throw new Error('Estrutura do cadastro alterada.');

  const people: RosterPerson[] = [];
  const seen = new Set<string>();
  for (const r of values.slice(1)) {
    const product = norm(r[2]);
    const role = norm(r[5]);
    if (!ACTIVE_PRODUCTS.includes(product) || !ACTIVE_ROLES.includes(role) || norm(r[9]) !== 'TRUE') continue;
    const p: RosterPerson = {
      code: code(r[0]),
      seller: String(r[1] || '').trim(),
      team: String(r[4] || '').trim(),
      leaderCode: code(r[10]),
      leader: String(r[11] || '').trim(),
      role,
      product,
    };
    if (p.code && seen.has(p.code)) throw new Error('Código ativo duplicado no cadastro: ' + p.code);
    if (p.code) seen.add(p.code);
    people.push(p);
  }
  if (!people.length) throw new Error('Cadastro não retornou integrantes ativos.');
  return people;
}

function parseDate(raw: unknown) {
  if (typeof raw === 'number' && Number.isInteger(raw)) return new Date(Date.UTC(1899, 11, 30) + raw * 86400000).toISOString().slice(0, 10);
  const m = String(raw).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : undefined;
}

function commercialWeek(date: string) {
  const n = Math.floor((Date.parse(date) - COMMERCIAL_YEAR_START) / (7 * 86400000)) + 1;
  return 'SEMANA ' + String(n).padStart(2, '0');
}

const br = (d: string) => d.split('-').reverse().join('/');

interface SelectedSheet {
  title: string;
  rawTitle: string;
  sheetId: number;
  rowCount: number;
  person: RosterPerson;
}

// Aba "Nome - SDR" sem código: só associa se o nome casar com exatamente uma pessoa do cadastro.
function matchByName(title: string, roster: RosterPerson[]) {
  const tokens = nameTokens(title.replace(/\bSDR\b/gi, ' '));
  if (!tokens.length) return { person: undefined, candidates: 0 };
  const found = roster.filter((p) => p.code && tokens.every((t) => nameTokens(p.seller).includes(t)));
  return { person: found.length === 1 ? found[0] : undefined, candidates: found.length };
}

export async function fetchSource(source: SourceConfig, roster: RosterPerson[]) {
  const sheets = await sheetsClient();
  const ss = await sheets.spreadsheets.get({
    spreadsheetId: source.id,
    fields: 'properties(title,timeZone),sheets(properties(sheetId,title,gridProperties(rowCount)))',
  });
  const sourceName = ss.data.properties?.title || source.id;
  const owner = (sourceName.split(' - ')[1] || '').trim();
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: ss.data.properties?.timeZone || 'America/Sao_Paulo' });
  const closerRows: DailyRow[] = [];
  const sdrRows: SdrRow[] = [];
  const errors: string[] = [];
  const issues: SyncIssue[] = [];
  const link = (sheetId: number, row?: number) =>
    // gid na query sobrevive a redirecionamentos de login; a linha vai só no fragmento,
    // porque "range" na query é aplicado à última aba aberta e ignora o gid.
    `https://docs.google.com/spreadsheets/d/${source.id}/edit?gid=${sheetId}#gid=${sheetId}${row ? `&range=B${row}` : ''}`;
  const who = (p: RosterPerson) => ({ seller: p.seller, sellerCode: p.code, leader: p.leader, source: sourceName });

  const selected: SelectedSheet[] = [];
  for (const s of ss.data.sheets || []) {
    const rawTitle = s.properties?.title || '';
    const title = rawTitle.trim();
    const sheetId = s.properties?.sheetId ?? 0;
    const rowCount = s.properties?.gridProperties?.rowCount || 1000;
    const m = title.match(/-\s*(V\d{2,4})\s*$/i);

    if (m) {
      const person = roster.find((p) => p.code === code(m[1]));
      if (!person) continue;
      const short = nameTokens(title.slice(0, m.index).replace(/\bSDR\b/gi, ' '));
      const full = nameTokens(person.seller);
      if (!short.every((t) => full.includes(t))) {
        issues.push({
          kind: 'cadastro',
          ...who(person),
          date: 'Cadastro',
          field: 'Nome da aba',
          sheetValue: title,
          expected: person.seller,
          url: link(sheetId),
          reason: `Nome da aba "${title}" difere do cadastro "${person.seller}" para o código ${person.code}. Os dados foram considerados pelo código; corrigir a aba ou o cadastro.`,
        });
      }
      selected.push({ title, rawTitle, sheetId, rowCount, person });
      continue;
    }

    if (/\bSDR\b/i.test(title) && !/^(GERAL|RANKING)/i.test(title)) {
      const { person, candidates } = matchByName(title, roster);
      const suggestion = title.replace(/\s*-?\s*SDR\s*$/i, '').trim();
      if (!nameTokens(suggestion).length) continue;
      if (person) {
        issues.push({
          kind: 'renomear_aba',
          ...who(person),
          date: 'Aba',
          field: 'Nome da aba',
          sheetValue: title,
          expected: `${suggestion} - ${person.code}`,
          url: link(sheetId),
          reason: `Aba sem código de vendedor. Associada a ${person.seller} pelo nome; renomear para "${suggestion} - ${person.code}".`,
        });
        selected.push({ title, rawTitle, sheetId, rowCount, person });
      } else {
        issues.push({
          kind: 'renomear_aba',
          seller: title,
          source: sourceName,
          date: 'Aba',
          field: 'Nome da aba',
          sheetValue: title,
          expected: `${suggestion} - Vxxx`,
          url: link(sheetId),
          reason:
            candidates > 1
              ? `Aba sem código e o nome corresponde a ${candidates} pessoas do cadastro; dados não considerados. Renomear para "Nome - Vxxx".`
              : 'Aba sem código e o nome não corresponde a ninguém ativo no cadastro; dados não considerados. Renomear para "Nome - Vxxx".',
        });
      }
    }
  }

  if (source.kind === 'leader') {
    roster
      .filter((p) => p.leaderCode === source.leaderCode)
      .filter((p) => !p.code || !selected.some((s) => s.person.code === p.code))
      .forEach((p) =>
        issues.push({
          kind: 'cadastro',
          ...who(p),
          date: 'Cadastro',
          reason: p.code
            ? `Integrante ativo sem aba na planilha do líder. Criar a aba "${p.seller.split(' ')[0]} - ${p.code}".`
            : 'Integrante ativo sem código no cadastro; dados não associados.',
        }),
      );
  }

  if (!selected.length) return { closerRows, sdrRows, issues, source: sourceName };

  const batch = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: source.id,
    ranges: selected.map((s) => `'${s.rawTitle.replace(/'/g, "''")}'!B1:J${s.rowCount}`),
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'SERIAL_NUMBER',
  });

  selected.forEach((sheet, si) => {
    const p = sheet.person;
    const tab = sheet.title;
    let week = '';
    let block: { kind: 'closer' | 'sdr'; columns: number[] } | null = null;
    const blanks: string[] = [];
    let firstBlankRow = 0;

    (batch.data.valueRanges?.[si]?.values || []).forEach((row, i) => {
      const first = norm(row[0]);
      if (/^SEMANA\s+\d+/.test(first)) {
        week = 'SEMANA ' + String(Number(first.match(/\d+/)![0])).padStart(2, '0');
        block = null;
        return;
      }
      if (first === 'DATA') {
        const cells = row.map(norm);
        if (cells.includes('LIGACOES REALIZADAS')) {
          const columns = SDR_HEADERS.map((h) => cells.indexOf(h));
          if (columns[0] < 0 || columns[5] < 0) errors.push(`${tab} linha ${i + 1}: bloco SDR sem Ligações ou Headcounts.`);
          else block = { kind: 'sdr', columns };
        } else if (cells.includes('AGENDAS DISP')) {
          const columns = CLOSER_HEADERS.map((h) => cells.indexOf(h));
          if (columns[3] < 0 || columns[7] < 0) errors.push(`${tab} linha ${i + 1}: bloco diário sem Compareceram ou Headcounts.`);
          else block = { kind: 'closer', columns };
        } else block = null;
        return;
      }

      const current = block as { kind: 'closer' | 'sdr'; columns: number[] } | null;
      if (!current || row[0] === '' || row[0] == null || /^(TOTAL|RESUMO|MEDIA)/.test(first)) return;
      const url = link(sheet.sheetId, i + 1);

      // Recados/observações escritos na coluna de data não são registros.
      const looksLikeDate = typeof row[0] === 'number' ? row[0] > 40000 : /^\s*\d{1,2}\/\d{1,2}/.test(String(row[0]));
      if (!looksLikeDate) return;
      const date = parseDate(row[0]);
      if (!date || new Date(date).toISOString().slice(0, 10) !== date) {
        issues.push({ kind: 'data', ...who(p), date: `Linha ${i + 1}`, field: 'Data', sheetValue: String(row[0]), url, reason: `Data inválida na aba ${tab}; registro não incluído nos totais.` });
        return;
      }
      if (date > today) return;
      if (!periodFor(date, DEFAULT_CALENDAR)) {
        issues.push({ kind: 'data', ...who(p), date: br(date), sheetDate: date, url, reason: 'Data fora do calendário comercial; registro não incluído nos totais.' });
        return;
      }

      const fields = current.kind === 'sdr' ? SDR_FIELDS : CLOSER_FIELDS;
      const raw = current.columns.map((idx) => (idx < 0 ? '' : row[idx]));
      if (raw.every((v) => v === '' || v == null)) return;

      const absence = raw.find((v) => typeof v === 'string' && ABSENCE_WORDS.test(norm(v)));
      if (absence !== undefined) {
        issues.push({
          kind: 'ausencia_planilha',
          ...who(p),
          date: br(date),
          sheetDate: date,
          sheetValue: String(absence),
          expected: 'Registrar na aba Status RH',
          url,
          reason: `A planilha indica "${String(absence).trim()}" em ${br(date)}. Dia fora dos totais; registrar a ausência na aba Status (RH).`,
        });
        return;
      }

      const values: (number | null)[] = raw.map((v, j) => {
        if (v === '' || v == null) {
          blanks.push(`${br(date)} (${fields[j]})`);
          firstBlankRow ||= i + 1;
          return 0;
        }
        if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return v;
        issues.push({
          kind: 'valor_invalido',
          ...who(p),
          date: br(date),
          sheetDate: date,
          field: fields[j],
          sheetValue: String(v),
          expected: 'Número inteiro ≥ 0',
          url,
          reason: `${fields[j]} = "${String(v)}" não é um número válido; indicador marcado como não informado.`,
        });
        return null;
      });

      const rule = (field: number, limit: number, msg: string) => {
        const v = values[field];
        const max = values[limit];
        // Mesmo tratamento do Compareceram: o limite é elevado ao valor lançado.
        if (v !== null && max !== null && v > max) {
          values[limit] = v;
          issues.push({
            kind: 'ajuste',
            ...who(p),
            date: br(date),
            sheetDate: date,
            field: fields[limit],
            sheetValue: `${fields[limit]} ${max} · ${fields[field]} ${v}`,
            expected: `${fields[limit]} considerados = ${v}`,
            url,
            reason: `${fields[field]} (${v}) maior que ${fields[limit]} (${max}). ${msg} O dash considerou ${fields[limit]} = ${v}.`,
          });
        }
      };

      const base = {
        date,
        seller: p.seller,
        code: p.code,
        sellerId: p.code,
        source: sourceName,
        leader: p.leader,
        team: p.team,
        week: week || commercialWeek(date),
        status: 'Ativo',
        product: p.product,
        origin: { owner, ownerCode: source.leaderCode ?? '', url },
      };

      if (current.kind === 'closer') {
        rule(6, 5, 'Levantadas com venda não podem exceder as atendidas.');
        const r = { type: 'daily', ...base } as DailyRow;
        METRIC_KEYS.forEach((k, j) => (r[k] = values[j]));
        closerRows.push(r);
      } else {
        rule(1, 0, 'Atenderam não pode exceder as ligações realizadas.');
        // Regra de negócio: se compareceram mais pessoas que as agendadas para o dia, agendados = compareceram.
        const [agendados, compareceram] = [values[3], values[4]];
        if (agendados !== null && compareceram !== null && compareceram > agendados) {
          values[3] = compareceram;
          issues.push({
            kind: 'ajuste',
            ...who(p),
            date: br(date),
            sheetDate: date,
            field: fields[3],
            sheetValue: `Agendados ${agendados} · Compareceram ${compareceram}`,
            expected: `Agendados considerados = ${compareceram}`,
            url,
            reason: `Compareceram (${compareceram}) maior que Agendados para hoje (${agendados}); o dash considerou Agendados = ${compareceram}.`,
          });
        }
        const r = { type: 'sdr', ...base } as SdrRow;
        SDR_KEYS.forEach((k, j) => (r[k] = values[j]));
        sdrRows.push(r);
      }
    });

    if (blanks.length) {
      issues.push({
        kind: 'em_branco',
        ...who(p),
        date: 'Vários dias',
        sheetValue: `${blanks.length} campos em branco`,
        expected: 'Preencher com 0 quando não houver',
        url: link(sheet.sheetId, firstBlankRow),
        reason: `${blanks.length} campos em branco na aba ${tab} foram considerados 0: ${blanks.slice(0, 8).join(', ')}${blanks.length > 8 ? '…' : ''}`,
      });
    }
  });

  if (errors.length) {
    throw new Error(`${sourceName}: ${errors.slice(0, 4).join(' • ')}${errors.length > 4 ? ` • e mais ${errors.length - 4} inconsistências.` : ''}`);
  }
  return { closerRows, sdrRows, issues, source: sourceName };
}
