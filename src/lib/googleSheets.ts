import 'server-only';
import { google, type sheets_v4 } from 'googleapis';
import { periodFor, DEFAULT_CALENDAR } from './calendar';
import { METRIC_KEYS, SDR_KEYS, type DailyRow, type SdrRow, type SyncIssue } from './types';

export interface SourceConfig {
  id: string;
  kind: 'leader' | 'sdr';
  leaderCode?: string;
}

// Planilhas de líder (closers + SDRs do líder) e planilhas exclusivas de SDR.
export const SOURCES: SourceConfig[] = [
  { id: '15ZvGFI4XCrzr09Mg37XUboO9r8GpBAYSV6X6MFF5MaM', kind: 'leader', leaderCode: 'V96' },
  { id: '1fsOm6MMS-HyYnfVxZj7yAdGBxpBCWTKavKU0cOQjW7Q', kind: 'leader', leaderCode: 'V555' },
  { id: '1V9ED6pCzQrwZOEoqYh-iIb1U-HzZx6SmYfBtyIMRtt8', kind: 'leader', leaderCode: 'V820' },
  { id: '1sl6Jyd3PCUTpZnn8dN0Il6IpK1gXX2jZwCNe2fcHYlY', kind: 'leader', leaderCode: 'V1065' },
  { id: '1YLagcrWrEE7WEG56Ldgmsyfmvkdz2i8miWx3wMVyqPI', kind: 'leader', leaderCode: 'V1047' },
  { id: '18RqQooixW531m-u1Ti-2etzDkNkXInRcm3BJ6_0jK44', kind: 'leader', leaderCode: 'V990' },
  { id: '1rwf53Z2raKCl9lz4qQlZjiERQ-JkkHOEFV8NYs3GcBA', kind: 'sdr' },
  { id: '13S3NA-dWgSrHi6LW-cLN2Wgqp2GrCqMZDoj3u6CDnWg', kind: 'sdr' },
];

export const ACTIVE_PRODUCTS = ['FL'];
const ACTIVE_ROLES = ['CLOSER', 'SDR'];

export const ROSTER_SPREADSHEET_ID = '1uK_C5pR1p8TTMlniSKOWAISfSSVvzPuEaCb828gdTNY';
export const ROSTER_SHEET_ID = 187997157;

const CLOSER_HEADERS = ['AGENDAS DISP', 'AGENDADOS', 'CONFIRMADOS', 'COMPARECERAM', 'LEVANTADAS DE MAO SOLICITADAS', 'LEVANTADAS ATENDIDAS', 'LEVANTADA C VENDA', 'HEADCOUNTS'];
const SDR_HEADERS = ['LIGACOES REALIZADAS', 'ATENDERAM', 'AGENDAS CRIADAS HOJE', 'AGENDADOS PARA HOJE', 'COMPARECERAM', 'HEADCOUNTS'];
const COMMERCIAL_YEAR_START = Date.UTC(2025, 11, 31);

