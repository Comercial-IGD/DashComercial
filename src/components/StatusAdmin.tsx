'use client';

import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { ABSENCE_REASONS, type AbsenceReason, type AttendanceStatus, type RosterEntry } from '@/lib/types';

const br = (d: string) => d.split('-').reverse().join('/');
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

interface Draft {
  id: number | null;
  sellerCode: string;
  start: string;
  end: string;
  reason: AbsenceReason;
  note: string;
}

const emptyDraft = (): Draft => ({ id: null, sellerCode: '', start: today(), end: today(), reason: 'day_off', note: '' });

export function StatusAdmin(props: {
  roster: RosterEntry[];
  statuses: AttendanceStatus[];
  demo: boolean;
  onSaved: (next: AttendanceStatus[]) => void;
}) {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');

  const name = (code: string) => props.roster.find((p) => p.code === code)?.seller ?? code;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.sellerCode) return setMessage('Selecione a pessoa.');
    if (draft.end < draft.start) return setMessage('A data final deve ser igual ou posterior à inicial.');
    setBusy(true);
    setMessage('');
    try {
      const record: AttendanceStatus = {
        id: draft.id ?? Date.now(),
        sellerCode: draft.sellerCode,
        start: draft.start,
        end: draft.end,
        reason: draft.reason,
        note: draft.note.trim() || null,
      };
      if (!props.demo) {
        const payload = {
          seller_code: record.sellerCode,
          start_date: record.start,
          end_date: record.end,
          reason: record.reason,
          note: record.note,
          updated_at: new Date().toISOString(),
        };
        const sb = supabaseBrowser();
        const res = draft.id
          ? await sb.from('attendance_status').update(payload).eq('id', draft.id).select('id').single()
          : await sb.from('attendance_status').insert(payload).select('id').single();
        if (res.error) throw res.error;
        record.id = res.data.id;
      }
      const others = props.statuses.filter((s) => s.id !== draft.id);
      props.onSaved([...others, record].sort((a, b) => b.start.localeCompare(a.start)));
      setMessage(draft.id ? 'Status atualizado.' : `Status registrado para ${name(record.sellerCode)}.`);
      setDraft(emptyDraft());
    } catch (err) {
      setMessage(`Não foi possível salvar: ${err instanceof Error ? err.message : (err as { message?: string }).message ?? String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (s: AttendanceStatus) => {
    if (!window.confirm(`Excluir o status de ${name(s.sellerCode)} (${br(s.start)} a ${br(s.end)})?`)) return;
    if (!props.demo) {
      const { error } = await supabaseBrowser().from('attendance_status').delete().eq('id', s.id);
      if (error) return setMessage(`Não foi possível excluir: ${error.message}`);
    }
    props.onSaved(props.statuses.filter((x) => x.id !== s.id));
    setMessage('Status excluído.');
  };

  const list = [...props.statuses]
    .filter((s) => !filter || s.sellerCode === filter)
    .sort((a, b) => b.start.localeCompare(a.start));

  return (
    <>
      <section className="panel">
        <p className="eyebrow">RH</p>
        <h2>{draft.id ? 'Editar status de atuação' : 'Registrar status de atuação'}</h2>
        <p className="muted">Marque os dias em que a pessoa não atuou. Esses dias aparecem como ausência no dash e saem das médias por dia atuado.</p>
        <form className="filters status-form" onSubmit={save}>
          <label>
            Pessoa
            <select value={draft.sellerCode} onChange={(e) => set('sellerCode', e.target.value)} required>
              <option value="">Selecione</option>
              {props.roster.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.seller} · {p.role ?? '—'} · {p.team}
                </option>
              ))}
            </select>
          </label>
          <label>
            Motivo
            <select value={draft.reason} onChange={(e) => set('reason', e.target.value as AbsenceReason)}>
              {Object.entries(ABSENCE_REASONS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            De
            <input type="date" value={draft.start} onChange={(e) => set('start', e.target.value)} required />
          </label>
          <label>
            Até
            <input type="date" value={draft.end} min={draft.start} onChange={(e) => set('end', e.target.value)} required />
          </label>
          <label className="wide">
            Observação (opcional)
            <input type="text" maxLength={300} value={draft.note} onChange={(e) => set('note', e.target.value)} placeholder="Ex.: queda de internet às 14h" />
          </label>
          <div className="form-actions">
            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'Salvando…' : draft.id ? 'Salvar alterações' : 'Registrar'}
            </button>
            {draft.id && (
              <button type="button" onClick={() => setDraft(emptyDraft())}>
                Cancelar edição
              </button>
            )}
          </div>
        </form>
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
      </section>

      <section className="panel">
        <div className="panelhead">
          <h2>Status registrados</h2>
          <select aria-label="Filtrar por pessoa" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">Todas as pessoas</option>
            {props.roster.map((p) => (
              <option key={p.code} value={p.code}>
                {p.seller}
              </option>
            ))}
          </select>
        </div>
        <div className="tablewrap">
          {list.length ? (
            <table>
              <thead>
                <tr>
                  <th>Pessoa</th>
                  <th>Período</th>
                  <th>Motivo</th>
                  <th>Observação</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s.id}>
                    <td>{name(s.sellerCode)}</td>
                    <td>{s.start === s.end ? br(s.start) : `${br(s.start)} a ${br(s.end)}`}</td>
                    <td>
                      <span className="badge">{ABSENCE_REASONS[s.reason]}</span>
                    </td>
                    <td>{s.note ?? '—'}</td>
                    <td className="row-actions">
                      <button onClick={() => setDraft({ id: s.id, sellerCode: s.sellerCode, start: s.start, end: s.end, reason: s.reason, note: s.note ?? '' })}>Editar</button>
                      <button onClick={() => remove(s)}>Excluir</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty">Nenhum status registrado.</p>
          )}
        </div>
      </section>
    </>
  );
}
