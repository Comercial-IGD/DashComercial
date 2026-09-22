export interface RankItem {
  id: string;
  name: string;
  subtitle: string;
  value: number;
  display: string;
  absences: number;
}

const MEDALS = ['gold', 'silver', 'bronze'];

export function Ranking({ title, items, note }: { title: string; items: RankItem[]; note?: string }) {
  const sorted = [...items].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name)).slice(0, 10);
  const max = Math.max(1e-9, ...sorted.map((r) => r.value));
  const top = sorted.slice(0, 3);
  const rest = sorted.slice(3);

  return (
    <div className="ranking">
      <h3>{title}</h3>
      {sorted.length === 0 ? (
        <p className="muted">Sem dados para este período.</p>
      ) : (
        <>
          <div className="podium">
            {top.map((r, i) => (
              <article key={r.id} className={`podium-card ${MEDALS[i]}`}>
                <span className="place">{i + 1}º</span>
                <strong className="podium-value">{r.display}</strong>
                <span className="podium-name">{r.name}</span>
                <small>
                  {r.subtitle}
                  {r.absences > 0 && <span className="badge">{r.absences} {r.absences === 1 ? 'dia ausente' : 'dias ausentes'}</span>}
                </small>
              </article>
            ))}
          </div>
          {rest.map((r, i) => (
            <div className="rankrow" key={r.id}>
              <em>{String(i + 4).padStart(2, '0')}</em>
              <span>
                {r.name}
                {r.absences > 0 && <span className="badge">{r.absences}d ausente</span>}
              </span>
              <strong>{r.display}</strong>
              <i className="bar" style={{ width: `${(r.value / max) * 75}%` }} />
            </div>
          ))}
        </>
      )}
      {note && <p className="footnote">{note}</p>}
    </div>
  );
}
