import { absencesInRange, workedDays, type AbsenceIndex } from '@/lib/attendance';
import { pct, ratio, sum } from '@/lib/metrics';
import { ABSENCE_REASONS, METRIC_KEYS, SDR_KEYS, type DailyRow, type SdrRow } from '@/lib/types';

const br = (d: string) => d.split('-').reverse().join('/');

// Agrupa dias consecutivos (na ordem de datas) em que a pessoa manteve o mesmo papel.
function segments(days: { date: string; role: 'SDR' | 'Closer' }[]) {
  const out: { role: 'SDR' | 'Closer'; start: string; end: string; days: number }[] = [];
  for (const d of days) {
    const last = out.at(-1);
    if (last && last.role === d.role) {
      last.end = d.date;
      last.days++;
    } else out.push({ role: d.role, start: d.date, end: d.date, days: 1 });
  }
  return out;
}

export function PeopleView(props: { closers: DailyRow[]; sdrs: SdrRow[]; absences: AbsenceIndex; range: { from?: string; to?: string } }) {
  const ids = [...new Set([...props.closers, ...props.sdrs].map((r) => r.sellerId))];
  const people = ids
    .map((id) => {
      const c = props.closers.filter((r) => r.sellerId === id);
      const s = props.sdrs.filter((r) => r.sellerId === id);
      const any = c[0] ?? s[0];
      const days = [
        ...c.map((r) => ({ date: r.date, role: 'Closer' as const })),
        ...s.map((r) => ({ date: r.date, role: 'SDR' as const })),
      ].sort((a, b) => a.date.localeCompare(b.date));
      return { id, name: any.seller, team: any.team, leader: any.leader, c, s, segs: segments(days), dates: days.map((d) => d.date) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!people.length) return <p className="empty panel">Nenhuma pessoa com registros nesta seleção.</p>;

  return (
    <section className="people">
      {people.map((p) => {
        const cs = sum(p.c, METRIC_KEYS);
        const ss = sum(p.s, SDR_KEYS);
        const abs = absencesInRange(props.absences, p.id, props.range.from ?? p.dates[0], props.range.to ?? p.dates.at(-1));
        const changed = new Set(p.segs.map((x) => x.role)).size > 1;
        return (
          <article className="panel person" key={p.id}>
            <div className="panelhead">
              <div>
                <h2>{p.name}</h2>
                <p className="muted">
                  {p.team} · Líder: {p.leader} · {workedDays([...p.c, ...p.s], props.absences)} dias atuados
                  {changed && <span className="badge info">Atuou nos dois papéis</span>}
                </p>
              </div>
            </div>
            <div className="timeline">
              {p.segs.map((seg, i) => (
                <span key={i} className={`seg ${seg.role.toLowerCase()}`} style={{ flexGrow: seg.days }} title={`${seg.role}: ${br(seg.start)} a ${br(seg.end)}`}>
                  {seg.role} · {br(seg.start)} – {br(seg.end)}
                </span>
              ))}
            </div>
            <div className="person-grid">
              {p.s.length > 0 && (
                <div>
                  <h3>Como SDR ({p.s.length} dias)</h3>
                  <p>
                    {ss.ligacoes?.toLocaleString('pt-BR') ?? '—'} ligações · {ss.agendasCriadas?.toLocaleString('pt-BR') ?? '—'} agendas criadas
                  </p>
                  <p className="muted">
                    Contato {pct(ratio(ss.atenderam, ss.ligacoes))} · Agendamento {pct(ratio(ss.agendasCriadas, ss.atenderam))} · Comparecimento {pct(ratio(ss.compareceram, ss.agendadosHoje))}
                  </p>
                </div>
              )}
              {p.c.length > 0 && (
                <div>
                  <h3>Como closer ({p.c.length} dias)</h3>
                  <p>
                    {cs.calls?.toLocaleString('pt-BR') ?? '—'} calls · {cs.comVenda?.toLocaleString('pt-BR') ?? '—'} levantadas com venda
                  </p>
                  <p className="muted">
                    Comparecimento {pct(ratio(cs.calls, cs.agendados))} · Conversão de levantadas {pct(ratio(cs.comVenda, cs.atendidas))}
                  </p>
                </div>
              )}
              <div>
                <h3>Ausências no período</h3>
                {abs.length ? (
                  <ul className="absences">
                    {abs.map((a) => (
                      <li key={a.date}>
                        {br(a.date)} — {ABSENCE_REASONS[a.status.reason]}
                        {a.status.note ? ` (${a.status.note})` : ''}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">Nenhuma ausência registrada.</p>
                )}
              </div>
            </div>
          </article>
        );
      })}
    </section>
  );
}