function norm(v: unknown) {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
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
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
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

function serialToDate(serial: number) {
  return new Date(Date.UTC(1899, 11, 30) + serial * 86400000).toISOString().slice(0, 10);
}

function parseDate(raw: unknown) {
  if (typeof raw === 'number' && Number.isInteger(raw)) return serialToDate(raw);
  const m = String(raw).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : undefined;
}

function commercialWeek(date: string) {
  const n = Math.floor((Date.parse(date) - COMMERCIAL_YEAR_START) / (7 * 86400000)) + 1;
  return 'SEMANA ' + String(n).padStart(2, '0');
}

type Block = { kind: 'closer' | 'sdr'; offset: number; columns: number[] } | null;

export async function fetchSource(source: SourceConfig, roster: RosterPerson[]) {
  const sheets = await sheetsClient();
  const ss = await sheets.spreadsheets.get({
    spreadsheetId: source.id,
    fields: 'properties(title,timeZone),sheets(properties(title,gridProperties(rowCount)))',
  });
  const sourceName = ss.data.properties?.title || source.id;
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: ss.data.properties?.timeZone || 'America/Sao_Paulo' });
  const closerRows: DailyRow[] = [];
  const sdrRows: SdrRow[] = [];
  const errors: string[] = [];
  const issues: SyncIssue[] = [];

  const eligible = source.kind === 'leader' ? roster.filter((p) => p.leaderCode === source.leaderCode) : roster;

  const selected: { title: string; rowCount: number; person: RosterPerson }[] = [];
  for (const s of ss.data.sheets || []) {
    const title = s.properties?.title || '';
    const m = title.match(/-\s*(V\d{3,4})\s*$/i);
    if (!m) continue;
    const person = eligible.find((p) => p.code === code(m[1]));
    if (!person) continue;
    const short = norm(title.slice(0, m.index)).replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
    const full = norm(person.seller).split(' ');
    const knownNeto = person.code === 'V555' && norm(title) === 'JOSE BERNARDINO(NETO) - V555';
    if (!knownNeto && !short.every((t) => full.includes(t))) {
      issues.push({ source: sourceName, seller: title, date: 'Cadastro', reason: 'Nome da aba diverge do cadastro para este código; aba excluída.' });
      continue;
    }
    selected.push({ title, rowCount: s.properties?.gridProperties?.rowCount || 1000, person });
  }

  if (source.kind === 'leader') {
    eligible
      .filter((p) => !p.code || !selected.some((s) => s.person.code === p.code))
      .forEach((p) =>
        issues.push({
          source: sourceName,
          seller: p.seller,
          date: 'Cadastro',
          reason: p.code ? 'Integrante ativo sem aba correspondente na planilha de seu líder.' : 'Integrante ativo sem código no cadastro; dados não associados.',
        }),
      );
  }

  if (!selected.length) return { closerRows, sdrRows, issues, source: sourceName };

  const batch = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: source.id,
    ranges: selected.map((s) => `'${s.title.replace(/'/g, "''")}'!A1:Z${s.rowCount}`),
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'SERIAL_NUMBER',
  });

  selected.forEach((sheet, si) => {
    const seller = sheet.title.trim();
    const p = sheet.person;
    let week = '';
    let block: Block = null;

    (batch.data.valueRanges?.[si]?.values || []).forEach((row, i) => {
      const cells = row.map(norm);
      const weekCell = cells.find((c) => /^SEMANA\s+\d+/.test(c));
      if (weekCell) {
        week = 'SEMANA ' + String(Number(weekCell.match(/\d+/)![0])).padStart(2, '0');
        block = null;
        return;
      }

      const dataIdx = cells.indexOf('DATA');
      if (dataIdx >= 0) {
        if (cells.includes('LIGACOES REALIZADAS')) {
          const columns = SDR_HEADERS.map((h) => cells.indexOf(h));
          if (columns[0] < 0 || columns[5] < 0) errors.push(`${seller} linha ${i + 1}: bloco SDR sem Ligações ou Headcounts.`);
          else block = { kind: 'sdr', offset: dataIdx, columns };
        } else if (cells.includes('AGENDAS DISP')) {
          const columns = CLOSER_HEADERS.map((h) => cells.indexOf(h));
          if (columns[3] < 0 || columns[7] < 0) errors.push(`${seller} linha ${i + 1}: bloco diário sem Compareceram ou Headcounts.`);
          else block = { kind: 'closer', offset: dataIdx, columns };
        } else block = null;
        return;
      }

      const current = block as Block;
      if (!current) return;
      const raw = row[current.offset];
      const first = cells[current.offset] || '';
      if (raw === '' || raw == null || /^(TOTAL|RESUMO|MEDIA)/.test(first)) return;

      const date = parseDate(raw);
      if (!date) {
        issues.push({ source: sourceName, seller, date: 'Linha ' + (i + 1), reason: 'Data inválida; registro não incluído nos totais.' });
        return;
      }
      if (date > today) return;
      if (new Date(date).toISOString().slice(0, 10) !== date || !periodFor(date, DEFAULT_CALENDAR)) {
        issues.push({ source: sourceName, seller, date: 'Linha ' + (i + 1), reason: 'Data fora do calendário comercial; registro não incluído nos totais.' });
        return;
      }

      const headers = current.kind === 'sdr' ? SDR_HEADERS : CLOSER_HEADERS;
      const values: (number | null)[] = current.columns.map((idx) => {
        const v = idx < 0 ? null : row[idx];
        return v === '' || v == null ? null : v;
      });
      if (values.every((v) => v === null)) return;
      values.forEach((v, j) => {
        if (v !== null && (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0)) {
          issues.push({ source: sourceName, seller, date, reason: `${headers[j]}: valor não numérico ou inválido; indicador marcado como não informado.` });
          values[j] = null;
        }
      });

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
      };

      if (current.kind === 'closer') {
        if (values[6] !== null && values[5] !== null && values[6] > values[5]) {
          issues.push({ source: sourceName, seller, date, reason: 'Levantadas com venda excedem atendidas; quantidade com venda marcada como não informada.' });
          values[6] = null;
        }
        const r = { type: 'daily', ...base } as DailyRow;
        METRIC_KEYS.forEach((k, j) => (r[k] = values[j]));
        closerRows.push(r);
      } else {
        if (values[1] !== null && values[0] !== null && values[1] > values[0]) {
          issues.push({ source: sourceName, seller, date, reason: 'Atenderam excede ligações realizadas; atenderam marcado como não informado.' });
          values[1] = null;
        }
        if (values[4] !== null && values[3] !== null && values[4] > values[3]) {
          issues.push({ source: sourceName, seller, date, reason: 'Compareceram excede agendados para o dia; compareceram marcado como não informado.' });
          values[4] = null;
        }
        const r = { type: 'sdr', ...base } as SdrRow;
        SDR_KEYS.forEach((k, j) => (r[k] = values[j]));
        sdrRows.push(r);
      }
    });
  });

  if (errors.length) {
    throw new Error(`${sourceName}: ${errors.slice(0, 4).join(' • ')}${errors.length > 4 ? ` • e mais ${errors.length - 4} inconsistências.` : ''}`);
  }
  return { closerRows, sdrRows, issues, source: sourceName };
}
