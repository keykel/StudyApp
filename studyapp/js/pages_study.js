import { sb } from './supabase.js';
import { q, today, addDays, br, STATUS, getSubjects, empty, form, run, chip, pct, bar } from './core.js';
import { $, esc, icon, toast } from './ui.js';
import { award, refresh } from './gamify.js';

const ICONS = [['book', 'Livro'], ['list', 'Lista'], ['chart', 'Gráfico'], ['target', 'Meta'], ['trophy', 'Troféu'], ['clock', 'Relógio']];

export async function materias(view) {
  const [subs, topics] = await Promise.all([getSubjects(), q(sb.from('topics').select('id,subject_id,status'))]);
  const fields = [{ name: 'name', label: 'Nome', required: true }, { name: 'color', label: 'Cor', type: 'color', def: '#7c5cff' }, { name: 'icon', label: 'Ícone', type: 'select', options: ICONS }];
  view.innerHTML = `<div class="row between"><h1>Minhas matérias</h1><button class="btn primary" id="add" style="width:auto">Nova matéria</button></div>` +
    (subs.length ? `<div class="grid">${subs.map((s, i) => {
      const t = topics.filter(x => x.subject_id === s.id), d = t.filter(x => x.status === 'done').length, p = pct(d, t.length);
      return `<article class="card"><div class="row between"><b style="color:${esc(s.color)}">${icon(s.icon)} ${esc(s.name)}</b><span class="row"><button class="btn sm" data-a="up" data-id="${s.id}" ${i === 0 ? 'disabled' : ''} aria-label="Mover para cima">↑</button><button class="btn sm" data-a="dn" data-id="${s.id}" ${i === subs.length - 1 ? 'disabled' : ''} aria-label="Mover para baixo">↓</button></span></div>
      ${bar(p, s.color)}<span class="muted">${d} de ${t.length} conteúdos · ${p}%</span>
      <div class="row" style="margin-top:12px"><button class="btn sm" data-a="edit" data-id="${s.id}">Editar</button><button class="btn sm danger" data-a="del" data-id="${s.id}">Excluir</button></div></article>`;
    }).join('')}</div>` : empty('Nenhuma matéria ainda', 'Crie sua primeira matéria para organizar conteúdos, exercícios e metas.'));
  const reload = () => materias(view);
  $('#add', view).onclick = async () => { const v = await form('Nova matéria', fields); if (v && await run(() => q(sb.from('subjects').insert({ ...v, position: subs.length })), 'Matéria criada.')) reload(); };
  view.onclick = async (e) => {
    const b = e.target.closest('button[data-a]'); if (!b) return;
    const id = b.dataset.id, s = subs.find(x => x.id === id), a = b.dataset.a;
    if (a === 'edit') { const v = await form('Editar matéria', fields, s); if (v && await run(() => q(sb.from('subjects').update(v).eq('id', id)), 'Matéria atualizada.')) reload(); }
    if (a === 'del' && confirm(`Excluir "${s.name}"? Os conteúdos e exercícios dessa matéria também serão excluídos.`)) { if (await run(() => q(sb.from('subjects').delete().eq('id', id)), 'Matéria excluída.')) reload(); }
    if (a === 'up' || a === 'dn') {
      const arr = subs.map(x => x.id), i = arr.indexOf(id), j = a === 'up' ? i - 1 : i + 1; [arr[i], arr[j]] = [arr[j], arr[i]];
      if (await run(() => Promise.all(arr.map((sid, k) => q(sb.from('subjects').update({ position: k }).eq('id', sid)))))) reload();
    }
  };
}

