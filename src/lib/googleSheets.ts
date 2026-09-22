import 'server-only';
import { google } from 'googleapis';
import { periodFor, DEFAULT_CALENDAR } from './calendar';
import type { DailyRow, SyncIssue } from './types';
import { METRIC_KEYS } from './types';

// Configuração das planilhas de origem (mesma lista do coletor Apps Script original).
export const SOURCE_SPREADSHEETS = [
  '15ZvGFI4XCrzr09Mg37XUboO9r8GpBAYSV6X6MFF5MaM',
  '1fsOm6MMS-HyYnfVxZj7yAdGBxpBCWTKavKU0cOQjW7Q',
  '1V9ED6pCzQrwZOEoqYh-iIb1U-HzZx6SmYfBtyIMRtt8',
  '1sl6Jyd3PCUTpZnn8dN0Il6IpK1gXX2jZwCNe2fcHYlY',
  '1YLagcrWrEE7WEG56Ldgmsyfmvkdz2i8miWx3wMVyqPI',
  '18RqQooixW531m-u1Ti-2etzDkNkXInRcm3BJ6_0jK44',
] as const;

export const LEADER_CODES = ['V096', 'V555', 'V820', 'V1065', 'V1047', 'V990'] as const;
export const ROSTER_SPREADSHEET_ID = '1uK_C5pR1p8TTMlniSKOWAISfSSVvzPuEaCb828gdTNY';
export const ROSTER_SHEET_ID = 187997157;

const AUTO_HEADERS = [
  'DATA',
  'AGENDAS DISP',
  'AGENDADOS',
  'CONFIRMADOS',
  'COMPARECERAM',
  'LEVANTADAS DE MAO SOLICITADAS',
  'LEVANTADAS ATENDIDAS',
  'LEVANTADA C VENDA',
  'HEADCOUNTS',
];

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

interface RosterPerson {
  code: string;
  seller: string;
  team: string;
  leaderCode: string;
  leader: string;
}

