import { sb } from './supabase.js';
import { q, today, addDays, weekStart, br, dloc, KINDS, getSubjects, form, run, empty, iso } from './core.js';
import { $, esc, toast } from './ui.js';
import { award, refresh } from './gamify.js';

const S = { view: 'month', date: today() };
const DOW = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

export async function calendario(view) {
  const [subs, topics] = await Promise.all([getSubjects(), q(sb.from('topics').select('id,title,subject_id,studied_on'))]);
  const sm = Object.fromEntries(subs.map(s => [s.id, s])), t = today(), d0 = S.date;
  let a, b;
  if (S.view === 'month') { a = weekStart(d0.slice(0, 7) + '-01'); b = addDays(a, 41); } else if (S.view === 'week') { a = weekStart(d0); b = addDays(a, 6); } else { a = b = d0; }
  const lo = new Date(a + 'T00:00').toISOString(), hi = new Date(addDays(b, 1) + 'T00:00').toISOString();
  const [acts, ex, ses, revs, next] = await Promise.all([
    q(sb.from('activities').select('*').gte('scheduled_for', a).lte('scheduled_for', b).order('start_time', { nullsFirst: false })),
    q(sb.from('exercises').select('done_on').gte('done_on', a).lte('done_on', b)),
    q(sb.from('study_sessions').select('started_at').gte('started_at', lo).lt('started_at', hi)),
    q(sb.from('reviews').select('due_on,done_at')),
    q(sb.from('activities').select('title,scheduled_for,start_time').eq('done', false).gte('scheduled_for', t).order('scheduled_for').limit(5)),
  ]);
  const mk = {}, mark = (d, k) => { (mk[d] ||= new Set()).add(k); };
  ses.forEach(x => mark(dloc(x.started_at), 'study')); topics.forEach(x => x.studied_on && mark(x.studied_on, 'study'));
  ex.forEach(x => mark(x.done_on, 'exercise')); revs.forEach(x => mark(x.done_at ? dloc(x.done_at) : x.due_on, 'review'));
  acts.filter(x => x.done).forEach(x => mark(x.scheduled_for, x.kind));
  const dots = (d) => [...(mk[d] || [])].map(k => `<i class="dot ${k}" title="${KINDS[k]}"></i>`).join('');
  const late = (x) => !x.done && x.scheduled_for < t;
  const item = (x) => `<article class="card item ${x.done ? 'is-done' : ''} ${late(x) ? 'is-late' : ''}"><input type="checkbox" data-done="${x.id}" ${x.done ? 'checked' : ''} aria-label="Concluída" style="width:20px;margin:0">
    <div class="grow"><b>${esc(x.title)}</b> ${sm[x.subject_id] ? `<span class="chip" style="--c:${esc(sm[x.subject_id].color)}">${esc(sm[x.subject_id].name)}</span>` : ''}
    <div class="muted">${KINDS[x.kind]}${x.start_time ? ' · ' + x.start_time.slice(0, 5) : ''}${x.est_minutes ? ' · ' + x.est_minutes + ' min' : ''}${late(x) ? ' · pendente de dias anteriores' : ''}</div>${x.description ? `<p class="muted">${esc(x.description)}</p>` : ''}</div>
    <button class="btn sm" data-a="re" data-id="${x.id}">Reagendar</button><button class="btn sm" data-a="edit" data-id="${x.id}">Editar</button><button class="btn sm danger" data-a="del" data-id="${x.id}">Excluir</button></article>`;
  const day = (d) => `<h3>${new Date(d + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</h3>${acts.filter(x => x.scheduled_for === d).map(item).join('') || '<p class="muted">Sem atividades neste dia.</p>'}`;
  const title = S.view === 'month' ? new Date(d0 + 'T12:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) : S.view === 'week' ? `${br(a)} a ${br(b)}` : br(d0);
  let body;
  if (S.view === 'month') {
    const cur = d0.slice(0, 7);
    body = `<div class="cal">${DOW.map(x => `<b class="dow">${x}</b>`).join('')}${Array.from({ length: 42 }, (_, i) => addDays(a, i)).map(d => {
      const list = acts.filter(x => x.scheduled_for === d);
      return `<div class="cell ${d.slice(0, 7) !== cur ? 'out' : ''} ${d === t ? 'today' : ''}" data-day="${d}" tabindex="0" role="button" aria-label="${br(d)}"><span class="n">${+d.slice(8)}</span><span class="dots">${dots(d)}</span>
      ${list.slice(0, 3).map(x => `<span class="act ${x.done ? 'done' : ''} ${late(x) ? 'late' : ''}" style="--c:${esc(sm[x.subject_id]?.color || '#7c5cff')}">${esc(x.title)}</span>`).join('')}${list.length > 3 ? `<span class="muted">+${list.length - 3}</span>` : ''}</div>`;
    }).join('')}</div>
    <p class="legend"><i class="dot study"></i> Estudo <i class="dot exercise"></i> Exercícios <i class="dot review"></i> Revisão · atividades riscadas foram concluídas</p>
    <h3>Próximos compromissos</h3>${next.length ? next.map(x => `<p>${esc(x.title)} <span class="muted">· ${br(x.scheduled_for)}${x.start_time ? ' ' + x.start_time.slice(0, 5) : ''}</span></p>`).join('') : '<p class="muted">Nada agendado à frente.</p>'}`;
  } else if (S.view === 'week') body = Array.from({ length: 7 }, (_, i) => day(addDays(a, i))).join('');
  else body = day(d0) + `<p class="legend">${dots(d0) || 'Sem registros de estudo neste dia.'}</p>`;
  view.innerHTML = `<div class="row between"><h1 style="text-transform:capitalize">${esc(title)}</h1><button class="btn primary" id="add" style="width:auto">Nova atividade</button></div>
  <div class="row" style="margin:10px 0"><button class="btn sm" data-nav="-1" aria-label="Anterior">‹</button><button class="btn sm" data-nav="0">Hoje</button><button class="btn sm" data-nav="1" aria-label="Próximo">›</button>
  ${['month', 'week', 'day'].map(v => `<button class="btn sm ${S.view === v ? 'on' : ''}" data-view="${v}">${{ month: 'Mês', week: 'Semana', day: 'Dia' }[v]}</button>`).join('')}</div>${body}`;

  const reload = () => calendario(view);
  const fields = [
    { name: 'title', label: 'Título', required: true }, { name: 'kind', label: 'Tipo', type: 'select', options: Object.entries(KINDS) },
    { name: 'subject_id', label: 'Matéria', type: 'select', options: [['', '— Sem matéria —'], ...subs.map(s => [s.id, s.name])] },
    { name: 'topic_id', label: 'Conteúdo', type: 'select', options: [['', '— Nenhum —'], ...topics.map(x => [x.id, `${sm[x.subject_id]?.name} · ${x.title}`])] },
    { name: 'scheduled_for', label: 'Data', type: 'date', required: true, def: S.date }, { name: 'start_time', label: 'Horário', type: 'time' },
    { name: 'est_minutes', label: 'Duração estimada (min)', type: 'number', min: 1 }, { name: 'description', label: 'Descrição e observações', type: 'textarea' },
  ];
  const clean = (v) => { const tp = topics.find(x => x.id === v.topic_id); return { ...v, subject_id: v.subject_id || tp?.subject_id || null }; };
  $('#add', view).onclick = async () => { const v = await form('Nova atividade', fields); if (v && await run(() => q(sb.from('activities').insert(clean(v))), 'Atividade criada.')) reload(); };
  view.onclick = async (e) => {
    const nav = e.target.closest('[data-nav]'), vw = e.target.closest('[data-view]'), cell = e.target.closest('[data-day]'), btn = e.target.closest('button[data-a]');
    if (nav) {
      const n = Number(nav.dataset.nav);
      if (n === 0) S.date = t; else if (S.view === 'month') { const d = new Date(S.date + 'T12:00'); d.setDate(1); d.setMonth(d.getMonth() + n); S.date = iso(d); } else S.date = addDays(S.date, n * (S.view === 'week' ? 7 : 1));
      return reload();
    }
    if (vw) { S.view = vw.dataset.view; return reload(); }
    if (btn) {
      const x = acts.find(y => y.id === btn.dataset.id), id = btn.dataset.id;
      if (btn.dataset.a === 'edit') { const v = await form('Editar atividade', fields, x); if (v && await run(() => q(sb.from('activities').update(clean(v)).eq('id', id)), 'Atividade atualizada.')) reload(); }
      if (btn.dataset.a === 're') { const v = await form('Reagendar', [fields[4], fields[5]], x); if (v && await run(() => q(sb.from('activities').update(v).eq('id', id)), 'Atividade reagendada.')) reload(); }
      if (btn.dataset.a === 'del' && confirm(`Excluir "${x.title}"?`)) { if (await run(() => q(sb.from('activities').delete().eq('id', id)), 'Atividade excluída.')) reload(); }
      return;
    }
    if (cell) { S.date = cell.dataset.day; S.view = 'day'; reload(); }
  };
  view.onchange = async (e) => {
    const id = e.target.dataset?.done; if (!id) return;
    const ok = await run(async () => {
      await q(sb.from('activities').update({ done: e.target.checked, done_at: e.target.checked ? new Date().toISOString() : null }).eq('id', id));
      if (e.target.checked) await award('activity', 5, id, 6);
      await refresh();
    });
    if (ok) reload();
  };
  view.onkeydown = (e) => { if (e.key === 'Enter' && e.target.dataset?.day) { S.date = e.target.dataset.day; S.view = 'day'; calendario(view); } };
}