export async function ensureReview(topicId, days = 1) {
  const ex = await q(sb.from('reviews').select('id').eq('topic_id', topicId).is('done_at', null));
  if (!ex.length) await q(sb.from('reviews').insert({ topic_id: topicId, due_on: addDays(today(), days), interval_days: days }));
}
const pick = ({ subject_id, parent_id, title, status, mastery, studied_on, minutes_spent, notes }) => ({ subject_id, parent_id, title, status, mastery: mastery ? Number(mastery) : null, studied_on, minutes_spent: minutes_spent ?? 0, notes });
async function saveTopic(v, old) {
  const done = v.status === 'done', was = old?.status === 'done';
  const row = { ...pick(v), completed_at: done ? (old?.completed_at ?? new Date().toISOString()) : null };
  if (done && !row.studied_on) row.studied_on = today();
  let id = old?.id;
  if (old) await q(sb.from('topics').update(row).eq('id', id));
  else id = (await q(sb.from('topics').insert(row).select('id').single())).id;
  if (done && !was) { await award('topic', 20, id, 5); await ensureReview(id); }
  await refresh();
}

const F = { subject: '', status: '', period: '' };
export async function conteudos(view) {
  const [subs, topics] = await Promise.all([getSubjects(), q(sb.from('topics').select('*').order('created_at'))]);
  const sm = Object.fromEntries(subs.map(s => [s.id, s])), cut = F.period ? addDays(today(), -Number(F.period)) : null;
  const shown = topics.filter(t => (!F.subject || t.subject_id === F.subject) && (!F.status || t.status === F.status) && (!cut || (t.studied_on && t.studied_on >= cut)));
  const ordered = [];
  shown.filter(t => !t.parent_id || !shown.some(p => p.id === t.parent_id)).forEach(t => { ordered.push(t); shown.filter(c => c.parent_id === t.id).forEach(c => ordered.push(c)); });
  const opts = (arr, cur, all) => `<option value="">${all}</option>` + arr.map(([k, l]) => `<option value="${esc(k)}" ${k === cur ? 'selected' : ''}>${esc(l)}</option>`).join('');
  const fields = (old) => [
    { name: 'subject_id', label: 'Matéria', type: 'select', required: true, options: subs.map(s => [s.id, s.name]) },
    { name: 'parent_id', label: 'Subtópico de (opcional)', type: 'select', options: [['', '— Nenhum —'], ...topics.filter(t => !t.parent_id && t.id !== old?.id).map(t => [t.id, `${sm[t.subject_id]?.name} · ${t.title}`])] },
    { name: 'title', label: 'Título', required: true },
    { name: 'status', label: 'Situação', type: 'select', options: Object.entries(STATUS) },
    { name: 'mastery', label: 'Nível de domínio', type: 'select', options: [['', 'Não definido'], [1, '1 — Fraco'], [2, '2'], [3, '3 — Médio'], [4, '4'], [5, '5 — Dominado']] },
    { name: 'studied_on', label: 'Data de estudo', type: 'date' },
    { name: 'minutes_spent', label: 'Tempo dedicado (min)', type: 'number', min: 0, def: 0 },
    { name: 'notes', label: 'Observações', type: 'textarea' },
  ];
  const valid = (v) => { const p = topics.find(t => t.id === v.parent_id); return p && p.subject_id !== v.subject_id ? 'O subtópico precisa ser da mesma matéria do conteúdo principal.' : ''; };
  view.innerHTML = `<div class="row between"><h1>Conteúdos</h1><button class="btn primary" id="add" style="width:auto">Novo conteúdo</button></div>
  <div class="row" style="margin:12px 0"><select id="fs" aria-label="Matéria">${opts(subs.map(s => [s.id, s.name]), F.subject, 'Todas as matérias')}</select>
  <select id="ft" aria-label="Situação">${opts(Object.entries(STATUS), F.status, 'Todas as situações')}</select>
  <select id="fp" aria-label="Período">${opts([['7', 'Últimos 7 dias'], ['30', 'Últimos 30 dias'], ['90', 'Últimos 90 dias']], F.period, 'Qualquer período')}</select></div>` +
    (ordered.length ? ordered.map(t => `<article class="card item ${t.parent_id ? 'sub' : ''}"><div class="grow"><b>${esc(t.title)}</b> ${chip(sm[t.subject_id])}
      <div class="muted">${t.studied_on ? br(t.studied_on) + ' · ' : ''}${t.minutes_spent ? t.minutes_spent + ' min · ' : ''}${t.mastery ? 'Domínio ' + t.mastery + '/5' : 'Domínio não definido'}</div>${t.notes ? `<p class="muted">${esc(t.notes)}</p>` : ''}</div>
      <select data-st="${t.id}" aria-label="Situação">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}" ${k === t.status ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button class="btn sm" data-a="edit" data-id="${t.id}">Editar</button><button class="btn sm danger" data-a="del" data-id="${t.id}">Excluir</button></article>`).join('')
      : empty(topics.length ? 'Nada com esses filtros' : 'Nenhum conteúdo ainda', topics.length ? 'Ajuste os filtros para ver outros conteúdos.' : 'Adicione o primeiro conteúdo de uma matéria.'));
  const reload = () => conteudos(view);
  $('#add', view).onclick = async () => {
    if (!subs.length) return toast('Crie uma matéria primeiro, em Minhas matérias.', 'error');
    const v = await form('Novo conteúdo', fields(), { subject_id: F.subject }, valid);
    if (v && await run(() => saveTopic(v, null), 'Conteúdo adicionado.')) reload();
  };
  $('#fs', view).onchange = (e) => { F.subject = e.target.value; reload(); };
  $('#ft', view).onchange = (e) => { F.status = e.target.value; reload(); };
  $('#fp', view).onchange = (e) => { F.period = e.target.value; reload(); };
  view.onchange = async (e) => {
    const id = e.target.dataset?.st; if (!id) return;
    const old = topics.find(t => t.id === id);
    if (await run(() => saveTopic({ ...old, status: e.target.value }, old))) reload();
  };
  view.onclick = async (e) => {
    const b = e.target.closest('button[data-a]'); if (!b) return;
    const old = topics.find(t => t.id === b.dataset.id);
    if (b.dataset.a === 'edit') { const v = await form('Editar conteúdo', fields(old), old, (x) => valid(x)); if (v && await run(() => saveTopic(v, old), 'Conteúdo atualizado.')) reload(); }
    if (b.dataset.a === 'del' && confirm(`Excluir "${old.title}"? Os subtópicos e revisões ligados a ele também serão excluídos.`)) { if (await run(() => q(sb.from('topics').delete().eq('id', old.id)), 'Conteúdo excluído.')) reload(); }
  };
}

