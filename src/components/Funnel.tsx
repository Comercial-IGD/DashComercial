import { pct, ratio, sum } from '@/lib/metrics';
import { METRIC_KEYS, SDR_KEYS, type DailyRow, type SdrRow } from '@/lib/types';

const STAGES = [
  { label: 'Ligações realizadas', role: 'SDR', from: 'sdr', key: 'ligacoes' },
  { label: 'Atenderam', role: 'SDR', from: 'sdr', key: 'atenderam' },
  { label: 'Agendas criadas', role: 'SDR', from: 'sdr', key: 'agendasCriadas' },
  { label: 'Agendados', role: 'Closer', from: 'closer', key: 'agendados' },
  { label: 'Compareceram', role: 'Closer', from: 'closer', key: 'calls' },
  { label: 'Levantadas atendidas', role: 'Closer', from: 'closer', key: 'atendidas' },
  { label: 'Levantadas com venda', role: 'Closer', from: 'closer', key: 'comVenda' },
] as const;

function values(closers: DailyRow[], sdrs: SdrRow[]) {
  const c = sum(closers, METRIC_KEYS) as unknown as Record<string, number | null>;
  const s = sum(sdrs, SDR_KEYS) as unknown as Record<string, number | null>;
  return STAGES.map((st) => (st.from === 'sdr' ? s[st.key] : c[st.key]));
}

function delta(now: number | null, before: number | null) {
  if (now === null || before === null || before === 0) return null;
  return (now - before) / before;
}

export function Funnel(props: { closers: DailyRow[]; sdrs: SdrRow[]; prev: { closers: DailyRow[]; sdrs: SdrRow[] } | null }) {
  const now = values(props.closers, props.sdrs);
  const before = props.prev ? values(props.prev.closers, props.prev.sdrs) : null;
  const pass = now.map((v, i) => (i === 0 ? null : ratio(v, now[i - 1])));
  const passBefore = before?.map((v, i) => (i === 0 ? null : ratio(v, before[i - 1])));
  const candidates = pass.map((v, i) => ({ v, i })).filter((x) => x.v !== null && x.i > 0);
  const worst = candidates.length ? candidates.reduce((a, b) => (b.v! < a.v! ? b : a)).i : -1;
  const max = Math.max(1, ...now.map((v) => v ?? 0));

  return (
    <section className="panel">
      <div className="panelhead">
        <div>
          <p className="eyebrow">FUNIL COMERCIAL</p>
          <h2>Do primeiro contato à venda</h2>
        </div>
        <p className="muted">{props.prev ? 'Variação contra o período anterior de mesma duração' : 'Selecione um mês ou intervalo de datas para comparar com o período anterior'}</p>
      </div>
      <div className="funnel">
        {STAGES.map((st, i) => {
          const d = before ? delta(now[i], before[i]) : null;
          const rawPd = passBefore && pass[i] !== null && passBefore[i] != null ? pass[i]! - passBefore[i]! : null;
          const pd = rawPd === null ? null : Math.round(rawPd * 1000) / 1000;
          return (
            <div key={st.key + st.from} className={`stage${i === worst ? ' worst' : ''}`}>
              {i > 0 && (
                <div className="pass">
                  <strong>{pct(pass[i])}</strong>
                  <span>passam</span>
                  {pd !== null && <em className={pd >= 0 ? 'up' : 'down'}>{`${pd >= 0 ? '+' : ''}${(pd * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} p.p.`}</em>}
                </div>
              )}
              <div className="stage-body">
                <span className={`role ${st.role.toLowerCase()}`}>{st.role}</span>
                <span className="stage-label">{st.label}</span>
                <strong>{now[i] === null ? '—' : now[i]!.toLocaleString('pt-BR')}</strong>
                {d !== null && <em className={d >= 0 ? 'up' : 'down'}>{`${d >= 0 ? '▲' : '▼'} ${Math.abs(d * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`}</em>}
                <i className="stage-bar" style={{ width: `${((now[i] ?? 0) / max) * 100}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      {worst > 0 && (
        <p className="footnote">
          Maior perda: de <b>{STAGES[worst - 1].label}</b> para <b>{STAGES[worst].label}</b> ({pct(pass[worst])} passam).
        </p>
      )}
    </section>
  );
}