function auth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!email || !key) throw new Error('Credenciais da service account do Google ausentes.');
  return new google.auth.JWT({
    email,
    key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
}

async function sheetsClient() {
  const client = auth();
  await client.authorize();
  return google.sheets({ version: 'v4', auth: client });
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
  const rowCount = sheet.properties!.gridProperties!.rowCount;
  const range = `'${title}'!A1:N${rowCount}`;
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: ROSTER_SPREADSHEET_ID,
    ranges: [range],
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const values = res.data.valueRanges?.[0].values || [];
  const expected = [
    'CODIGO DO INTEGRANTE',
    'NOME DO INTEGRANTE',
    'PRODUTO',
    'FRENTE',
    'NOME DO TIME',
    'CARGO',
    'SENIORIDADE',
    'REGIME',
    'APTO PARA LEVANTADA',
    'ATIVO',
    'CODIGO DO LIDER',
    'NOME DO LIDER',
    'LIDER EM TREINAMENTO',
    'SUPERVISOR',
  ];
  if (!expected.every((h, i) => norm((values[0] || [])[i]) === h)) {
    throw new Error('Estrutura do cadastro alterada.');
  }
  const people: RosterPerson[] = [];
  const seen = new Set<string>();
  for (const r of values.slice(1)) {
    if (norm(r[2]) !== 'FL' || norm(r[5]) !== 'CLOSER' || norm(r[9]) !== 'TRUE') continue;
    const p: RosterPerson = {
      code: code(r[0]),
      seller: String(r[1] || '').trim(),
      team: String(r[4] || '').trim(),
      leaderCode: code(r[10]),
      leader: String(r[11] || '').trim(),
    };
    if (p.code && seen.has(p.code)) throw new Error('Código ativo duplicado no cadastro: ' + p.code);
    if (p.code) seen.add(p.code);
    people.push(p);
  }
  if (!people.length) throw new Error('Cadastro não retornou Closers ativos da FL.');
  return people;
}

function serialToDate(serial: number) {
  return new Date(Date.UTC(1899, 11, 30) + serial * 86400000).toISOString().slice(0, 10);
}

export async function fetchSource(index: number, roster: RosterPerson[]) {
  if (!Number.isInteger(index) || index < 0 || index >= SOURCE_SPREADSHEETS.length) {
    throw new Error('Origem inválida.');
  }
  const spreadsheetId = SOURCE_SPREADSHEETS[index];
  const sheets = await sheetsClient();
  const ss = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'properties(title,timeZone),sheets(properties(title,gridProperties(rowCount)))',
  });
  const source = ss.data.properties?.title || '';
  const leader = source.split(' - ')[1];
  if (!leader) throw new Error('Líder não identificado: ' + source);

  const timeZone = ss.data.properties?.timeZone || 'America/Sao_Paulo';
  const today = new Date().toLocaleDateString('sv-SE', { timeZone }); // yyyy-mm-dd
  const rows: DailyRow[] = [];
  const errors: string[] = [];
  const issues: SyncIssue[] = [];

  const teamRoster = roster.filter((p) => p.leaderCode === code(LEADER_CODES[index]));

  const selected = (ss.data.sheets || [])
    .map((s) => {
      const title = s.properties?.title || '';
      const m = title.match(/-\s*(V\d{3,4})\s*$/i);
      if (/\bSDR\b/i.test(title) || !m) return null;
      const person = teamRoster.find((p) => p.code === code(m[1]));
      if (!person) return null;
      const short = norm(title.slice(0, m.index))
        .replace(/[^A-Z0-9 ]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
      const full = norm(person.seller).split(' ');
      const knownNeto = person.code === 'V555' && norm(title) === 'JOSE BERNARDINO(NETO) - V555';
      if (!knownNeto && !short.every((t) => full.includes(t))) {
        issues.push({
          source,
          seller: title,
          date: 'Cadastro',
          reason: 'Nome da aba diverge do cadastro para este código; aba excluída.',
        });
        return null;
      }
      return { properties: s.properties!, person };
    })
    .filter((s): s is { properties: NonNullable<typeof ss.data.sheets>[number]['properties'] & object; person: RosterPerson } => !!s);

  teamRoster
    .filter((p) => !p.code || !selected.some((s) => s.person.code === p.code))
    .forEach((p) =>
      issues.push({
        source,
        seller: p.seller,
        date: 'Cadastro',
        reason: p.code
          ? 'Closer ativo sem aba correspondente na planilha de seu líder.'
          : 'Closer ativo sem código no cadastro; dados não associados.',
      }),
    );

  if (!selected.length) return { rows, source, issues, collectedAt: new Date().toISOString() };

  const ranges = selected.map((s) => `'${s.properties.title!.replace(/'/g, "''")}'!B1:J${s.properties.gridProperties!.rowCount}`);
  const batchRes = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'SERIAL_NUMBER',
  });
  const batches = batchRes.data.valueRanges || [];

  selected.forEach((sheet, si) => {
    const seller = sheet.properties.title!.trim();
    const match = seller.match(/\bV?\s*(\d{3,4})\b/i);
    let week = '';
    let header = false;
    let columns: number[] = [];
    const values = batches[si]?.values || [];

    values.forEach((row, i) => {
      const first = norm(row[0]);
      if (/^SEMANA\s+\d+/.test(first)) {
        week = 'SEMANA ' + String(Number(first.match(/\d+/)![0])).padStart(2, '0');
        header = false;
        return;
      }
      if (!week) return;
      if (first === 'DATA') {
        const names = row.map(norm);
        columns = AUTO_HEADERS.slice(1).map((h) => names.indexOf(h));
        if (columns[3] < 0 || columns[7] < 0) {
          errors.push(seller + ' linha ' + (i + 1) + ': bloco diário sem Compareceram ou Headcounts.');
          header = false;
        } else header = true;
        return;
      }
      if (!header || !row[0] || /^(TOTAL|RESUMO|MEDIA|MÉDIA)/.test(first)) return;

      let date: string | undefined;
      const raw = row[0];
      if (typeof raw === 'number' && Number.isFinite(raw) && Number.isInteger(raw)) {
        date = serialToDate(raw);
      } else {
        const m = String(raw).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (m) date = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      }
      if (!date) {
        issues.push({ source, seller, date: 'Linha ' + (i + 1), reason: 'Data inválida; registro não incluído nos totais.' });
        return;
      }
      if (date > today) return;
      if (isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || !periodFor(date, DEFAULT_CALENDAR)) {
        issues.push({ source, seller, date: 'Linha ' + (i + 1), reason: 'Data fora do calendário comercial; registro não incluído nos totais.' });
        return;
      }

      const metrics: (number | null)[] = METRIC_KEYS.map((_k, j) => {
        const idx = columns[j];
        const v = idx < 0 ? null : row[idx];
        return v === '' || v == null ? null : v;
      });
      if (metrics.every((v) => v === null)) return;

      metrics.forEach((v, j) => {
        if (v !== null && (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0)) {
          issues.push({ source, seller, date, reason: AUTO_HEADERS[j + 1] + ': valor não numérico ou inválido; indicador marcado como não informado.' });
          metrics[j] = null;
        }
      });
      if (metrics[6] !== null && metrics[5] !== null && metrics[6] > metrics[5]) {
        issues.push({ source, seller, date, reason: 'Levantadas com venda excedem atendidas; quantidade com venda e conversão marcadas como não informadas.' });
        metrics[6] = null;
      }

      if (!match) return;
      const p = sheet.person;
      const r: DailyRow = {
        type: 'daily',
        date,
        seller: p.seller,
        code: p.code,
        sellerId: p.code,
        source,
        leader: p.leader,
        team: p.team,
        week,
        status: 'Ativo',
        agendas: metrics[0],
        agendados: metrics[1],
        confirmados: metrics[2],
        calls: metrics[3],
        solicitadas: metrics[4],
        atendidas: metrics[5],
        comVenda: metrics[6],
        headcounts: metrics[7],
      };
      rows.push(r);
    });
  });

  if (errors.length) {
    throw new Error(source + ': ' + errors.slice(0, 4).join(' • ') + (errors.length > 4 ? ' • e mais ' + (errors.length - 4) + ' inconsistências.' : ''));
  }
  if (!rows.length) throw new Error('Nenhum registro diário válido: ' + source);
  return { rows, source, issues, collectedAt: new Date().toISOString() };
}