const STEPS = [1, 3, 7, 14, 30, 60];
export async function revisoes(view) {
  const [revs, topics, subs] = await Promise.all([q(sb.from('reviews').select('*').order('due_on')), q(sb.from('topics').select('id,title,subject_id,status,mastery')), getSubjects()]);
  const tm = Object.fromEntries(topics.map(t => [t.id, t])), sm = Object.fromEntries(subs.map(s => [s.id, s])), t = today();
  const pend = revs.filter(r => !r.done_at && r.due_on <= t), soon = revs.filter(r => !r.done_at && r.due_on > t);
  const done = revs.filter(r => r.done_at).sort((a, b) => b.done_at.localeCompare(a.done_at)).slice(0, 15);
  const withPend = new Set(revs.filter(r => !r.done_at).map(r => r.topic_id));
  const sugg = topics.filter(x => x.status === 'done' && !withPend.has(x.id) && (!x.mastery || x.mastery <= 3)).slice(0, 5);
  const item = (r, actions) => { const tp = tm[r.topic_id]; return `<article class="card item"><div class="grow"><b>${esc(tp?.title)}</b> ${chip(sm[tp?.subject_id])}<div class="muted">${r.done_at ? `Revisado em ${new Date(r.done_at).toLocaleDateString('pt-BR')} · domínio ${r.mastery_after}/5` : `Prevista para ${br(r.due_on)}${r.due_on < t ? ' · em atraso' : ''}`}</div></div>${actions}</article>`; };
  view.innerHTML = `<div class="row between"><h1>Revisões</h1><button class="btn primary" id="add" style="width:auto">Programar revisão</button></div>
  <p class="muted">Ao concluir um conteúdo, a primeira revisão é agendada para o dia seguinte. Quanto melhor seu domínio, maior o intervalo até a próxima.</p>
  <h3>Pendentes</h3>${pend.length ? pend.map(r => item(r, `<button class="btn sm primary" data-a="do" data-id="${r.id}" style="width:auto">Concluir</button><button class="btn sm danger" data-a="rm" data-id="${r.id}">Remover</button>`)).join('') : '<p class="muted">Nenhuma revisão pendente hoje.</p>'}
  <h3>Programadas</h3>${soon.length ? soon.map(r => item(r, `<button class="btn sm danger" data-a="rm" data-id="${r.id}">Remover</button>`)).join('') : '<p class="muted">Nada programado.</p>'}
  <h3>Sugestões</h3>${sugg.length ? sugg.map(x => `<article class="card item"><div class="grow"><b>${esc(x.title)}</b> ${chip(sm[x.subject_id])}<div class="muted">${x.mastery ? `Domínio ${x.mastery}/5` : 'Domínio não definido'}</div></div><button class="btn sm" data-a="sg" data-id="${x.id}">Revisar amanhã</button></article>`).join('') : '<p class="muted">Sem sugestões por enquanto.</p>'}
  <h3>Concluídas</h3>${done.length ? done.map(r => item(r, '')).join('') : '<p class="muted">As revisões concluídas aparecem aqui.</p>'}`;
  const reload = () => revisoes(view);
  $('#add', view).onclick = async () => {
    if (!topics.length) return toast('Adicione um conteúdo primeiro.', 'error');
    const v = await form('Programar revisão', [{ name: 'topic_id', label: 'Conteúdo', type: 'select', required: true, options: topics.map(x => [x.id, `${sm[x.subject_id]?.name} · ${x.title}`]) }, { name: 'due_on', label: 'Data', type: 'date', required: true, def: addDays(t, 1) }],
      {}, (x) => withPend.has(x.topic_id) ? 'Esse conteúdo já tem uma revisão pendente.' : '');
    if (v && await run(() => q(sb.from('reviews').insert({ topic_id: v.topic_id, due_on: v.due_on })), 'Revisão programada.')) reload();
  };
  view.onclick = async (e) => {
    const b = e.target.closest('button[data-a]'); if (!b) return; const id = b.dataset.id, a = b.dataset.a;
    if (a === 'sg') { if (await run(() => ensureReview(id, 1), 'Revisão programada para amanhã.')) reload(); }
    if (a === 'rm' && confirm('Remover esta revisão?')) { if (await run(() => q(sb.from('reviews').delete().eq('id', id)))) reload(); }
    if (a === 'do') {
      const r = revs.find(x => x.id === id);
      const v = await form('Revisão concluída', [{ name: 'mastery', label: 'Como está seu domínio agora?', type: 'select', required: true, options: [[1, '1 — Preciso rever bastante'], [2, '2'], [3, '3 — Razoável'], [4, '4 — Bom'], [5, '5 — Dominado']] }]);
      if (!v) return; const m = Number(v.mastery);
      const next = m <= 2 ? 1 : m === 3 ? r.interval_days : (STEPS.find(s => s > r.interval_days) ?? 60);
      const ok = await run(async () => {
        await q(sb.from('reviews').update({ done_at: new Date().toISOString(), mastery_after: m }).eq('id', id));
        await q(sb.from('topics').update({ mastery: m }).eq('id', r.topic_id));
        if (!(m === 5 && r.interval_days >= 60)) await q(sb.from('reviews').insert({ topic_id: r.topic_id, due_on: addDays(t, next), interval_days: next }));
        await award('review', 10, id, 5); await refresh();
      }, 'Revisão registrada.');
      if (ok) reload();
    }
  };
}
