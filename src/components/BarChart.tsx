export interface Bar {
  key: string;
  label: string;
  value: number | null;
  display: string;
  flagged?: string;
}

export function BarChart({ bars }: { bars: Bar[] }) {
  const max = Math.max(1, ...bars.map((b) => b.value ?? 0));
  if (!bars.length) return <p className="empty">Sem registros para esta seleção.</p>;
  return (
    <div className="chart">
      <div className="bars">
        {bars.map((b) => (
          <div className={`barcol${b.flagged ? ' flagged' : ''}`} key={b.key} title={b.flagged ? `${b.label}: ${b.flagged}` : `${b.label}: ${b.display}`}>
            <b>{b.display}</b>
            <i style={{ height: Math.max(2, ((b.value ?? 0) / max) * 150) }} />
            <span>{b.label}</span>
            {b.flagged && <em className="flag">{b.flagged}</em>}
          </div>
        ))}
      </div>
    </div>
  );
}
