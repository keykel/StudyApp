import { sb } from './supabase.js';
import { esc, toast } from './ui.js';

export const ctx = { profile: null };
export const iso = (d) => d.toLocaleDateString('sv');
export const today = () => iso(new Date());
export const dloc = (ts) => iso(new Date(ts));
export const br = (s) => new Date(s + 'T12:00').toLocaleDateString('pt-BR');
export const addDays = (s, n) => { const d = new Date(s + 'T12:00'); d.setDate(d.getDate() + n); return iso(d); };
export const weekStart = (s = today()) => addDays(s, -((new Date(s + 'T12:00').getDay() + 6) % 7));
export const fmtMin = (m) => m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}min` : `${m}min`;
export const STATUS = { not_started: 'Não iniciado', in_progress: 'Em andamento', done: 'Concluído' };
export const KINDS = { study: 'Estudo', exercise: 'Exercícios', review: 'Revisão' };
export const chip = (s) => s ? `<span class="chip" style="--c:${esc(s.color)}">${esc(s.name)}</span>` : '';
export const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
export const bar = (p, c) => `<div class="bar" role="progressbar" aria-valuenow="${Math.min(p, 100)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${Math.min(p, 100)}%;${c ? `background:${esc(c)}` : ''}"></i></div>`;

export async function q(p) { const r = await p; if (r.error) throw r.error; return r.data; }
export const getSubjects = () => q(sb.from('subjects').select('*').order('position').order('created_at'));
export const empty = (t, d = '') => `<div class="card empty"><h3>${esc(t)}</h3><p>${esc(d)}</p></div>`;

export async function run(fn, ok) {
  try { const r = await fn(); if (ok) toast(ok); return r ?? true; }
  catch (e) { console.error(e); toast(e.code === '23505' ? 'Esse registro já existe.' : 'Não foi possível concluir a ação. Tente novamente.', 'error'); return false; }
}

export function form(title, fields, vals = {}, validate) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog'); d.className = 'dlg';
    const inp = (f) => {
      const v = vals[f.name] ?? f.def ?? '';
      const a = `name="${f.name}" ${f.required ? 'required' : ''} ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''}`;
      if (f.type === 'select') return `<select ${a}>${f.options.map(([k, l]) => `<option value="${esc(k)}" ${String(k) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
      if (f.type === 'textarea') return `<textarea ${a} rows="3">${esc(v)}</textarea>`;
      return `<input type="${f.type || 'text'}" ${a} value="${esc(v)}">`;
    };
    d.innerHTML = `<form method="dialog"><h3>${esc(title)}</h3>${fields.map(f => `<label>${esc(f.label)}${inp(f)}</label>`).join('')}<p class="err" role="alert"></p><div class="row"><button class="btn primary" style="width:auto">Salvar</button><button type="button" class="btn" data-x>Cancelar</button></div></form>`;
    document.body.append(d); d.showModal();
    const err = (m) => { d.querySelector('.err').textContent = m; };
    const close = (r) => { if (d.isConnected) { d.close(); d.remove(); } resolve(r); };
    d.querySelector('[data-x]').onclick = () => close(null);
    d.addEventListener('cancel', () => close(null));
    d.querySelector('form').onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(e.target), out = {};
      for (const f of fields) {
        let v = (fd.get(f.name) ?? '').toString().trim();
        if (f.type === 'number') v = v === '' ? null : Number(v); else if (v === '') v = null;
        if (f.required && v === null) return err(`Preencha: ${f.label}.`);
        out[f.name] = v;
      }
      const m = validate?.(out); if (m) return err(m);
      close(out);
    };
  });
}

export function info(title, html) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog'); d.className = 'dlg';
    d.innerHTML = `<h3>${esc(title)}</h3>${html}<div class="row" style="margin-top:14px"><button class="btn primary" style="width:auto">Fechar</button></div>`;
    document.body.append(d); d.showModal();
    const close = () => { if (d.isConnected) { d.close(); d.remove(); } resolve(); };
    d.querySelector('button').onclick = close; d.addEventListener('cancel', close);
  });
}
