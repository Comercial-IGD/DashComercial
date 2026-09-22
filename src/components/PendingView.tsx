'use client';

import { useMemo, useState } from 'react';
import { ISSUE_KINDS, type IssueKind, type SyncIssue } from '@/lib/types';

// Tipos que dependem de correção na planilha/cadastro (os demais são avisos).
const ACTION_KINDS: IssueKind[] = ['regra', 'valor_invalido', 'divergencia', 'ausencia_planilha', 'renomear_aba', 'cadastro', 'data', 'papel_duplicado'];
const NO_LEADER = 'Sem líder identificado';

function message(leader: string, people: [string, SyncIssue[]][]) {
  const lines = [`Olá, ${leader.split(' ')[0]}! Seguem os lançamentos que precisam de correção nas planilhas:`, ''];
  for (const [person, items] of people) {
    lines.push(`*${person}*`);
    for (const i of items) {
      const detail = [i.field, i.sheetValue && `na planilha: ${i.sheetValue}`, i.expected && `esperado: ${i.expected}`].filter(Boolean).join(' · ');
      lines.push(`• ${i.date} — ${ISSUE_KINDS[i.kind]}${detail ? ` (${detail})` : ''}`);
      if (i.url) lines.push(`  ${i.url}`);
    }
    lines.push('');
  }
  lines.push('Depois de corrigir, o dash atualiza na próxima sincronização. Obrigado!');
  return lines.join('\n');
}

export function PendingView({ issues }: { issues: SyncIssue[] }) {
  const [kind, setKind] = useState<'' | IssueKind>('');
  const [onlyAction, setOnlyAction] = useState(true);
  const [copied, setCopied] = useState('');

  const visible = issues.filter((i) => (!kind || i.kind === kind) && (!onlyAction || ACTION_KINDS.includes(i.kind)));

  const byKind = useMemo(() => {
    const m = new Map<IssueKind, number>();
    issues.forEach((i) => m.set(i.kind, (m.get(i.kind) || 0) + 1));
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [issues]);

  const grouped = useMemo(() => {
    const leaders = new Map<string, Map<string, SyncIssue[]>>();
    for (const i of visible) {
      const l = i.leader || NO_LEADER;
      if (!leaders.has(l)) leaders.set(l, new Map());
      const people = leaders.get(l)!;
      if (!people.has(i.seller)) people.set(i.seller, []);
      people.get(i.seller)!.push(i);
    }
    return [...leaders]
      .map(([leader, people]) => ({
        leader,
        total: [...people.values()].reduce((n, x) => n + x.length, 0),
        people: [...people].sort((a, b) => b[1].length - a[1].length),
      }))
      .sort((a, b) => b.total - a.total);
  }, [visible]);

  const copy = async (leader: string, people: [string, SyncIssue[]][]) => {
    const text = message(leader, people);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      window.prompt('Copie a mensagem abaixo (Ctrl+C):', text);
      return;
    }
    setCopied(leader);
    setTimeout(() => setCopied(''), 2500);
  };

  return (
    <>
      <section className="cards" aria-label="Resumo das pendências">
        <article className="card">
          <small>Total de pendências</small>
          <strong>{issues.length.toLocaleString('pt-BR')}</strong>
          <div className="line" />
        </article>
        {byKind.slice(0, 7).map(([k, n]) => (
          <button key={k} className={`card card-button${kind === k ? ' selected' : ''}`} onClick={() => setKind(kind === k ? '' : k)}>
            <small>{ISSUE_KINDS[k]}</small>
            <strong>{n.toLocaleString('pt-BR')}</strong>
            <div className="line" />
          </button>
        ))}
      </section>

      <div className="sectionbar">
        <p>
          {visible.length.toLocaleString('pt-BR')} itens · {grouped.length} {grouped.length === 1 ? 'líder' : 'líderes'}
          {kind && ` · filtrado por "${ISSUE_KINDS[kind]}"`}
        </p>
        <div className="actions">
          <select aria-label="Tipo de pendência" value={kind} onChange={(e) => setKind(e.target.value as IssueKind | '')}>
            <option value="">Todos os tipos</option>
            {byKind.map(([k]) => (
              <option key={k} value={k}>
                {ISSUE_KINDS[k]}
              </option>
            ))}
          </select>
          <label className="check">
            <input type="checkbox" checked={onlyAction} onChange={(e) => setOnlyAction(e.target.checked)} /> Só o que precisa de correção
          </label>
        </div>
      </div>

      {grouped.length === 0 && <p className="empty panel">Nenhuma pendência para esta seleção. 🎉</p>}

      {grouped.map((g) => (
        <section className="panel" key={g.leader}>
          <div className="panelhead">
            <div>
              <p className="eyebrow">LÍDER</p>
              <h2>
                {g.leader} <span className="badge">{g.total}</span>
              </h2>
            </div>
            <button className="primary" onClick={() => copy(g.leader, g.people)}>
              {copied === g.leader ? 'Mensagem copiada ✓' : 'Copiar mensagem de cobrança'}
            </button>
          </div>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Pessoa</th>
                  <th>Data</th>
                  <th>Tipo</th>
                  <th>Campo</th>
                  <th>Na planilha</th>
                  <th>Esperado</th>
                  <th>Planilha</th>
                </tr>
              </thead>
              <tbody>
                {g.people.flatMap(([person, items]) =>
                  items.map((i, idx) => (
                    <tr key={`${person}-${idx}`} title={i.reason}>
                      <td>
                        {idx === 0 ? person : ''}
                        {idx === 0 && <small>{items.length} {items.length === 1 ? 'pendência' : 'pendências'}</small>}
                      </td>
                      <td>{i.date}</td>
                      <td>
                        <span className={`badge kind-${i.kind}`}>{ISSUE_KINDS[i.kind]}</span>
                      </td>
                      <td>{i.field ?? '—'}</td>
                      <td className="wrap">{i.sheetValue ?? '—'}</td>
                      <td className="wrap">{i.expected ?? '—'}</td>
                      <td>
                        {i.url ? (
                          <a href={i.url} target="_blank" rel="noopener noreferrer">
                            Abrir ↗
                          </a>
                        ) : (
                          <small>{i.source}</small>
                        )}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  );
}
